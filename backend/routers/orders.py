import os
import logging
import requests as _requests
from typing import List, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import get_db
import models
import schemas
from auth import get_current_user

logger = logging.getLogger("orders")

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _notify_b2c_dispatch(order: models.Order) -> None:
    """
    Fire-and-forget POST to n8n when a B2C order goes out for delivery.
    Reads N8N_OFD_WEBHOOK_URL from the environment — if unset, skips silently.
    Wrapped in try/except so a dead n8n instance never breaks the dispatch flow.
    """
    url = os.getenv("N8N_OFD_WEBHOOK_URL", "").strip()
    if not url:
        return
    try:
        _requests.post(
            url,
            json={
                "event": "order_out_for_delivery",
                "order_number": order.order_number,
                "customer_name": order.customer_name,
                "customer_phone": order.customer_phone or "",
                "rider_name": order.assigned_rider_name or "",
                "total_amount": order.total_amount,
                "channel": getattr(order, "channel", "b2c"),
            },
            timeout=5,
        )
        logger.info("n8n OFD notify sent for %s", order.order_number)
    except Exception as exc:
        logger.warning("n8n OFD notify failed for %s: %s", order.order_number, exc)

# Valid status transitions
TRANSITIONS = {
    "pending": ["ready_to_ship", "cancelled"],
    "ready_to_ship": ["out_for_delivery", "pending", "cancelled"],
    "out_for_delivery": ["delivered", "returned", "cancelled"],
    "delivered": [],
    "returned": [],
    "cancelled": [],
}

SLA_MINUTES = 45  # Pickup window after RTS


def _generate_order_number(db: Session) -> str:
    now = datetime.utcnow()
    year_prefix = f"NOF-{now.year}-"
    existing = db.query(models.Order.order_number).filter(
        models.Order.order_number.like(f"{year_prefix}%")
    ).all()

    max_num = 0
    for (num_str,) in existing:
        if num_str:
            suffix = num_str.replace(year_prefix, "").strip()
            try:
                val = int(suffix)
                if val > max_num:
                    max_num = val
            except ValueError:
                pass

    next_num = max_num + 1
    candidate = f"{year_prefix}{next_num:04d}"
    while db.query(models.Order.id).filter(models.Order.order_number == candidate).first():
        next_num += 1
        candidate = f"{year_prefix}{next_num:04d}"
    return candidate


