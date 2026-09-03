"""
Data Management Router
Handles:
  - Clearing seed/dummy data
  - CSV import for Products
  - CSV import for Orders — auto-detects two formats:
      • B2B Sales format  (Date, INVOICE, Customer, Channel, Amount, RIDER, Payment, …)
      • Daily Orders format (Rider Name, Customer, Location, ORDER, ITEM, REMARKS)
      • Generic/template format (customer_name, product_name_1, qty_1, unit_price_1, …)
  - Unified CSV export (one file, re-importable)
  - CSV template downloads
"""
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

router = APIRouter(prefix="/api/data", tags=["data"])


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _norm_key(k: str) -> str:
    """Lowercase, strip, collapse whitespace/dashes/underscores and special filter icons."""
    return re.sub(r"[^a-zA-Z0-9]", "", (k or "")).lower().strip("\ufeff")


def _norm_row(row: dict) -> dict:
    """Return a new dict with all keys normalised."""
    return {_norm_key(k): (v or "").strip() for k, v in row.items() if k}


def _get(row: dict, *candidates, default="") -> str:
    """Return the first non-empty match for any of the normalised candidate keys."""
    for c in candidates:
        key = _norm_key(c)
        if key in row and row[key]:
            return row[key].strip()
    return default


def _detect_delimiter(text: str) -> str:
    first = text.splitlines()[0] if text else ""
    return ";" if first.count(";") > first.count(",") else ","


def _parse_float(s: str) -> float:
    try:
        return float(re.sub(r"[^\d.\-]", "", s or "0") or 0)
    except Exception:
        return 0.0


def _parse_int(s: str, fallback: int = 0) -> int:
    try:
        return int(float(re.sub(r"[^\d.\-]", "", s or str(fallback)) or fallback))
    except Exception:
        return fallback


def _parse_order_date(value: str) -> Optional[datetime]:
    """Parse common spreadsheet date formats without silently using today."""
    value = (value or "").strip()
    if not value:
        return None
    # Excel/Google Sheets exports commonly include a time after the date.
    for fmt in (
        "%d-%m-%y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y",
        "%d.%m.%Y", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y",
        "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M", "%d-%m-%Y %H:%M",
    ):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _detect_format(headers: list[str]) -> str:
    """
    Returns one of:
      'b2b_sales'     — B2B sheet (INVOICE, Channel, Amount, Payment columns)
      'daily_orders'  — Daily rider sheet (Rider Name, ITEM, Location)
      'generic'       — Our own template format
    """
    norm = [_norm_key(h) for h in headers]
    norm_set = set(norm)

    if any(h in norm_set for h in ["invoice"]):
        return "b2b_sales"
    if any(h in norm_set for h in ["ridername", "item"]) or "location" in norm_set:
        return "daily_orders"
    return "generic"


# ─── Clear helpers ────────────────────────────────────────────────────────────

