"""
Customer Address Book Router
Endpoints:
  GET  /api/customers        — search/list customers (autocomplete)
  POST /api/customers        — create/upsert customer
  PUT  /api/customers/{id}   — update customer profile
  DELETE /api/customers/{id} — delete customer
  POST /api/customers/sync   — sync address book from existing orders (admin)
"""
import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from database import get_db
import models, schemas
from auth import get_current_user

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _upsert_customer_from_order(db: Session, order: models.Order, items_json: Optional[str] = None):
    """
    Called after an order is placed/completed to keep the address book up to date.
    Matches by phone (preferred) then by name.
    """
    customer = None
    if order.customer_phone:
        customer = db.query(models.Customer).filter(
            models.Customer.phone == order.customer_phone
        ).first()
    if not customer:
        customer = db.query(models.Customer).filter(
            models.Customer.name.ilike(order.customer_name.strip())
        ).first()

    if customer:
        customer.name = order.customer_name
        if order.customer_phone:
            customer.phone = order.customer_phone
        if order.delivery_address:
            customer.delivery_address = order.delivery_address
        if order.city:
            customer.city = order.city
        if order.assigned_rider_name:
            customer.preferred_rider = order.assigned_rider_name
        if items_json:
            customer.last_items_json = items_json
        if order.total_amount:
            customer.last_order_total = order.total_amount
        customer.order_count = (customer.order_count or 0) + 1
    else:
        customer = models.Customer(
            name=order.customer_name,
            phone=order.customer_phone,
            delivery_address=order.delivery_address,
            city=order.city,
            preferred_rider=order.assigned_rider_name,
            last_items_json=items_json,
            last_order_total=order.total_amount,
            order_count=1,
        )
        db.add(customer)
    return customer


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("", response_model=List[schemas.CustomerOut])
def list_customers(
    q: Optional[str] = Query(None, description="Search by name or phone"),
    limit: int = Query(20, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Search customers for autocomplete — returns matching name/phone records."""
    query = db.query(models.Customer)
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            (models.Customer.name.ilike(pattern)) |
            (models.Customer.phone.ilike(pattern)) |
            (models.Customer.city.ilike(pattern))
        )
    return query.order_by(models.Customer.order_count.desc()).limit(limit).all()


@router.post("", response_model=schemas.CustomerOut)
def create_or_update_customer(
    data: schemas.CustomerCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Manually create or update a customer in the address book."""
    # Try to find existing by phone, then name
    customer = None
    if data.phone:
        customer = db.query(models.Customer).filter(models.Customer.phone == data.phone).first()
    if not customer:
        customer = db.query(models.Customer).filter(
            models.Customer.name.ilike(data.name.strip())
        ).first()

    if customer:
        for field, value in data.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(customer, field, value)
    else:
        customer = models.Customer(**data.model_dump())
        db.add(customer)

    db.commit()
    db.refresh(customer)
    return customer


@router.put("/{customer_id}", response_model=schemas.CustomerOut)
def update_customer(
    customer_id: int,
    data: schemas.CustomerCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


@router.delete("/{customer_id}")
def delete_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")
    customer = db.query(models.Customer).filter(models.Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    db.delete(customer)
    db.commit()
    return {"message": "Customer deleted"}


@router.post("/sync")
def sync_customers_from_orders(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Admin utility: Build the address book from all existing historical orders."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can sync")

    orders = db.query(models.Order).order_by(models.Order.created_at.asc()).all()
    synced = 0
    for order in orders:
        items_data = [
            {"product_name": it.product_name, "quantity": it.quantity, "unit_price": it.unit_price}
            for it in order.items
        ] if order.items else []
        _upsert_customer_from_order(db, order, json.dumps(items_data) if items_data else None)
        synced += 1

    db.commit()
    return {"message": f"Synced address book from {synced} orders."}
