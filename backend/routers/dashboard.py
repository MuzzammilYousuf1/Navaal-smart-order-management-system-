from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
import models
import schemas
from auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def safe_avg_minutes(value_seconds) -> Optional[float]:
    if value_seconds is None:
        return None
    return round(value_seconds / 60, 1)


@router.get("/stats", response_model=schemas.DashboardStats)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Today's orders
    today_orders = (
        db.query(models.Order)
        .filter(models.Order.created_at >= today_start)
        .all()
    )
    total_today = len(today_orders)

    # Counts by status
    def count_status(s):
        return db.query(func.count(models.Order.id)).filter(models.Order.status == s).scalar() or 0

    pending = count_status("pending")
    rts = count_status("ready_to_ship")
    otd = count_status("out_for_delivery")

    delivered_today = (
        db.query(func.count(models.Order.id))
        .filter(
            models.Order.status == "delivered",
            models.Order.delivered_at >= today_start,
        )
        .scalar() or 0
    )

    cancelled_today = (
        db.query(func.count(models.Order.id))
        .filter(
            models.Order.status == "cancelled",
            models.Order.created_at >= today_start,
        )
        .scalar() or 0
    )

    late_orders = (
        db.query(func.count(models.Order.id))
        .filter(
            models.Order.status == "ready_to_ship",
            models.Order.pickup_deadline < now,
        )
        .scalar() or 0
    )

    # Revenue (delivered today)
    revenue_today = (
        db.query(func.sum(models.Order.total_amount))
        .filter(
            models.Order.status == "delivered",
            models.Order.delivered_at >= today_start,
        )
        .scalar() or 0.0
    )

    # Avg packing time: created_at → rts_at
    avg_packing_raw = (
        db.query(
            func.avg(
                func.strftime('%s', models.Order.rts_at) -
                func.strftime('%s', models.Order.created_at)
            )
        )
        .filter(
            models.Order.rts_at.isnot(None),
            models.Order.created_at >= today_start - timedelta(days=7),
        )
        .scalar()
    )

    # Avg pickup time: rts_at → pickup_at
    avg_pickup_raw = (
        db.query(
            func.avg(
                func.strftime('%s', models.Order.pickup_at) -
                func.strftime('%s', models.Order.rts_at)
            )
        )
        .filter(
            models.Order.pickup_at.isnot(None),
            models.Order.rts_at.isnot(None),
            models.Order.created_at >= today_start - timedelta(days=7),
        )
        .scalar()
    )

    # Avg delivery time: pickup_at → delivered_at
    avg_delivery_raw = (
        db.query(
            func.avg(
                func.strftime('%s', models.Order.delivered_at) -
                func.strftime('%s', models.Order.pickup_at)
            )
        )
        .filter(
            models.Order.delivered_at.isnot(None),
            models.Order.pickup_at.isnot(None),
            models.Order.created_at >= today_start - timedelta(days=7),
        )
        .scalar()
    )

    return schemas.DashboardStats(
        total_today=total_today,
        pending=pending,
        ready_to_ship=rts,
        out_for_delivery=otd,
        delivered_today=delivered_today,
        cancelled_today=cancelled_today,
        late_orders=late_orders,
        revenue_today=float(revenue_today),
        avg_packing_time_min=safe_avg_minutes(avg_packing_raw),
        avg_pickup_time_min=safe_avg_minutes(avg_pickup_raw),
        avg_delivery_time_min=safe_avg_minutes(avg_delivery_raw),
    )


@router.get("/live-orders")
def get_live_orders(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Returns all active (non-terminal) orders for live dashboard tables."""
    now = datetime.utcnow()
    orders = (
        db.query(models.Order)
        .filter(models.Order.status.notin_(["delivered", "cancelled"]))
        .order_by(models.Order.created_at.desc())
        .limit(200)
        .all()
    )

    result = []
    for o in orders:
        remaining_seconds = None
        is_late = False
        if o.pickup_deadline and o.status == "ready_to_ship":
            remaining_seconds = (o.pickup_deadline - now).total_seconds()
            is_late = remaining_seconds < 0

        result.append({
            "id": o.id,
            "order_number": o.order_number,
            "customer_name": o.customer_name,
            "customer_phone": o.customer_phone,
            "city": o.city,
            "status": o.status,
            "priority": o.priority,
            "payment_status": o.payment_status,
            "total_amount": o.total_amount,
            "assigned_rider_name": o.assigned_rider_name,
            "created_at": o.created_at.isoformat() if o.created_at else None,
            "rts_at": o.rts_at.isoformat() if o.rts_at else None,
            "pickup_deadline": o.pickup_deadline.isoformat() if o.pickup_deadline else None,
            "pickup_at": o.pickup_at.isoformat() if o.pickup_at else None,
            "remaining_seconds": remaining_seconds,
            "is_late": is_late,
        })
    return result
