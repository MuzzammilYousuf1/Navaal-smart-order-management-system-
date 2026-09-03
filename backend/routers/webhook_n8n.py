"""
n8n AI Integration & Webhook Router for Navaal-Organic-Foods Smart OrderFlow
Establishes reliable connection between Cloud n8n AI Chatbot (WhatsApp Business) and FastAPI system.

Endpoints:
  GET  /api/webhook/n8n/customer-info     - Find customer by phone number, check last orders & AI takeover status
  GET  /api/webhook/n8n/inventory         - Stock catalog & pricing tool for AI Agent
  POST /api/webhook/n8n/create-order       - AI places order directly in system, deducts inventory & broadcasts to dashboard
  GET  /api/webhook/n8n/order-status       - Retrieve active/past order status for WhatsApp queries
  GET  /api/webhook/n8n/reorder-reminders  - Get list of customers due for weekly re-ordering reminders
  POST /api/webhook/n8n/toggle-ai-takeover - Flag customer for Human Takeover / mute AI replies
  POST /api/webhook/n8n/verify-payment     - Audit payment proof screenshot data & update order payment status
"""

import re
import os
import json
import logging
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query, UploadFile, File, Form, Body
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
import uuid

from database import get_db
import models, schemas

logger = logging.getLogger("webhook_n8n")

router = APIRouter(prefix="/api/webhook/n8n", tags=["n8n-webhook"])
attachments_router = APIRouter(prefix="/api/attachments", tags=["customer-attachments"])


def verify_n8n_key(x_n8n_api_key: Optional[str] = Header(None)):
    """Validates API Key if configured in environment."""
    expected_key = os.getenv("N8N_API_KEY", "")
    if expected_key and x_n8n_api_key != expected_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-N8N-API-KEY header")
    return True


def normalize_phone(phone: str) -> str:
    """Normalizes phone numbers to standard digit string (e.g. +923001234567 -> 03001234567 or 923001234567)."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("92") and len(digits) == 12:
        return "0" + digits[2:]
    return digits


# ─── Customer Lookup ──────────────────────────────────────────────────────────

@router.get("/customer-info")
def get_customer_info(
    phone: str = Query(..., description="WhatsApp phone number"),
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Called by n8n to identify customer by WhatsApp number.
    Returns address, order history, and human takeover status.
    """
    clean = normalize_phone(phone)
    if not clean:
        raise HTTPException(status_code=400, detail="Invalid phone number")

    # Match by ending digits or exact phone
    customer = db.query(models.Customer).filter(
        or_(
            models.Customer.phone == phone,
            models.Customer.phone == clean,
            models.Customer.phone.like(f"%{clean[-10:]}%")
        )
    ).first()

    # Get last order for this phone
    last_order = db.query(models.Order).filter(
        or_(
            models.Order.customer_phone == phone,
            models.Order.customer_phone == clean,
            models.Order.customer_phone.like(f"%{clean[-10:]}%")
        )
    ).order_by(models.Order.created_at.desc()).first()

    if not customer and not last_order:
        return {
            "found": False,
            "message": "New customer profile. Ask for name and delivery address.",
            "ai_disabled": False
        }

    last_order_data = None
    if last_order:
        last_order_data = {
            "order_number": last_order.order_number,
            "status": last_order.status,
            "total_amount": last_order.total_amount,
            "created_at": last_order.created_at.isoformat(),
            "items": [
                {"product_name": it.product_name, "quantity": it.quantity, "unit_price": it.unit_price}
                for it in last_order.items
            ]
        }

    # Check ai_disabled attribute if column exists
    ai_disabled = getattr(customer, "ai_disabled", False) if customer else False

    return {
        "found": True,
        "customer_id": customer.id if customer else None,
        "name": customer.name if customer else (last_order.customer_name if last_order else ""),
        "phone": customer.phone if customer else phone,
        "delivery_address": customer.delivery_address if customer else (last_order.delivery_address if last_order else ""),
        "city": customer.city if customer else (last_order.city if last_order else "Karachi"),
        "total_orders": customer.order_count if customer else 1,
        "ai_disabled": ai_disabled,
        "last_order": last_order_data
    }


# ─── Stock & Inventory Tool ───────────────────────────────────────────────────

