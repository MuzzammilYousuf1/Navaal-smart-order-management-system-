"""Order-only CSV import/export. Kept separate from destructive data management."""
import csv
import io
import re
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
import models
from auth import get_current_user

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _value(row: dict, *names: str) -> str:
    normalized = {re.sub(r"[^a-z0-9]", "", str(k).lower()): (v or "").strip() for k, v in row.items()}
    for name in names:
        value = normalized.get(re.sub(r"[^a-z0-9]", "", name.lower()), "")
        if value:
            return value
    return ""


def _number(value: str, default: float = 0.0) -> float:
    try:
        return float(re.sub(r"[^0-9.\-]", "", value or "") or default)
    except ValueError:
        return default


def _date(value: str) -> datetime:
    for fmt in ("%d-%m-%y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(value.strip(), fmt)
        except (ValueError, AttributeError):
            pass
    return datetime.utcnow()


def _payment(value: str) -> tuple[str, str]:
    value = (value or "").strip().lower()
    if value in ("paid", "cash", "received"):
        return "received", "cash"
    if value in ("credit", "unpaid"):
        return "credit", "credit"
    if value in ("returned", "return"):
        return "returned", "returned"
    return "cod", "cod"


@router.get("/template")
def order_csv_template():
    out = io.StringIO()
    csv.writer(out).writerow([
        "Date", "Invoice", "Customer", "Phone", "Location", "Channel", "Amount", "RIDER", "Payment", "Remarks",
        "Item_1", "Qty_1", "Price_1", "Item_2", "Qty_2", "Price_2", "Item_3", "Qty_3", "Price_3",
    ])
    out.seek(0)
    return StreamingResponse(io.BytesIO(out.getvalue().encode("utf-8-sig")), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="navaal_orders_template.csv"'})


@router.get("/export-csv")
def export_orders_csv(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role not in ("admin", "manager", "operations"):
        raise HTTPException(status_code=403, detail="Only management and operations can export orders")
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Date", "Invoice", "Customer", "Phone", "Location", "Channel", "Amount", "RIDER", "Payment", "Remarks", "Item_1", "Qty_1", "Price_1", "Item_2", "Qty_2", "Price_2", "Item_3", "Qty_3", "Price_3", "order_number", "status"])
    for order in db.query(models.Order).order_by(models.Order.created_at.asc()).all():
        values = [
            order.created_at.strftime("%d-%m-%Y") if order.created_at else "",
            "", order.customer_name, order.customer_phone or "", order.delivery_address or order.city or "",
            (order.source or "").upper(), order.total_amount or 0, order.assigned_rider_name or "",
            order.payment_status or "cod", order.notes or "",
        ]
        for item in (order.items or [])[:3]:
            values.extend([item.product_name, item.quantity, item.unit_price])
        while len(values) < 19:
            values.extend(["", "", ""])
        values.extend([order.order_number, order.status])
        writer.writerow(values)
    out.seek(0)
    filename = f"navaal_orders_{datetime.utcnow():%Y%m%d_%H%M}.csv"
    return StreamingResponse(io.BytesIO(out.getvalue().encode("utf-8-sig")), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/import-csv")
async def import_orders_csv(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    if current_user.role not in ("admin", "manager", "operations"):
        raise HTTPException(status_code=403, detail="Only management and operations can import orders")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")
    reader = csv.DictReader(io.StringIO((await file.read()).decode("utf-8-sig")))
    created, errors = 0, []
    for row_number, row in enumerate(reader, start=2):
        try:
            customer = _value(row, "Customer", "customer_name", "name")
            if not customer:
                raise ValueError("Customer is required")
            rider = _value(row, "RIDER", "rider", "rider_name") or None
            if rider:
                rider_user = db.query(models.User).filter(models.User.name.ilike(rider), models.User.role == "rider", models.User.is_active == True).first()
                if not rider_user:
                    raise ValueError("Rider must be an active Rider user account")
            payment_status, payment_method = _payment(_value(row, "Payment", "payment_status"))
            items = []
            for slot in ("1", "2", "3"):
                name = _value(row, f"Item_{slot}", f"Item{slot}", f"product_name_{slot}")
                if name:
                    qty = int(_number(_value(row, f"Qty_{slot}", f"Qty{slot}", f"quantity_{slot}"), 1))
                    price = _number(_value(row, f"Price_{slot}", f"Price{slot}", f"unit_price_{slot}"))
                    items.append((name, max(1, qty), price))
            total = _number(_value(row, "Amount", "total_amount", "total"))
            if items and total == 0:
                total = sum(qty * price for _, qty, price in items)
            order_number = _value(row, "order_number", "order_number") or f"NOF-{datetime.utcnow():%Y%m%d%H%M%S}-{row_number}"
            if db.query(models.Order).filter(models.Order.order_number == order_number).first():
                order_number = f"{order_number}-IMP{row_number}"
            order = models.Order(order_number=order_number, customer_name=customer, customer_phone=_value(row, "Phone", "phone") or None, delivery_address=_value(row, "Location", "address") or None, source=(_value(row, "Channel", "source") or "import").lower(), status=_value(row, "status") or "pending", payment_status=payment_status, payment_method=payment_method, total_amount=total, assigned_rider_name=rider, notes=_value(row, "Remarks", "notes") or None, assigned_staff_id=current_user.id, created_at=_date(_value(row, "Date", "date")))
            db.add(order)
            db.flush()
            for name, qty, price in items:
                db.add(models.OrderItem(order_id=order.id, product_name=name, quantity=qty, unit_price=price, total_price=qty * price))
            db.add(models.StatusHistory(order_id=order.id, old_status=None, new_status=order.status, changed_by=current_user.name, changed_at=datetime.utcnow(), note="CSV order import"))
            created += 1
        except Exception as exc:
            errors.append(f"Row {row_number}: {exc}")
    db.commit()
    return {"message": f"Import complete: {created} orders created.", "created": created, "errors": errors}
