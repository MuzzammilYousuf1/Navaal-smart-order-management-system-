from typing import List, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import get_db
import models
import schemas
from auth import get_current_user

router = APIRouter(prefix="/api/orders", tags=["orders"])

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
    count = db.query(models.Order).count() + 1
    now = datetime.utcnow()
    return f"NOF-{now.year}-{count:04d}"


@router.post("/", response_model=schemas.OrderOut)
def create_order(
    data: schemas.OrderCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    order_number = _generate_order_number(db)
    total = sum(item.unit_price * item.quantity for item in data.items)

    order = models.Order(
        order_number=order_number,
        customer_name=data.customer_name,
        customer_phone=data.customer_phone,
        delivery_address=data.delivery_address,
        city=data.city,
        location_url=data.location_url,
        source=data.source,
        priority=data.priority,
        payment_status=data.payment_status,
        payment_method=data.payment_status if data.payment_status in ("cod", "online", "credit") else "cod",
        notes=data.notes,
        assigned_rider_name=data.assigned_rider_name,
        total_amount=total,
        assigned_staff_id=current_user.id,
        created_at=datetime.utcnow(),
    )
    db.add(order)
    db.flush()

    for item_data in data.items:
        item = models.OrderItem(
            order_id=order.id,
            product_id=item_data.product_id,
            product_name=item_data.product_name,
            quantity=item_data.quantity,
            unit_price=item_data.unit_price,
            total_price=item_data.unit_price * item_data.quantity,
        )
        db.add(item)

        # ── Auto-deduct stock from inventory ──────────────────────────────────
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
            # If item is linked to a bulk base product (e.g. Pack of 30 -> Loose Eggs)
            target_product = product
            if product.base_product_id:
                base_p = db.query(models.Product).filter(models.Product.id == product.base_product_id).first()
                if base_p:
                    target_product = base_p

            multiplier = product.unit_multiplier or 1
            deduct_qty = item_data.quantity * multiplier

            if target_product.stock_qty >= deduct_qty:
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

                # Low stock alert
                if target_product.stock_qty <= target_product.low_stock_threshold:
                    db.add(models.NotificationLog(
                        notification_type="low_stock",
                        subject=f"LOW_STOCK_{target_product.sku}",
                        recipient="Warehouse Manager",
                        message=(
                            f"LOW STOCK: {target_product.name} now has only "
                            f"{target_product.stock_qty} {target_product.unit}s remaining after order "
                            f"{order_number}. Threshold is {target_product.low_stock_threshold}."
                        ),
                        delivery_status="logged",
                    ))
            else:
                # Stock insufficient — log warning
                db.add(models.NotificationLog(
                    notification_type="stock_warning",
                    subject=f"INSUFFICIENT_STOCK_{target_product.sku}",
                    recipient="Warehouse Manager",
                    message=(
                        f"STOCK WARNING: Order {order_number} requested "
                        f"{item_data.quantity}x {product.name} ({deduct_qty} {target_product.unit}s) but only "
                        f"{target_product.stock_qty} {target_product.unit}s available in bulk stock."
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
    db.refresh(order)

    # ── Auto-save customer to address book ────────────────────────────────────
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

    return order


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
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(order, field, value)

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
    db.refresh(order)
    return order


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
    db.delete(order)
    db.commit()
    return {"message": "Order deleted"}
