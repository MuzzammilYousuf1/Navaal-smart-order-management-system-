"""
Subscriptions Router
Handles recurring customer delivery plans.

Endpoints:
  GET  /api/subscriptions                  — list all subscriptions
  POST /api/subscriptions                  — create subscription
  PUT  /api/subscriptions/{id}             — update subscription
  DELETE /api/subscriptions/{id}           — delete/deactivate
  POST /api/subscriptions/generate-today   — manually trigger today's order generation
  GET  /api/subscriptions/n8n/due          — n8n webhook: returns subscriptions due today
"""
import json
from datetime import datetime, date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db, SessionLocal
import models, schemas
from auth import get_current_user

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _next_date_for_frequency(frequency: str, from_date: Optional[date] = None) -> datetime:
    base = from_date or date.today()
    if frequency == "daily":
        return datetime.combine(base + timedelta(days=1), datetime.min.time())
    elif frequency == "every_other_day":
        return datetime.combine(base + timedelta(days=2), datetime.min.time())
    elif frequency == "weekly":
        return datetime.combine(base + timedelta(weeks=1), datetime.min.time())
    else:
        return datetime.combine(base + timedelta(days=1), datetime.min.time())


def _build_order_from_subscription(sub: models.Subscription, db: Session) -> models.Order:
    """Create an Order record from a Subscription plan."""
    count = db.query(models.Order).count() + 1
    now = datetime.utcnow()
    order_number = f"SUB-{now.year}-{count:04d}"

    items_data = json.loads(sub.items_json)
    total = sum(it["quantity"] * it["unit_price"] for it in items_data)

    order = models.Order(
        order_number=order_number,
        customer_name=sub.customer_name,
        customer_phone=sub.customer_phone,
        delivery_address=sub.delivery_address,
        city=sub.city,
        source="subscription",
        priority="normal",
        payment_status="cod",
        payment_method=sub.payment_method,
        total_amount=total,
        assigned_rider_name=sub.assigned_rider_name,
        notes=f"[AUTO] Subscription Order{(' — ' + sub.notes) if sub.notes else ''}",
        status="pending",
        created_at=now,
    )
    db.add(order)
    db.flush()

    for it in items_data:
        db.add(models.OrderItem(
            order_id=order.id,
            product_name=it["product_name"],
            quantity=it["quantity"],
            unit_price=it["unit_price"],
            total_price=it["quantity"] * it["unit_price"],
        ))

    db.add(models.StatusHistory(
        order_id=order.id,
        old_status=None,
        new_status="pending",
        changed_by="[Subscription Auto-Generate]",
        changed_at=now,
        note=f"Auto-generated from Subscription #{sub.id}",
    ))
    return order


def generate_subscription_orders(db: Optional[Session] = None):
    """
    Called by the scheduler (or manually) to generate today's subscription orders.
    Creates orders for all active subscriptions whose next_delivery_date <= today.
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        due = db.query(models.Subscription).filter(
            models.Subscription.is_active == True,
            models.Subscription.next_delivery_date <= today + timedelta(days=1),
        ).all()

        created = 0
        for sub in due:
            _build_order_from_subscription(sub, db)
            sub.last_generated_at = datetime.utcnow()
            sub.next_delivery_date = _next_date_for_frequency(sub.frequency)
            created += 1

        db.commit()
        return created
    finally:
        if close_db:
            db.close()


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[schemas.SubscriptionOut])
def list_subscriptions(
    active_only: bool = True,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Subscription)
    if active_only:
        q = q.filter(models.Subscription.is_active == True)
    return q.order_by(models.Subscription.customer_name).all()


@router.post("", response_model=schemas.SubscriptionOut)
def create_subscription(
    data: schemas.SubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager", "operations"):
        raise HTTPException(status_code=403, detail="Not authorized")

    items_list = [it.model_dump() for it in data.items]
    total = sum(it["quantity"] * it["unit_price"] for it in items_list)

    next_delivery = data.next_delivery_date or _next_date_for_frequency(
        data.frequency, date.today()
    )

    sub = models.Subscription(
        customer_name=data.customer_name,
        customer_phone=data.customer_phone,
        delivery_address=data.delivery_address,
        city=data.city,
        frequency=data.frequency,
        items_json=json.dumps(items_list),
        total_amount=total,
        payment_method=data.payment_method,
        assigned_rider_name=data.assigned_rider_name,
        notes=data.notes,
        is_active=True,
        next_delivery_date=next_delivery,
        created_by=current_user.name,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@router.put("/{sub_id}", response_model=schemas.SubscriptionOut)
def update_subscription(
    sub_id: int,
    data: schemas.SubscriptionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    update_data = data.model_dump(exclude_unset=True)

    if "items" in update_data and update_data["items"] is not None:
        items_list = [it.model_dump() for it in data.items]
        sub.items_json = json.dumps(items_list)
        sub.total_amount = sum(it["quantity"] * it["unit_price"] for it in items_list)
        del update_data["items"]

    for field, value in update_data.items():
        if value is not None:
            setattr(sub, field, value)

    db.commit()
    db.refresh(sub)
    return sub


@router.delete("/{sub_id}")
def delete_subscription(
    sub_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")
    sub = db.query(models.Subscription).filter(models.Subscription.id == sub_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    # Soft-delete: deactivate instead of delete
    sub.is_active = False
    db.commit()
    return {"message": "Subscription deactivated"}


@router.post("/generate-today")
def trigger_generate_today(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Manually generate today's subscription orders (use each morning or let auto-run)."""
    if current_user.role not in ("admin", "manager", "operations"):
        raise HTTPException(status_code=403, detail="Not authorized")
    created = generate_subscription_orders(db)
    return {"message": f"Generated {created} subscription order(s) for today."}


@router.get("/n8n/due")
def n8n_due_subscriptions(
    db: Session = Depends(get_db),
):
    """
    n8n Webhook endpoint — no auth required (call from n8n HTTP Request node).
    Returns subscriptions due today so n8n can send WhatsApp/SMS reminders.
    """
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    due = db.query(models.Subscription).filter(
        models.Subscription.is_active == True,
        models.Subscription.next_delivery_date <= today + timedelta(days=1),
    ).all()

    return [
        {
            "id": s.id,
            "customer_name": s.customer_name,
            "customer_phone": s.customer_phone,
            "city": s.city,
            "delivery_address": s.delivery_address,
            "frequency": s.frequency,
            "items": json.loads(s.items_json),
            "total_amount": s.total_amount,
            "payment_method": s.payment_method,
            "assigned_rider": s.assigned_rider_name,
            "next_delivery_date": s.next_delivery_date.isoformat() if s.next_delivery_date else None,
        }
        for s in due
    ]