@router.delete("/clear-all")
def clear_all_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Clear all orders, stock movements, and notifications (admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can clear data")

    db.query(models.StockMovement).delete()
    db.query(models.NotificationLog).delete()
    db.query(models.StatusHistory).delete()
    db.query(models.OrderItem).delete()
    db.query(models.Order).delete()
    db.commit()
    return {"message": "All orders, movements, and notifications cleared. Products kept."}


@router.delete("/clear-orders")
def clear_orders(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Clear only orders (keep products & users)."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")

    db.query(models.NotificationLog).filter(
        models.NotificationLog.order_id != None
    ).delete(synchronize_session=False)
    db.query(models.StatusHistory).delete()
    db.query(models.OrderItem).delete()
    db.query(models.Order).delete()
    db.commit()
    return {"message": "All orders cleared. Products, users, and inventory stock kept."}


@router.delete("/clear-products")
def clear_products(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Clear all products and stock movements (admin only)."""
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admin can clear products")

    db.query(models.StockMovement).delete()
    db.query(models.Product).delete()
    db.commit()
    return {"message": "All products and stock movements cleared."}


# ─── CSV Template Downloads ───────────────────────────────────────────────────

@router.get("/template/products")
def products_csv_template():
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["name", "sku", "category", "unit", "unit_price", "stock_qty", "low_stock_threshold"])
    w.writerow(["Organic Desi Ghee 500g",   "NOF-GHEE-500", "Dairy",  "unit", "1800", "50",  "10"])
    w.writerow(["Wild Flower Honey 250g",   "NOF-HNY-250",  "Honey",  "unit", "450",  "30",  "5"])
    w.writerow(["Organic Basmati Rice 1kg", "NOF-RICE-1K",  "Grains", "kg",   "320",  "100", "20"])
    w.writerow(["30 Eggs Tray",             "NOF-EGG-30",   "Eggs",   "tray", "680",  "200", "30"])
    w.writerow(["6 Eggs Pack",              "NOF-EGG-6",    "Eggs",   "pack", "140",  "300", "50"])
    out.seek(0)
    return StreamingResponse(
        io.BytesIO(out.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="navaal_products_template.csv"'},
    )


@router.get("/template/orders")
def orders_csv_template():
    """
    Download the UNIFIED orders template.
    This is also the same format used by Export — one format for both import & backup.
    """
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow([
        "Date", "Invoice", "Customer", "Phone", "Location", "Channel",
        "Amount", "RIDER", "Payment", "Return_Amt", "Remarks",
        "Item_1", "Qty_1", "Price_1",
        "Item_2", "Qty_2", "Price_2",
        "Item_3", "Qty_3", "Price_3",
    ])
    # B2B style example
    w.writerow([
        "12-08-26", "21085", "Springs Store - Tipu Sultan Road", "0300-1234567",
        "DHA Lahore", "B2B", "7200", "FASIH", "Credit", "", "Bill ok",
        "Organic Desi Ghee 500g", "4", "1800", "", "", "", "", "", "",
    ])
    # Daily orders style example
    w.writerow([
        "12-08-26", "", "Hamza ABM", "0321-9876543",
        "DHA", "B2C", "680", "Bilal", "COD", "", "",
        "30 Eggs Tray", "1", "680", "", "", "", "", "", "",
    ])
    out.seek(0)
    return StreamingResponse(
        io.BytesIO(out.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="navaal_orders_template.csv"'},
    )


# ─── CSV Import — Products ────────────────────────────────────────────────────

@router.post("/import/products")
async def import_products(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Import products from CSV. Existing SKUs are updated; new ones are created."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    content = await file.read()
    text = content.decode("utf-8-sig")
    delim = _detect_delimiter(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)

    created = updated = 0
    errors = []

    for i, raw in enumerate(reader, start=2):
        row = _norm_row(raw)
        try:
            name = _get(row, "name", "productname", "title", "item")
            sku  = _get(row, "sku", "code", "itemcode", "productcode", "id")
            if not name or not sku:
                errors.append(f"Row {i}: name and sku are required (got name='{name}', sku='{sku}')")
                continue

            price = _parse_float(_get(row, "unitprice", "price", "rate", "cost"))
            stock = _parse_int(_get(row, "stockqty", "stock", "qty", "quantity", "count"))
            threshold = _parse_int(_get(row, "lowstockthreshold", "threshold", "lowstock", "alert"), 10)
            category = _get(row, "category", "type", "group") or "General"
            unit     = _get(row, "unit", "pack", "measure") or "unit"

            existing = db.query(models.Product).filter(models.Product.sku == sku).first()
            if existing:
                existing.name = name
                existing.category = category or existing.category
                existing.unit = unit or existing.unit
                existing.unit_price = price
                existing.low_stock_threshold = threshold
                if stock > 0:
                    diff = stock - existing.stock_qty
                    existing.stock_qty = stock
                    if diff != 0:
                        db.add(models.StockMovement(
                            product_id=existing.id, movement_type="adjustment",
                            quantity_change=diff, quantity_after=stock,
                            note=f"CSV import adjustment by {current_user.name}",
                            created_by=current_user.name,
                        ))
                updated += 1
            else:
                prod = models.Product(
                    name=name, sku=sku, category=category, unit=unit,
                    unit_price=price, stock_qty=stock, low_stock_threshold=threshold, is_active=True,
                )
                db.add(prod)
                db.flush()
                if stock > 0:
                    db.add(models.StockMovement(
                        product_id=prod.id, movement_type="restock",
                        quantity_change=stock, quantity_after=stock,
                        note=f"CSV import by {current_user.name}", created_by=current_user.name,
                    ))
                created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")

    db.commit()
    return {"message": f"Import complete: {created} created, {updated} updated.", "created": created, "updated": updated, "errors": errors}


# ─── CSV Import — Orders (Auto-detects format) ────────────────────────────────

def _map_payment(raw: str) -> str:
    r = raw.strip().lower()
    if r in ("credit",):       return "unpaid"
    if r in ("cash", "paid"):  return "paid"
    if r in ("cod",):          return "cod"
    if r in ("unpaid",):       return "unpaid"
    return "cod"  # safe default


def _map_source(raw: str) -> str:
    r = raw.strip().lower()
    if r in ("b2b",):                          return "b2b"
    if r in ("b2c", "retail", "direct"):        return "b2c"
    if r in ("website", "web"):                 return "website"
    if r in ("whatsapp", "wa"):                 return "whatsapp"
    if r in ("phone", "call"):                  return "phone"
    if r in ("walk_in", "walkin", "walk in"):   return "walk_in"
    if r in ("facebook", "fb"):                 return "facebook"
    if r in ("instagram", "ig"):                return "instagram"
    return "whatsapp"


def _next_order_number(db: Session) -> tuple[str, datetime]:
    count = db.query(models.Order).count() + 1
    now = datetime.utcnow()
    return f"NOF-{now.year}-{count:04d}", now


def _deduct_stock(db: Session, pname: str, qty: int, order_id: int, order_number: str, user_name: str):
    prod = db.query(models.Product).filter(
        models.Product.name.ilike(f"%{pname}%"), models.Product.is_active == True,
    ).first()
    if prod and prod.stock_qty >= qty:
        prod.stock_qty -= qty
        db.add(models.StockMovement(
            product_id=prod.id, order_id=order_id, movement_type="sale",
            quantity_change=-qty, quantity_after=prod.stock_qty,
            note=f"CSV import order {order_number}", created_by=user_name,
        ))


@router.post("/import/orders")
async def import_orders(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Import orders from CSV.
    Auto-detects three formats:
      • B2B Sales sheet  (INVOICE, Channel, Amount, Payment, …)
      • Daily Orders sheet (Rider Name, ITEM, Location, …)
      • Unified/Generic format (our own template or any reasonable CSV)

    Intelligently matches and updates existing orders (e.g. matching DOS pending orders with Sales Sheet delivery settlements) to eliminate duplicates and date clashes.
    """
    if current_user.role not in ("admin", "manager", "operations"):
        raise HTTPException(status_code=403, detail="Not authorized")
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    content = await file.read()
    text = content.decode("utf-8-sig")
    delim = _detect_delimiter(text)
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)

    raw_headers = reader.fieldnames or []
    fmt = _detect_format(raw_headers)

    created = 0
    updated = 0
    errors  = []

    for i, raw in enumerate(reader, start=2):
        if not any(v and str(v).strip() for v in raw.values()):
            continue

        row = _norm_row(raw)

        try:
            # ═══════════════════════════════════════════════════════════════
            #  FORMAT 1 — B2B / Sales Sheet (Date, INVOICE, Customer, Channel, …)
            # ═══════════════════════════════════════════════════════════════
            if fmt == "b2b_sales":
                customer_name = _get(row, "customer", "customername", "name", "client")
                if not customer_name:
                    errors.append(f"Row {i}: Customer name missing — skipped")
                    continue

                invoice_ref = _get(row, "invoice", "invoiceno", "invoicenumber", "billno")
                total       = _parse_float(_get(row, "amount", "total", "orderamount", "value", "sum"))
                rider       = _get(row, "rider", "ridername", "driver", "deliveryman")
                raw_payment = _get(row, "payment", "paymentstatus", "pay")
                raw_source  = _get(row, "channel", "source", "type")
                return_amt  = _get(row, "returnamt", "returnamount", "return")
                remarks     = _get(row, "remarks", "remark", "notes", "note", "billsend", "comment")
                date_str    = _get(row, "date", "orderdate", "saledate")

                p_lower = (raw_payment or "").strip().lower()
                if p_lower in ("credit",):
                    payment_status = "credit"
                    payment_method = "credit"
                    status = "delivered"
                elif p_lower in ("return", "returned"):
                    payment_status = "returned"
                    payment_method = "returned"
                    status = "returned"
                else:
                    payment_status = "received"
                    payment_method = "cod" if p_lower == "cod" else "cash"
                    status = "delivered"

                source = _map_source(raw_source or "b2b")
                notes_parts = []
                if invoice_ref:   notes_parts.append(f"Inv#{invoice_ref}")
                if return_amt:    notes_parts.append(f"Return:{return_amt}")
                if remarks:       notes_parts.append(remarks)
                notes = " | ".join(notes_parts) or None

                parsed_date = _parse_order_date(date_str) or datetime.utcnow()

                # Check if an existing order matches by customer name or invoice ref
                existing_order = None
                if invoice_ref:
                    existing_order = db.query(models.Order).filter(models.Order.notes.ilike(f"%Inv#{invoice_ref}%")).first()
                if not existing_order and customer_name:
                    existing_order = db.query(models.Order).filter(
                        models.Order.customer_name.ilike(f"%{customer_name.strip()}%"),
                        models.Order.status.in_(["pending", "ready_to_ship", "out_for_delivery"])
                    ).order_by(models.Order.created_at.desc()).first()

                if existing_order:
                    old_st = existing_order.status
                    existing_order.status = status
                    existing_order.payment_status = payment_status
                    existing_order.payment_method = payment_method
                    if total > 0:
                        existing_order.total_amount = total
                    if payment_status == "received" and total > 0:
                        existing_order.amount_received = total
                    if rider:
                        existing_order.assigned_rider_name = rider
                    if notes and notes not in (existing_order.notes or ""):
                        existing_order.notes = f"{existing_order.notes} | {notes}" if existing_order.notes else notes
                    existing_order.delivered_at = parsed_date

                    db.add(models.StatusHistory(
                        order_id=existing_order.id, old_status=old_st, new_status=status,
                        changed_by=current_user.name, changed_at=datetime.utcnow(),
                        note=f"Settled via Sales Sheet CSV (Row {i})",
                    ))
                    updated += 1
                    continue

                # Items
                items_data = []
                for slot in ["1", "2", "3", "4", "5"]:
                    pname = (
                        row.get(f"item{slot}") or row.get(f"product{slot}") or
                        row.get(f"productname{slot}") or row.get(f"item_{slot}") or ""
                    )
                    if not pname:
                        continue
                    qty   = _parse_int(row.get(f"qty{slot}") or row.get(f"quantity{slot}") or "1", 1)
                    price = _parse_float(row.get(f"price{slot}") or row.get(f"unitprice{slot}") or "0")
                    items_data.append((pname, qty, price))

                if not items_data:
                    items_data = [(_get(row, "item", "product", "description") or "B2B Order", 1, total)]

                order_number, now = _next_order_number(db)
                if parsed_date: now = parsed_date

            # ═══════════════════════════════════════════════════════════════
            #  FORMAT 2 — Daily Orders (Rider Name, Customer, Location, ITEM)
            # ═══════════════════════════════════════════════════════════════
            elif fmt == "daily_orders":
                customer_name = _get(row, "customer", "customername", "name", "client")
                if not customer_name:
                    errors.append(f"Row {i}: Customer name missing — skipped")
                    continue

                rider   = _get(row, "ridername", "rider", "driver")
                address = _get(row, "location", "address", "area", "city", "destination")
                item    = _get(row, "item", "product", "items", "description")
                remarks = _get(row, "remarks", "remark", "notes", "note", "comment")
                qty_raw = _get(row, "order", "qty", "quantity", "count")

                qty   = _parse_int(qty_raw, 1)
                total = _parse_float(_get(row, "amount", "total", "price", "value"))
                unit_price = total / max(qty, 1)

                # Auto-lookup price from Product catalog if missing in CSV
                if unit_price == 0 and item:
                    prod = db.query(models.Product).filter(
                        models.Product.name.ilike(f"%{item.strip()}%"),
                        models.Product.is_active == True,
                    ).first()
                    if prod:
                        unit_price = prod.unit_price
                        total = qty * unit_price

                source  = "b2c"
                payment = "cod"
                status  = "pending"
                notes   = remarks or None

                items_data = [(item or "Order item", qty, unit_price)]
                order_number, now = _next_order_number(db)
                date_str = _get(row, "date", "orderdate", "createdat", "deliverydate")
                parsed_date = _parse_order_date(date_str)
                if parsed_date:
                    now = parsed_date

            # ═══════════════════════════════════════════════════════════════
            #  FORMAT 3 — Generic / Unified template
            # ═══════════════════════════════════════════════════════════════
            else:
                customer_name = _get(row, "customername", "customer", "name", "recipient", "buyer", "client")
                if not customer_name:
                    errors.append(f"Row {i}: Customer name missing — skipped")
                    continue

                rider   = _get(row, "rider", "assignedrider", "driver", "courier")
                address = _get(row, "deliveryaddress", "address", "location", "destination", "area")
                remarks = _get(row, "remarks", "notes", "note", "comment", "remark")
                raw_payment = _get(row, "paymentstatus", "payment", "pay")
                raw_source  = _get(row, "source", "channel", "medium")

                payment = _map_payment(raw_payment) if raw_payment else "cod"
                source  = _map_source(raw_source)   if raw_source  else "whatsapp"
                status  = "pending"
                notes   = remarks or None
                total   = _parse_float(_get(row, "amount", "totalamount", "total", "value", "sum"))

                items_data = []
                for slot in ["1", "2", "3", "4", "5"]:
                    pname = (
                        row.get(f"item{slot}") or row.get(f"product{slot}") or
                        row.get(f"productname{slot}") or row.get(f"itemname{slot}") or ""
                    )
                    if not pname:
                        continue
                    qty   = _parse_int(row.get(f"qty{slot}") or row.get(f"quantity{slot}") or "1", 1)
                    price = _parse_float(row.get(f"price{slot}") or row.get(f"unitprice{slot}") or "0")
                    items_data.append((pname, qty, price))
                    if price > 0:
                        total += qty * price

                if not items_data:
                    item = _get(row, "item", "product", "description", "productname")
                    items_data = [(item or "Order item", 1, total)]

                order_number, now = _next_order_number(db)
                date_str = _get(row, "date", "orderdate", "createdat")
                parsed_date = _parse_order_date(date_str)
                if parsed_date:
                    now = parsed_date

            # ── Resolve city / address ────────────────────────────────────
            if fmt == "daily_orders":
                city = address
                delivery_address = address
            else:
                city = _get(row, "city", "town", "district", "area")
                delivery_address = _get(row, "deliveryaddress", "address", "location", "destination") or _get(row, "city", "location", "area")

            phone = _get(row, "phone", "mobile", "contact", "tel", "customerphonenumber", "customerphone")

            raw_priority = _get(row, "priority", "importance", "urgency", "level")
            priority_map = {"high": "high", "urgent": "urgent", "normal": "normal"}
            priority = priority_map.get(raw_priority.lower(), "normal")

            if all(p > 0 for _, _, p in items_data):
                total = sum(q * p for _, q, p in items_data)

            # ── Determine channel (b2b / b2c) ────────────────────────────
            # B2B Sales sheet → always b2b; otherwise derive from the "Channel"
            # CSV column if present, falling back to b2c for retail orders.
            if fmt == "b2b_sales":
                channel = "b2b"
            else:
                raw_channel = _get(row, "channel", "source", "type")
                channel = "b2b" if raw_channel.lower() in ("b2b",) else "b2c"

            # ── Create Order ──────────────────────────────────────────────
            order = models.Order(
                order_number=order_number,
                customer_name=customer_name,
                customer_phone=phone or None,
                delivery_address=delivery_address or None,
                city=city or None,
                source=source,
                channel=channel,
                priority=priority,
                payment_status=payment if fmt != "b2b_sales" else payment_status,
                payment_method=payment_method if fmt == "b2b_sales" else "cod",
                amount_received=total if (fmt == "b2b_sales" and payment_status == "received") else 0.0,
                notes=notes,
                assigned_rider_name=rider or None,
                total_amount=total,
                assigned_staff_id=current_user.id,
                created_at=now,
                delivered_at=now if fmt == "b2b_sales" else None,
                status=status if fmt == "b2b_sales" else "pending",
            )
            db.add(order)
            db.flush()

            for pname, qty, price in items_data:
                db.add(models.OrderItem(
                    order_id=order.id,
                    product_name=pname,
                    quantity=qty,
                    unit_price=price,
                    total_price=qty * price,
                ))
                _deduct_stock(db, pname, qty, order.id, order_number, current_user.name)

            db.add(models.StatusHistory(
                order_id=order.id, old_status=None, new_status=order.status,
                changed_by=current_user.name, changed_at=now, note=f"CSV import ({fmt})",
            ))
            created += 1

        except Exception as e:
            errors.append(f"Row {i}: {e}")

    db.commit()
    return {
        "message": f"Import complete: {created} orders created, {updated} orders updated.",
        "format_detected": fmt,
        "created": created,
        "updated": updated,
        "errors": errors,
    }


# ─── Unified Export ───────────────────────────────────────────────────────────

@router.get("/export/orders")
def export_orders_csv(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Export all orders as a single unified CSV.
    Format matches the unified template so it can be re-imported later.
    """
    orders = db.query(models.Order).order_by(models.Order.created_at.asc()).all()

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow([
        "Date", "Invoice", "Customer", "Phone", "Location", "Channel",
        "Amount", "RIDER", "Payment", "Return_Amt", "Remarks",
        "Item_1", "Qty_1", "Price_1",
        "Item_2", "Qty_2", "Price_2",
        "Item_3", "Qty_3", "Price_3",
        # System columns (read-only on re-import)
        "order_number", "status",
    ])

    for o in orders:
        items = o.items or []
        def get_item(idx):
            if idx < len(items):
                it = items[idx]
                return it.product_name, it.quantity, it.unit_price
            return "", "", ""

        i1, q1, p1 = get_item(0)
        i2, q2, p2 = get_item(1)
        i3, q3, p3 = get_item(2)

        # Map internal payment → display
        pay_display = {"unpaid": "Credit", "paid": "Cash", "cod": "COD"}.get(o.payment_status, o.payment_status)
        # Extract invoice ref from notes if present
        invoice_ref = ""
        if o.notes and o.notes.startswith("Inv#"):
            parts = o.notes.split("|")
            invoice_ref = parts[0].replace("Inv#", "").strip()
        remarks = o.notes or ""

        w.writerow([
            o.created_at.strftime("%d-%m-%y") if o.created_at else "",
            invoice_ref,
            o.customer_name,
            o.customer_phone or "",
            o.delivery_address or o.city or "",
            (o.source or "").upper(),
            o.total_amount,
            o.assigned_rider_name or "",
            pay_display,
            "",  # Return_Amt — left empty on export
            remarks,
            i1, q1, p1,
            i2, q2, p2,
            i3, q3, p3,
            o.order_number,
            o.status,
        ])

    out.seek(0)
    filename = f"navaal_orders_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        io.BytesIO(out.getvalue().encode("utf-8-sig")),  # utf-8-sig so Excel opens it clean
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
