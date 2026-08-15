import io
import csv
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
import models
from auth import get_current_user

router = APIRouter(prefix="/api/tracking", tags=["tracking"])


class LocationUpdate(BaseModel):
    latitude: float
    longitude: float
    battery: Optional[int] = None


class SheetOrderInput(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = ""
    delivery_address: Optional[str] = ""
    city: Optional[str] = "Lahore"
    source: Optional[str] = "google_sheets"
    priority: Optional[str] = "normal"
    items: Optional[str] = "Organic Desi Ghee 500g"
    total_amount: Optional[float] = 0.0


@router.post("/location")
def update_rider_location(
    data: LocationUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rider updates their real-time GPS location (HTML5 Geolocation)."""
    loc = db.query(models.RiderLocation).filter(models.RiderLocation.rider_id == current_user.id).first()
    now = datetime.utcnow()

    if loc:
        loc.latitude = data.latitude
        loc.longitude = data.longitude
        loc.battery = data.battery
        loc.updated_at = now
    else:
        loc = models.RiderLocation(
            rider_id=current_user.id,
            rider_name=current_user.name,
            latitude=data.latitude,
            longitude=data.longitude,
            battery=data.battery,
            updated_at=now,
        )
        db.add(loc)

    db.commit()

    # Broadcast rider location over WebSockets to Manager Dashboard Map
    from main import manager
    import asyncio

    try:
        payload = {
            "type": "rider_location",
            "rider_id": current_user.id,
            "rider_name": current_user.name,
            "latitude": data.latitude,
            "longitude": data.longitude,
            "battery": data.battery,
            "updated_at": now.isoformat(),
        }
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(manager.broadcast(payload))
    except Exception as e:
        print("WebSocket broadcast rider location error:", e)

    return {"status": "ok", "updated_at": now.isoformat()}


@router.get("/riders")
def get_active_rider_locations(db: Session = Depends(get_db)):
    """Fetch latest GPS positions of all active riders for the map."""
    locations = db.query(models.RiderLocation).all()
    res = []
    for loc in locations:
        res.append({
            "rider_id": loc.rider_id,
            "rider_name": loc.rider_name,
            "latitude": loc.latitude,
            "longitude": loc.longitude,
            "battery": loc.battery,
            "updated_at": loc.updated_at.isoformat() if loc.updated_at else None,
        })
    return res


@router.get("/export-csv")
def export_google_sheets_csv(db: Session = Depends(get_db)):
    """Generates a Google-Sheets compatible CSV export of all orders."""
    orders = db.query(models.Order).order_by(models.Order.id.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)

    # Headers for Google Sheets
    writer.writerow([
        "Order Number", "Customer Name", "Phone", "City", "Address",
        "Status", "Priority", "Payment", "Total Amount (PKR)",
        "Created At", "Packed (RTS) At", "Pickup At", "Delivered At", "Assigned Rider"
    ])

    for o in orders:
        writer.writerow([
            o.order_number,
            o.customer_name,
            o.customer_phone or "",
            o.city or "",
            o.delivery_address or "",
            o.status,
            o.priority,
            o.payment_status,
            o.total_amount,
            o.created_at.strftime("%Y-%m-%d %H:%M:%S") if o.created_at else "",
            o.rts_at.strftime("%Y-%m-%d %H:%M:%S") if o.rts_at else "",
            o.pickup_at.strftime("%Y-%m-%d %H:%M:%S") if o.pickup_at else "",
            o.delivered_at.strftime("%Y-%m-%d %H:%M:%S") if o.delivered_at else "",
            o.assigned_rider_name or "",
        ])

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=navaal_orders_{datetime.now().strftime('%Y%m%d')}.csv"}
    )


@router.post("/webhook/google-sheets")
def google_sheets_incoming_order_webhook(data: SheetOrderInput, db: Session = Depends(get_db)):
    """Webhook endpoint to create an order directly from Google Sheets / Apps Script / CRM."""
    count = db.query(models.Order).count() + 1
    order_num = f"NOF-GS-{count:04d}"

    order = models.Order(
        order_number=order_num,
        customer_name=data.customer_name,
        customer_phone=data.customer_phone,
        delivery_address=data.delivery_address,
        city=data.city,
        source=data.source or "google_sheets",
        status="pending",
        priority=data.priority or "normal",
        total_amount=data.total_amount or 0.0,
        created_at=datetime.utcnow(),
    )
    db.add(order)
    db.flush()

    if data.items:
        db.add(models.OrderItem(
            order_id=order.id,
            product_name=data.items,
            quantity=1,
            unit_price=data.total_amount or 0.0,
            total_price=data.total_amount or 0.0,
        ))

    db.commit()
    return {"status": "success", "order_number": order_num, "order_id": order.id}