@router.post("/", response_model=schemas.OrderOut)
def create_order(
    data: schemas.OrderCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    order_number = _generate_order_number(db)
    total = sum(item.unit_price * item.quantity for item in data.items)

    pay_method = data.payment_method or "cod"
    pay_status = data.payment_status or ("received" if (data.amount_received or 0) > 0 else "cod")

    # Verify assigned staff FK
    assigned_staff_id = current_user.id if current_user else None
    if assigned_staff_id:
        user_exists = db.query(models.User.id).filter(models.User.id == assigned_staff_id).first()
        if not user_exists:
            assigned_staff_id = None

    # ── PRE-CHECK INVENTORY STOCK GUARD ─────────────────────────────────────
    from email_reports import send_low_stock_email_alert
    for item_data in data.items:
        product = None
        if item_data.product_id:
            product = db.query(models.Product).filter(
                models.Product.id == item_data.product_id,
                models.Product.is_active == True,
            ).first()
        if not product:
            product = db.query(models.Product).filter(
                models.Product.name.ilike(f"%{item_data.product_name}%"),
                models.Product.is_active == True,
            ).first()

        if product:
            target_product = product
            if product.base_product_id:
                base_p = db.query(models.Product).filter(models.Product.id == product.base_product_id).first()
                if base_p:
                    target_product = base_p

            multiplier = product.unit_multiplier or 1
            deduct_qty = item_data.quantity * multiplier

            if target_product.stock_qty < deduct_qty:
                db.add(models.NotificationLog(
                    notification_type="stock_warning",
                    subject=f"BACKORDER_WARNING_{target_product.sku}",
                    recipient="Warehouse Manager",
                    message=(
                        f"BACKORDER NOTICE: Order requested {item_data.quantity}x {product.name} "
                        f"({deduct_qty} {target_product.unit}s required). Current stock is {target_product.stock_qty} "
                        f"{target_product.unit}s. Stock will drop into negative."
                    ),
                    delivery_status="logged",
                ))
                db.commit()

                try:
                    send_low_stock_email_alert(db, product.name, target_product.stock_qty, deduct_qty, target_product.unit or "units")
                except Exception as ex:
                    logger.warning("Failed to send low stock email: %s", ex)

    # Parse delivery_date if provided
    deliv_dt = None
    if data.delivery_date:
        if isinstance(data.delivery_date, str):
            try:
                deliv_dt = datetime.fromisoformat(data.delivery_date.replace("Z", "+00:00"))
            except Exception:
                deliv_dt = None
        elif isinstance(data.delivery_date, datetime):
            deliv_dt = data.delivery_date

    order = models.Order(
        order_number=order_number,
        customer_name=data.customer_name,
        customer_phone=data.customer_phone,
        delivery_address=data.delivery_address,
        city=data.city,
        location_url=data.location_url,
        source=data.source,
        channel=data.channel,
        priority=data.priority,
        payment_status=pay_status,
        payment_method=pay_method,
        amount_received=data.amount_received or 0.0,
        notes=data.notes,
        delivery_date=deliv_dt,
        assigned_rider_name=data.assigned_rider_name,
        total_amount=total,
        assigned_staff_id=assigned_staff_id,
        created_at=datetime.utcnow(),
    )
    db.add(order)
    db.flush()

    for item_data in data.items:
        # Verify product FK
        product_id = item_data.product_id
        if product_id:
            p_exists = db.query(models.Product.id).filter(models.Product.id == product_id).first()
            if not p_exists:
                product_id = None

        item = models.OrderItem(
            order_id=order.id,
            product_id=product_id,
            product_name=item_data.product_name,
            quantity=item_data.quantity,
            unit_price=item_data.unit_price,
            total_price=item_data.unit_price * item_data.quantity,
        )
        db.add(item)

        # ── Auto-deduct stock from inventory (allows negative stock / backorder) ─────
        product = None
        if item_data.product_id:
            product = db.query(models.Product).filter(
                models.Product.id == item_data.product_id,
                models.Product.is_active == True,
            ).first()
        if not product:
            product = db.query(models.Product).filter(
                models.Product.name.ilike(f"%{item_data.product_name}%"),
                models.Product.is_active == True,
            ).first()

        if product:
            target_product = product
            if product.base_product_id:
                base_p = db.query(models.Product).filter(models.Product.id == product.base_product_id).first()
                if base_p:
                    target_product = base_p

            multiplier = product.unit_multiplier or 1
            deduct_qty = item_data.quantity * multiplier

            target_product.stock_qty -= deduct_qty
            movement = models.StockMovement(
                product_id=target_product.id,
                order_id=order.id,
                movement_type="sale",
                quantity_change=-deduct_qty,
                quantity_after=target_product.stock_qty,
                note=f"Sold {item_data.quantity}x {product.name} ({multiplier} units/pack) via Order {order_number}",
                created_by=current_user.name,
                created_at=datetime.utcnow(),
            )
            db.add(movement)

            # Backorder / Low stock alert
            if target_product.stock_qty <= target_product.low_stock_threshold:
                alert_type = "negative_stock" if target_product.stock_qty < 0 else "low_stock"
                db.add(models.NotificationLog(
                    notification_type=alert_type,
                    subject=f"{alert_type.upper()}_{target_product.sku}",
                    recipient="Warehouse Manager",
                    message=(
                        f"STOCK ALERT ({alert_type.replace('_', ' ').upper()}): {target_product.name} now has "
                        f"{target_product.stock_qty} {target_product.unit}s remaining after order "
                        f"{order_number}."
                    ),
                    delivery_status="logged",
                ))

    history = models.StatusHistory(
        order_id=order.id,
        old_status=None,
        new_status="pending",
        changed_by=current_user.name,
        changed_at=datetime.utcnow(),
        note="Order created",
    )
    db.add(history)
    db.commit()

    # ── Post debit/credit ledger entries ──────────────────────────────────────
    try:
        from routers.ledger import post_ledger_entry
        # 1. Debit the total order amount
        post_ledger_entry(
            db=db,
            phone=order.customer_phone,
            channel=order.channel or "b2c",
            entry_type="debit",
            amount=order.total_amount,
            description=f"Order {order.order_number} created",
            order_id=order.id,
            created_by=current_user.name,
        )
        # 2. If payment was already received on creation, credit it
        if order.amount_received and order.amount_received > 0:
            post_ledger_entry(
                db=db,
                phone=order.customer_phone,
                channel=order.channel or "b2c",
                entry_type="credit",
                amount=order.amount_received,
                description=f"Upfront payment received for Order {order.order_number}",
                order_id=order.id,
                created_by=current_user.name,
            )
        db.commit()
    except Exception as e:
        logger.warning(f"Failed to post ledger entries for new order: {e}")

    db.refresh(order)

    try:
        from routers.customers import _upsert_customer_from_order
        import json as _json
        items_snapshot = _json.dumps([
            {"product_name": it.product_name, "quantity": it.quantity, "unit_price": it.unit_price}
            for it in order.items
        ])
        _upsert_customer_from_order(db, order, items_snapshot)
        db.commit()
    except Exception:
        pass  # Never block order creation for address book errors

    # ── Audit log ──────────────────────────────────────────────────────────────
    try:
        from routers.audit_log import log_action
        item_names = ", ".join(f"{it.product_name} x{it.quantity}" for it in order.items)
        log_action(db, current_user, "create", "order", order.id, order.order_number,
                   f"Order created for {order.customer_name} | Items: {item_names} | Total: PKR {order.total_amount:,.0f}")
        db.commit()
    except Exception:
        pass

    return order


def restock_order_inventory(db: Session, order: models.Order, created_by: str = "System", note: str = "Order return"):
    """Credit stock back to inventory when an order is cancelled or returned."""
    if getattr(order, "is_restocked", False):
        return

    for item in order.items:
        product = None
        if item.product_id:
            product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if not product:
            product = db.query(models.Product).filter(models.Product.name.ilike(f"%{item.product_name}%")).first()

        if product:
            target_product = product
            if product.base_product_id:
                base_p = db.query(models.Product).filter(models.Product.id == product.base_product_id).first()
                if base_p:
                    target_product = base_p

            multiplier = product.unit_multiplier or 1.0
            return_qty = item.quantity * multiplier

            target_product.stock_qty += return_qty
            movement = models.StockMovement(
                product_id=target_product.id,
                order_id=order.id,
                movement_type="return",
                quantity_change=return_qty,
                quantity_after=target_product.stock_qty,
                note=f"Restocked {item.quantity}x {product.name} ({multiplier} units/pack) via {note} (#{order.order_number})",
                created_by=created_by,
                created_at=datetime.utcnow(),
            )
            db.add(movement)

    order.is_restocked = True


@router.post("/{order_id}/complete-delivery", response_model=schemas.OrderOut)
def complete_delivery(
    order_id: int,
    data: schemas.DeliveryCompletion,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Close an order with one delivery outcome and one payment outcome."""
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "out_for_delivery":
        raise HTTPException(status_code=400, detail="Only out-for-delivery orders can be completed")
    if data.outcome not in ("delivered", "returned"):
        raise HTTPException(status_code=400, detail="Outcome must be delivered or returned")
    if data.outcome == "delivered" and data.payment_method not in ("cod", "online", "credit"):
        raise HTTPException(status_code=400, detail="Choose COD, online, or credit payment")
    if data.amount_received < 0 or data.amount_received > order.total_amount:
        raise HTTPException(status_code=400, detail="Received amount must be between 0 and the amount due")
    if data.outcome == "delivered" and data.payment_method in ("cod", "online") and data.amount_received <= 0:
        raise HTTPException(status_code=400, detail="Enter the amount received for COD or online payment")

    now = datetime.utcnow()
    old_status = order.status
    order.status = data.outcome
    order.delivered_at = now
    if data.outcome == "returned":
        order.payment_status = "returned"
        order.amount_received = 0.0
        # Automatically refund inventory stock on return
        restock_order_inventory(db, order, current_user.name, note="Delivery Returned (RTS)")
    else:
        order.payment_method = data.payment_method
        order.amount_received = data.amount_received
        order.payment_status = "credit" if data.payment_method == "credit" else "received"
        if data.amount_received > 0:
            order.payment_received_at = now
    db.add(models.StatusHistory(order_id=order.id, old_status=old_status,
        new_status=data.outcome, changed_by=current_user.name, changed_at=now, note=data.note))
    db.commit()
    db.refresh(order)
    return order



@router.get("/", response_model=List[schemas.OrderOut])
def list_orders(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    source: Optional[str] = None,
    payment_status: Optional[str] = None,
    search: Optional[str] = None,
    date_filter: Optional[str] = None,  # today | yesterday | week | late
    limit: int = Query(200, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Order)

    if status:
        query = query.filter(models.Order.status == status)
    if priority:
        query = query.filter(models.Order.priority == priority)
    if source:
        query = query.filter(models.Order.source == source)
    if payment_status:
        query = query.filter(models.Order.payment_status == payment_status)
    if search:
        term = f"%{search}%"
        query = query.filter(
            or_(
                models.Order.customer_name.ilike(term),
                models.Order.customer_phone.ilike(term),
                models.Order.order_number.ilike(term),
                models.Order.city.ilike(term),
                models.Order.delivery_address.ilike(term),
                models.Order.assigned_rider_name.ilike(term),
            )
        )

    now = datetime.utcnow()
    if date_filter == "today":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        query = query.filter(models.Order.created_at >= today_start)
    elif date_filter == "yesterday":
        yesterday = now - timedelta(days=1)
        y_start = yesterday.replace(hour=0, minute=0, second=0, microsecond=0)
        y_end   = yesterday.replace(hour=23, minute=59, second=59, microsecond=999999)
        query = query.filter(models.Order.created_at.between(y_start, y_end))
    elif date_filter == "week":
        week_start = now - timedelta(days=7)
        query = query.filter(models.Order.created_at >= week_start)
    elif date_filter == "late":
        query = query.filter(
            models.Order.status == "ready_to_ship",
            models.Order.pickup_deadline < now,
        )

    orders = (
        query.order_by(models.Order.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return orders


@router.get("/{order_id}", response_model=schemas.OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.put("/{order_id}", response_model=schemas.OrderOut)
def update_order(
    order_id: int,
    data: schemas.OrderUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    old_status = order.status
    update_data = data.model_dump(exclude_unset=True)
    items_data = update_data.pop("items", None)

    if "delivery_date" in update_data and isinstance(update_data["delivery_date"], str):
        try:
            update_data["delivery_date"] = datetime.fromisoformat(update_data["delivery_date"].replace("Z", "+00:00"))
        except Exception:
            update_data["delivery_date"] = None

    for field, value in update_data.items():
        setattr(order, field, value)

    if items_data is not None:
        db.query(models.OrderItem).filter(models.OrderItem.order_id == order.id).delete()
        new_total = 0.0
        for item_in in items_data:
            u_price = item_in.get("unit_price", 0.0) or 0.0
            qty = item_in.get("quantity", 1) or 1
            t_price = u_price * qty
            new_total += t_price
            new_item = models.OrderItem(
                order_id=order.id,
                product_id=item_in.get("product_id"),
                product_name=item_in.get("product_name", ""),
                quantity=qty,
                unit_price=u_price,
                total_price=t_price,
            )
            db.add(new_item)
        if "total_amount" not in update_data:
            order.total_amount = new_total

    if data.status and data.status != old_status:
        now = datetime.utcnow()
        if data.status == "delivered" and not order.delivered_at:
            order.delivered_at = now
        db.add(models.StatusHistory(
            order_id=order.id,
            old_status=old_status,
            new_status=data.status,
            changed_by=current_user.name,
            changed_at=now,
            note="Updated via Order Edit",
        ))

    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/status", response_model=schemas.OrderOut)
def update_status(
    order_id: int,
    data: schemas.StatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    allowed = TRANSITIONS.get(order.status, [])
    if data.new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move from '{order.status}' to '{data.new_status}'. "
                   f"Allowed: {allowed}",
        )

    now = datetime.utcnow()
    old_status = order.status
    order.status = data.new_status

    # ── Auto-save timestamps based on new status ───────────────────────────────
    if data.new_status == "ready_to_ship":
        order.rts_at = now
        order.pickup_deadline = now + timedelta(minutes=SLA_MINUTES)
        # Reset SLA flags (in case re-activated)
        order.sla_alert_1_sent = False
        order.sla_alert_2_sent = False
        order.sla_manager_sent = False
        order.sla_owner_sent = False

    elif data.new_status == "out_for_delivery":
        order.pickup_at = now

    elif data.new_status == "delivered":
        order.delivered_at = now

    elif data.new_status in ("returned", "cancelled"):
        restock_order_inventory(db, order, current_user.name, note=f"Status changed to {data.new_status.title()}")

    history = models.StatusHistory(
        order_id=order.id,
        old_status=old_status,
        new_status=data.new_status,
        changed_by=current_user.name,
        changed_at=now,
        note=data.note,
    )
    db.add(history)
    db.commit()

    # ── WhatsApp dispatch notification (B2C only, best-effort) ───────────────
    if data.new_status == "out_for_delivery" and getattr(order, "channel", "b2c") == "b2c":
        _notify_b2c_dispatch(order)

    db.refresh(order)
    return order


# ─── Bulk RTS / Fast Packaging RTS ───────────────────────────────────────────

@router.post("/bulk-rts")
def bulk_rts(
    data: schemas.BulkRtsRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Fast Packaging RTS Endpoint.
    Marks all pending orders (or specific order_ids) as 'ready_to_ship' in bulk.
    """
    now = datetime.utcnow()
    query = db.query(models.Order)

    if data.order_ids and len(data.order_ids) > 0:
        query = query.filter(models.Order.id.in_(data.order_ids))
    else:
        query = query.filter(models.Order.status == "pending")

    orders = query.all()
    count = 0
    for o in orders:
        if o.status == "pending":
            old_s = o.status
            o.status = "ready_to_ship"
            o.rts_at = now
            o.pickup_deadline = now + timedelta(minutes=SLA_MINUTES)
            o.sla_alert_1_sent = False
            o.sla_alert_2_sent = False
            o.sla_manager_sent = False
            o.sla_owner_sent = False

            db.add(models.StatusHistory(
                order_id=o.id,
                old_status=old_s,
                new_status="ready_to_ship",
                changed_by=current_user.name,
                changed_at=now,
                note=data.note or "Bulk Fast RTS",
            ))
            count += 1

    db.commit()

    try:
        from sla_engine import broadcast_ws_message
        broadcast_ws_message({
            "type": "sla_alert",
            "order_number": f"{count} Orders",
            "customer_name": "Bulk Fast RTS Complete",
            "notification_type": "info",
            "message": f"Packaging complete for {count} orders by {current_user.name}",
            "timestamp": now.isoformat(),
        })
    except Exception:
        pass

    return {"message": f"Successfully updated {count} orders to Ready To Ship (RTS)", "count": count}


# ─── Rider Management & Gate Pass Dispatch ────────────────────────────────────

@router.get("/riders/summary")
def get_riders_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Rider Details & COD Cash Collection Summary.
    Group orders by assigned rider name, calculating COD amounts to bring back.
    """
    orders = db.query(models.Order).filter(models.Order.status.in_(["ready_to_ship", "out_for_delivery", "delivered"])).all()
    riders_map = {}

    # Also list all user accounts with role 'rider'
    rider_users = db.query(models.User).filter(models.User.role == "rider").all()
    for ru in rider_users:
        riders_map[ru.name] = {
            "rider_id": ru.id,
            "rider_name": ru.name,
            "username": ru.username,
            "email": ru.email,
            "assigned_count": 0,
            "rts_count": 0,
            "out_count": 0,
            "delivered_count": 0,
            "total_cod_amount": 0.0,
            "cod_collected_amount": 0.0,
            "orders": [],
        }

    for o in orders:
        rname = o.assigned_rider_name or "Unassigned Rider"
        if rname not in riders_map:
            riders_map[rname] = {
                "rider_id": None,
                "rider_name": rname,
                "username": None,
                "email": None,
                "assigned_count": 0,
                "rts_count": 0,
                "out_count": 0,
                "delivered_count": 0,
                "total_cod_amount": 0.0,
                "cod_collected_amount": 0.0,
                "orders": [],
            }

        rm = riders_map[rname]
        rm["assigned_count"] += 1
        if o.status == "ready_to_ship":
            rm["rts_count"] += 1
        elif o.status == "out_for_delivery":
            rm["out_count"] += 1
            if o.payment_method == "cod" or o.payment_status == "cod":
                rm["total_cod_amount"] += o.total_amount
        elif o.status == "delivered":
            rm["delivered_count"] += 1
            if o.payment_method == "cod" and o.payment_status in ("received", "delivered"):
                rm["cod_collected_amount"] += (o.amount_received or o.total_amount)

        rm["orders"].append({
            "id": o.id,
            "order_number": o.order_number,
            "customer_name": o.customer_name,
            "customer_phone": o.customer_phone,
            "delivery_address": o.delivery_address,
            "city": o.city,
            "status": o.status,
            "payment_method": o.payment_method or o.payment_status,
            "total_amount": o.total_amount,
            "gate_pass_no": o.gate_pass_no,
            "gate_pass_printed_at": o.gate_pass_printed_at.isoformat() if o.gate_pass_printed_at else None,
        })

    return list(riders_map.values())


@router.post("/gate-pass/dispatch")
def dispatch_gate_pass(
    req: schemas.GatePassRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Gate Pass Dispatch:
    Filter per rider, select orders, print gate passes, and mark orders 'out_for_delivery'!
    Prepares automatic rider notification log entries.
    """
    now = datetime.utcnow()
    orders = db.query(models.Order).filter(models.Order.id.in_(req.order_ids)).all()
    if not orders:
        raise HTTPException(status_code=404, detail="No valid orders found for Gate Pass")

    gate_pass_no = f"GP-{now.year}{now.month:02d}-{now.strftime('%H%M%S')}"

    updated_count = 0
    total_cod = 0.0
    for o in orders:
        old_s = o.status
        o.assigned_rider_name = req.rider_name
        o.status = "out_for_delivery"
        o.pickup_at = now
        o.gate_pass_no = gate_pass_no
        o.gate_pass_printed_at = now

        if o.payment_method == "cod" or o.payment_status == "cod":
            total_cod += o.total_amount

        db.add(models.StatusHistory(
            order_id=o.id,
            old_status=old_s,
            new_status="out_for_delivery",
            changed_by=current_user.name,
            changed_at=now,
            note=f"Gate Pass #{gate_pass_no} printed. Dispatched to Rider {req.rider_name}.",
        ))
        updated_count += 1

    # Log rider notification dispatch entry (Future automated WhatsApp/SMS hook)
    db.add(models.NotificationLog(
        notification_type="rider_update",
        subject=f"GATE_PASS_PRINTED_{gate_pass_no}",
        recipient=req.rider_name,
        message=(
            f"Gate Pass {gate_pass_no} printed for {req.rider_name} with {updated_count} orders. "
            f"Total COD to collect: PKR {total_cod:,.0f}. Orders set to Out For Delivery."
        ),
        delivery_status="logged",
        sent_at=now,
    ))

    db.commit()

    # ── WhatsApp dispatch notifications — one per B2C order in this gate pass ─
    for _o in orders:
        if getattr(_o, "channel", "b2c") == "b2c":
            _notify_b2c_dispatch(_o)

    try:
        from sla_engine import broadcast_ws_message
        broadcast_ws_message({
            "type": "sla_alert",
            "order_number": gate_pass_no,
            "customer_name": f"Gate Pass - {req.rider_name}",
            "notification_type": "info",
            "message": f"Dispatched {updated_count} orders to {req.rider_name}. Total COD: PKR {total_cod:,.0f}",
            "timestamp": now.isoformat(),
        })
    except Exception:
        pass

    return {
        "gate_pass_no": gate_pass_no,
        "rider_name": req.rider_name,
        "vehicle_number": req.vehicle_number or "N/A",
        "orders_count": updated_count,
        "total_cod_amount": total_cod,
        "printed_at": now.isoformat(),
        "message": f"Gate Pass {gate_pass_no} created! {updated_count} orders updated to Out for Delivery.",
    }


@router.delete("/{order_id}")
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can delete orders")
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Clear Foreign Key dependencies
    db.query(models.StockMovement).filter(models.StockMovement.order_id == order_id).update({models.StockMovement.order_id: None}, synchronize_session=False)
    db.query(models.LedgerEntry).filter(models.LedgerEntry.related_order_id == order_id).update({models.LedgerEntry.related_order_id: None}, synchronize_session=False)
    db.query(models.AccountInvoice).filter(models.AccountInvoice.related_order_id == order_id).update({models.AccountInvoice.related_order_id: None}, synchronize_session=False)
    db.query(models.CustomerAttachment).filter(models.CustomerAttachment.order_id == order_id).update({models.CustomerAttachment.order_id: None}, synchronize_session=False)
    db.query(models.ChatMessage).filter(models.ChatMessage.order_id == order_id).update({models.ChatMessage.order_id: None}, synchronize_session=False)
    db.query(models.NotificationLog).filter(models.NotificationLog.order_id == order_id).delete(synchronize_session=False)
    db.query(models.NotificationLog).filter(models.NotificationLog.related_order_id == order_id).update({models.NotificationLog.related_order_id: None}, synchronize_session=False)
    db.query(models.StatusHistory).filter(models.StatusHistory.order_id == order_id).delete(synchronize_session=False)
    db.query(models.OrderItem).filter(models.OrderItem.order_id == order_id).delete(synchronize_session=False)

    order_num = order.order_number
    cust_name = order.customer_name
    db.delete(order)
    db.commit()

    try:
        from routers.audit_log import log_action
        log_action(db, current_user, "delete", "order", order_id, order_num,
                   f"Deleted order #{order_num} for customer: {cust_name}")
        db.commit()
    except Exception:
        pass

    return {"message": f"Order #{order_num} deleted successfully"}