@router.get("/inventory")
def get_inventory_catalog(
    q: Optional[str] = Query(None, description="Search product name/category"),
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Returns active product catalog with current stock levels and unit prices.
    Used by n8n AI Agent as a tool to check stock before taking orders.
    """
    query = db.query(models.Product).filter(
        models.Product.is_active == True,
        models.Product.is_customer_facing == True
    )
    if q:
        query = query.filter(models.Product.name.ilike(f"%{q}%"))

    products = query.order_by(models.Product.name.asc()).all()

    catalog = []
    for p in products:
        multiplier = p.unit_multiplier or 1.0

        # Pack SKUs store stock on their BASE product, not on themselves.
        # Derive available pack count the same way the dashboard does:
        # available_packs = floor(base_product.stock_qty / unit_multiplier)
        if p.base_product_id:
            base = db.query(models.Product).filter(
                models.Product.id == p.base_product_id
            ).first()
            if base and multiplier > 0:
                effective_stock = int(base.stock_qty // multiplier)
            else:
                effective_stock = 0  # base not found or bad multiplier — treat as 0
        else:
            # Standalone / bulk product — stock is stored directly on the record
            effective_stock = p.stock_qty

        catalog.append({
            "product_id": p.id,
            "name": p.name,
            "sku": p.sku,
            "category": p.category,
            "unit": p.unit,
            "unit_price": p.unit_price,
            "stock_qty": effective_stock,
            "unit_multiplier": multiplier,
            "in_stock": effective_stock > 0,
            "low_stock": effective_stock <= p.low_stock_threshold
        })

    return {
        "total_products": len(catalog),
        "products": catalog
    }


# ─── Order Creation Endpoint ──────────────────────────────────────────────────

@router.post("/create-order")
async def create_whatsapp_order(
    data: schemas.OrderCreate,
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Called by n8n AI Agent when a customer confirms an order.
    Creates order in FastAPI, deducts inventory, upserts customer address book,
    and broadcasts real-time WebSocket event to the React dashboard!
    """
    if not data.customer_name or not data.customer_phone:
        raise HTTPException(status_code=400, detail="Customer name and phone are required")

    if not data.items:
        raise HTTPException(status_code=400, detail="Order items list cannot be empty")

    # Generate unique order number (e.g. NAV-20260819-XXXX)
    today_str = datetime.utcnow().strftime("%Y%m%d")
    count_today = db.query(models.Order).filter(models.Order.order_number.like(f"NAV-{today_str}-%")).count()
    order_number = f"NAV-{today_str}-{(count_today + 1):04d}"

    # Calculate total and check stock
    total_amount = 0.0
    order_items = []
    stock_warnings = []

    for item_in in data.items:
        item_total = item_in.quantity * item_in.unit_price
        total_amount += item_total

        # Attempt product lookup & stock deduction
        product = None
        if item_in.product_id:
            product = db.query(models.Product).filter(models.Product.id == item_in.product_id).first()
        if not product and item_in.product_name:
            product = db.query(models.Product).filter(models.Product.name.ilike(f"%{item_in.product_name}%")).first()

        if product:
            # Check stock
            required_qty = item_in.quantity * (product.unit_multiplier or 1.0)
            if product.stock_qty < required_qty:
                stock_warnings.append(
                    f"Warning: Low stock for {product.name}. Available: {product.stock_qty}, Requested: {required_qty}"
                )

            # Deduct stock
            old_qty = product.stock_qty
            product.stock_qty -= required_qty

            # Log stock movement
            movement = models.StockMovement(
                product_id=product.id,
                movement_type="sale",
                quantity_change=-required_qty,
                quantity_after=product.stock_qty,
                note=f"WhatsApp Order {order_number}",
                created_by="n8n-AI-Agent"
            )
            db.add(movement)

            order_items.append(
                models.OrderItem(
                    product_id=product.id,
                    product_name=product.name,
                    quantity=item_in.quantity,
                    unit_price=item_in.unit_price,
                    total_price=item_total
                )
            )
        else:
            order_items.append(
                models.OrderItem(
                    product_name=item_in.product_name,
                    quantity=item_in.quantity,
                    unit_price=item_in.unit_price,
                    total_price=item_total
                )
            )

    # Create Order
    new_order = models.Order(
        order_number=order_number,
        customer_name=data.customer_name,
        customer_phone=data.customer_phone,
        delivery_address=data.delivery_address,
        city=data.city or "Karachi",
        location_url=data.location_url,
        source="whatsapp",
        status="pending",
        priority=data.priority or "normal",
        payment_method=data.payment_method or "cod",
        payment_status=data.payment_status or "cod",
        amount_received=data.amount_received or 0.0,
        notes=data.notes or "Created via n8n WhatsApp Chatbot",
        total_amount=total_amount,
        items=order_items
    )

    db.add(new_order)
    db.commit()

    # ── Post debit/credit ledger entries ──────────────────────────────────────
    try:
        from routers.ledger import post_ledger_entry
        # 1. Debit the total order amount
        post_ledger_entry(
            db=db,
            phone=new_order.customer_phone,
            channel=getattr(new_order, "channel", "b2c") or "b2c",
            entry_type="debit",
            amount=new_order.total_amount,
            description=f"WhatsApp Order {new_order.order_number} created",
            order_id=new_order.id,
            created_by="n8n-AI-Agent",
        )
        # 2. If payment was already received on creation, credit it
        if new_order.amount_received and new_order.amount_received > 0:
            post_ledger_entry(
                db=db,
                phone=new_order.customer_phone,
                channel=getattr(new_order, "channel", "b2c") or "b2c",
                entry_type="credit",
                amount=new_order.amount_received,
                description=f"Upfront payment received for WhatsApp Order {new_order.order_number}",
                order_id=new_order.id,
                created_by="n8n-AI-Agent",
            )
        db.commit()
    except Exception as e:
        logger.warning(f"Failed to post ledger entries for WhatsApp order: {e}")

    db.refresh(new_order)

    # Record Status History
    status_entry = models.StatusHistory(
        order_id=new_order.id,
        old_status=None,
        new_status="pending",
        changed_by="n8n-AI-Agent",
        note="Order auto-created from WhatsApp conversation"
    )
    db.add(status_entry)

    # Upsert Address Book Customer
    from routers.customers import _upsert_customer_from_order
    items_summary = json.dumps([
        {"product_name": it.product_name, "quantity": it.quantity, "unit_price": it.unit_price}
        for it in new_order.items
    ])
    _upsert_customer_from_order(db, new_order, items_summary)
    db.commit()

    # Trigger WebSocket Broadcast to Dashboard UI
    try:
        from main import manager
        import asyncio
        asyncio.create_task(manager.broadcast({
            "event": "ORDER_CREATED",
            "source": "whatsapp",
            "order": {
                "id": new_order.id,
                "order_number": new_order.order_number,
                "customer_name": new_order.customer_name,
                "customer_phone": new_order.customer_phone,
                "status": new_order.status,
                "total_amount": new_order.total_amount,
                "created_at": new_order.created_at.isoformat()
            }
        }))
    except Exception as e:
        logger.warning(f"Could not broadcast WS event: {e}")

    return {
        "status": "success",
        "order_id": new_order.id,
        "order_number": new_order.order_number,
        "total_amount": new_order.total_amount,
        "stock_warnings": stock_warnings,
        "message": f"Order {new_order.order_number} created successfully and placed on dashboard!"
    }


# ─── Order Status Tracking ────────────────────────────────────────────────────

@router.get("/order-status")
def get_order_status(
    phone: Optional[str] = Query(None, description="Customer phone number"),
    order_number: Optional[str] = Query(None, description="Specific order number"),
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Called by n8n AI Agent when customer asks 'mera order kahan hai?'
    Returns real status, assigned rider, ETA/deadlines, item list.
    """
    if not phone and not order_number:
        raise HTTPException(status_code=400, detail="Provide either phone or order_number")

    query = db.query(models.Order)
    if order_number:
        query = query.filter(models.Order.order_number.ilike(order_number.strip()))
    elif phone:
        clean = normalize_phone(phone)
        query = query.filter(
            or_(
                models.Order.customer_phone == phone,
                models.Order.customer_phone == clean,
                models.Order.customer_phone.like(f"%{clean[-10:]}%")
            )
        )

    order = query.order_by(models.Order.created_at.desc()).first()

    if not order:
        return {
            "found": False,
            "message": "No order found matching your query."
        }

    status_labels = {
        "pending": "Received & being prepared in warehouse",
        "ready_to_ship": "Packed & ready for dispatch",
        "out_for_delivery": f"Out for delivery with rider {order.assigned_rider_name or 'assigned'}",
        "delivered": "Successfully delivered to destination",
        "cancelled": "Order was cancelled"
    }

    return {
        "found": True,
        "order_number": order.order_number,
        "status": order.status,
        "status_description": status_labels.get(order.status, order.status),
        "total_amount": order.total_amount,
        "payment_status": order.payment_status,
        "payment_method": order.payment_method,
        "assigned_rider": order.assigned_rider_name,
        "created_at": order.created_at.isoformat(),
        "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
        "items": [
            {"product_name": it.product_name, "quantity": it.quantity, "total_price": it.total_price}
            for it in order.items
        ]
    }


# ─── Automated Re-Order Reminders Endpoint ───────────────────────────────────

@router.get("/reorder-reminders")
def get_due_reorder_reminders(
    days: int = Query(7, ge=1, le=90, description="Inactivity days threshold"),
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Called by n8n Cron Trigger (e.g., every Monday morning).
    Returns list of repeat customers whose last order was > X days ago,
    enabling n8n to send automated WhatsApp re-order reminders.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=days)

    # Subquery for most recent order date per phone
    subq = db.query(
        models.Order.customer_phone,
        func.max(models.Order.created_at).label("last_order_date")
    ).filter(models.Order.customer_phone != None).group_by(models.Order.customer_phone).subquery()

    # Join with customers
    query = db.query(models.Customer, subq.c.last_order_date).outerjoin(
        subq, models.Customer.phone == subq.c.customer_phone
    )

    customers = query.all()

    due_list = []
    for customer, last_date in customers:
        # Check if customer has ai_disabled set to True
        if getattr(customer, "ai_disabled", False):
            continue

        if not last_date or last_date <= cutoff_date:
            due_list.append({
                "customer_id": customer.id,
                "name": customer.name,
                "phone": customer.phone,
                "delivery_address": customer.delivery_address,
                "last_order_date": last_date.isoformat() if last_date else None,
                "days_since_last_order": (datetime.utcnow() - last_date).days if last_date else None,
                "last_order_items": customer.last_items_json,
                "order_count": customer.order_count
            })

    return {
        "cutoff_days": days,
        "total_due_customers": len(due_list),
        "due_customers": due_list
    }


# ─── Human Supervision & AI Takeover Toggle ───────────────────────────────────

@router.post("/toggle-ai-takeover")
def toggle_ai_takeover(
    phone: str = Query(..., description="Customer phone number"),
    disable_ai: bool = Query(..., description="True to mute AI / enable human takeover"),
    reason: Optional[str] = Query(None, description="Reason for takeover"),
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Allows human operators (or AI escalation logic) to pause AI auto-replies for a customer.
    When disable_ai=True, n8n AI Agent will skip auto-responding and notify staff on dashboard.
    """
    clean = normalize_phone(phone)
    customer = db.query(models.Customer).filter(
        or_(
            models.Customer.phone == phone,
            models.Customer.phone == clean,
            models.Customer.phone.like(f"%{clean[-10:]}%")
        )
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer record not found")

    customer.ai_disabled = disable_ai
    if hasattr(customer, "notes") and reason:
        existing = customer.notes or ""
        customer.notes = f"{existing}\n[{datetime.utcnow().strftime('%Y-%m-%d %H:%M')}] AI Takeover: {reason}".strip()

    db.commit()

    # Broadcast notification to dashboard
    try:
        from main import manager
        import asyncio
        asyncio.create_task(manager.broadcast({
            "event": "AI_TAKEOVER_TOGGLED",
            "phone": phone,
            "customer_name": customer.name,
            "ai_disabled": disable_ai,
            "reason": reason
        }))
    except Exception as e:
        logger.warning(f"Could not broadcast WS event: {e}")

    return {
        "status": "success",
        "customer": customer.name,
        "phone": phone,
        "ai_disabled": disable_ai,
        "message": f"AI response status set to {'MUTED (Human Takeover Active)' if disable_ai else 'ACTIVE'}."
    }


# ─── Payment Proof Verification ───────────────────────────────────────────────

@router.post("/verify-payment")
def verify_payment_proof(
    phone: str = Query(..., description="Customer phone number"),
    amount: Optional[float] = Query(None, description="Detected amount from Vision model"),
    reference_no: Optional[str] = Query(None, description="Transaction ID / reference"),
    order_id: Optional[int] = Query(None, description="Associated order ID"),
    attachment_id: Optional[int] = Query(None, description="Associated customer attachment ID"),
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Called by n8n Vision processing node after analyzing a payment screenshot.
    Updates order payment status or logs verification proof for human review.
    """
    order = None
    if order_id:
        order = db.query(models.Order).filter(models.Order.id == order_id).first()
    else:
        clean = normalize_phone(phone)
        order = db.query(models.Order).filter(
            or_(
                models.Order.customer_phone == phone,
                models.Order.customer_phone == clean,
                models.Order.customer_phone.like(f"%{clean[-10:]}%")
            ),
            models.Order.payment_status != "paid"
        ).order_by(models.Order.created_at.desc()).first()

    # ── Update CustomerAttachment if attachment_id is provided ──────────────────
    if attachment_id:
        try:
            att = db.query(models.CustomerAttachment).filter(models.CustomerAttachment.id == attachment_id).first()
            if att:
                att.attachment_type = "payment"
                if amount is not None:
                    att.extracted_amount = amount
                if reference_no is not None:
                    att.reference_no = reference_no
                if order:
                    att.order_id = order.id
                    # If payment is successful/fully paid, status = matched, else pending_review
                    att.status = "matched" if (amount and amount >= order.total_amount) else "pending_review"
                else:
                    att.status = "pending_review"
                db.commit()
        except Exception as e:
            logger.warning(f"Failed to update CustomerAttachment {attachment_id}: {e}")

    if not order:
        return {
            "status": "logged_without_order",
            "message": "Payment screenshot details logged, but no unpaid order was found for this phone."
        }

    if amount:
        order.amount_received = amount
    if amount and amount >= order.total_amount:
        order.payment_status = "paid"
        order.payment_received_at = datetime.utcnow()
    else:
        order.payment_status = "partial"

    if reference_no:
        note_text = f"Payment Ref: {reference_no} (Verified via AI Vision)"
        order.notes = f"{order.notes}\n{note_text}".strip() if order.notes else note_text

    # ── Post credit ledger entry ──────────────────────────────────────────────
    if amount:
        try:
            from routers.ledger import post_ledger_entry
            post_ledger_entry(
                db=db,
                phone=order.customer_phone,
                channel=getattr(order, "channel", "b2c") or "b2c",
                entry_type="credit",
                amount=amount,
                description=f"Payment verified via AI Vision for Order {order.order_number}" + (f" (Ref: {reference_no})" if reference_no else ""),
                order_id=order.id,
                created_by="n8n-AI-Agent",
            )
        except Exception as e:
            logger.warning(f"Failed to post credit ledger entry for order {order.order_number}: {e}")

    db.commit()

    return {
        "status": "success",
        "order_number": order.order_number,
        "total_amount": order.total_amount,
        "amount_received": order.amount_received,
        "payment_status": order.payment_status,
        "message": f"Payment proof recorded for order {order.order_number}."
    }


# ─── Save / Update Customer Attachments (n8n initial uploads) ──────────────────

@router.post("/save-attachment")
def save_attachment(
    file: UploadFile = File(...),
    phone: Optional[str] = Form(None),
    order_id: Optional[int] = Form(None),
    phone_query: Optional[str] = Query(None, alias="phone"),
    order_id_query: Optional[int] = Query(None, alias="order_id"),
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    Saves raw customer uploaded image immediately on receiving it (before AI classification),
    ensuring it is preserved regardless of Vision classification outcomes.
    """
    active_phone = phone or phone_query
    active_order_id = order_id or order_id_query

    if not active_phone:
        raise HTTPException(status_code=400, detail="Missing customer phone number")

    # 1. Create uploads/attachments/ folder if not exists
    upload_dir = os.path.join("uploads", "attachments")
    os.makedirs(upload_dir, exist_ok=True)

    # 2. Generate non-colliding filename
    file_ext = os.path.splitext(file.filename)[1] or ".jpg"
    filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(upload_dir, filename)

    # 3. Save to disk
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(file.file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write attachment file: {e}")

    # 4. Create database record
    attachment = models.CustomerAttachment(
        customer_phone=active_phone,
        order_id=active_order_id,
        image_path=file_path,
        attachment_type="unclassified",
        status="pending_review",
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)

    return {
        "id": attachment.id,
        "status": attachment.status,
        "image_path": attachment.image_path
    }


from pydantic import BaseModel

class AttachmentUpdate(BaseModel):
    attachment_type: str
    notes: Optional[str] = None


@attachments_router.patch("/{id}")
def update_attachment(
    id: int,
    data: AttachmentUpdate,
    db: Session = Depends(get_db),
    _: bool = Depends(verify_n8n_key),
):
    """
    For non-payment cases (e.g. complaints, general queries). Updates attachment metadata.
    """
    att = db.query(models.CustomerAttachment).filter(models.CustomerAttachment.id == id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")

    att.attachment_type = data.attachment_type
    if data.notes is not None:
        att.notes = data.notes

    # Simple classification updates
    if data.attachment_type == "complaint":
        att.status = "pending_review"
    elif data.attachment_type == "other":
        att.status = "resolved"

    db.commit()
    db.refresh(att)
    return {
        "id": att.id,
        "attachment_type": att.attachment_type,
        "status": att.status,
        "notes": att.notes
    }

