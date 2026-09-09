from typing import List, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query, Header
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from database import get_db
import models
from auth import get_current_user, bearer_scheme

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _get_date_range(days: int = 7, start_date: Optional[str] = None, end_date: Optional[str] = None):
    now = datetime.utcnow()
    if start_date and end_date:
        try:
            s_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(hour=0, minute=0, second=0, microsecond=0)
            e_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59, microsecond=999999)
            return s_dt, e_dt
        except Exception:
            pass
    elif start_date:
        try:
            s_dt = datetime.strptime(start_date, "%Y-%m-%d").replace(hour=0, minute=0, second=0, microsecond=0)
            e_dt = s_dt.replace(hour=23, minute=59, second=59, microsecond=999999)
            return s_dt, e_dt
        except Exception:
            pass

    e_dt = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    s_dt = (now - timedelta(days=max(1, days) - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return s_dt, e_dt


@router.get("/overview")
def get_overview(
    days: int = Query(7, ge=1, le=365),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Day-by-day order count and revenue for the selected timeframe."""
    s_dt, e_dt = _get_date_range(days, start_date, end_date)
    result = []
    
    delta_days = (e_dt.date() - s_dt.date()).days + 1

    for i in range(delta_days):
        day = s_dt + timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day.replace(hour=23, minute=59, second=59, microsecond=999999)

        count = (
            db.query(func.count(models.Order.id))
            .filter(models.Order.created_at.between(day_start, day_end))
            .scalar() or 0
        )
        delivered = (
            db.query(func.count(models.Order.id))
            .filter(
                models.Order.delivered_at.between(day_start, day_end),
            )
            .scalar() or 0
        )
        revenue = (
            db.query(func.sum(models.Order.total_amount))
            .filter(
                models.Order.delivered_at.between(day_start, day_end),
            )
            .scalar() or 0.0
        )
        late = (
            db.query(func.count(models.Order.id))
            .filter(
                models.Order.created_at.between(day_start, day_end),
                models.Order.sla_alert_1_sent == True,
            )
            .scalar() or 0
        )
        result.append({
            "date": day.strftime("%b %d"),
            "orders": count,
            "delivered": delivered,
            "revenue": float(revenue),
            "late": late,
        })
    return result


@router.get("/by-status")
def get_by_status(
    days: int = Query(7),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Order count breakdown by status for selected date range."""
    s_dt, e_dt = _get_date_range(days, start_date, end_date)
    statuses = ["pending", "ready_to_ship", "out_for_delivery", "delivered", "cancelled"]
    result = []
    for s in statuses:
        count = (
            db.query(func.count(models.Order.id))
            .filter(models.Order.status == s, models.Order.created_at.between(s_dt, e_dt))
            .scalar() or 0
        )
        result.append({"status": s, "count": count})
    return result


@router.get("/by-source")
def get_by_source(
    days: int = Query(7),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Order count and revenue breakdown by order source for selected date range."""
    s_dt, e_dt = _get_date_range(days, start_date, end_date)
    results = (
        db.query(
            models.Order.source,
            func.count(models.Order.id).label("count"),
            func.sum(models.Order.total_amount).label("total_revenue"),
            func.sum(case((models.Order.status == "delivered", 1), else_=0)).label("delivered_count")
        )
        .filter(models.Order.created_at.between(s_dt, e_dt))
        .group_by(models.Order.source)
        .all()
    )
    total_all = sum(r.count for r in results) or 1
    res = []
    for r in results:
        src = r.source or "unknown"
        res.append({
            "source": src,
            "count": r.count,
            "total_revenue": float(r.total_revenue or 0.0),
            "delivered_count": int(r.delivered_count or 0),
            "percentage": round((r.count / total_all) * 100, 1),
        })
    return res



@router.get("/rider-performance")
def get_rider_performance(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Detailed order dispatch and cash collection metrics per rider."""
    results = (
        db.query(
            models.Order.assigned_rider_name,
            func.count(models.Order.id).label("total_orders"),
            func.sum(case((models.Order.status == "delivered", 1), else_=0)).label("delivered_count"),
            func.sum(case((models.Order.status == "out_for_delivery", 1), else_=0)).label("out_for_delivery_count"),
            func.sum(case((models.Order.status == "delivered", models.Order.total_amount), else_=0.0)).label("cod_collected"),
        )
        .filter(models.Order.assigned_rider_name.isnot(None), models.Order.assigned_rider_name != "")
        .group_by(models.Order.assigned_rider_name)
        .all()
    )
    
    res = []
    for r in results:
        tot = r.total_orders or 0
        deliv = int(r.delivered_count or 0)
        res.append({
            "rider_name": r.assigned_rider_name,
            "total_orders": tot,
            "delivered_orders": deliv,
            "out_for_delivery_orders": int(r.out_for_delivery_count or 0),
            "total_cod_collected": float(r.cod_collected or 0.0),
            "success_rate": round((deliv / tot) * 100, 1) if tot > 0 else 0.0
        })
    return res


@router.get("/staff-performance")
def get_staff_performance(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    users = db.query(models.User).filter(
        models.User.role.in_(["warehouse", "operations", "admin"])
    ).all()

    result = []
    for u in users:
        total = db.query(func.count(models.Order.id)).filter(
            models.Order.assigned_staff_id == u.id
        ).scalar() or 0

        delivered = db.query(func.count(models.Order.id)).filter(
            models.Order.assigned_staff_id == u.id,
            models.Order.status == "delivered",
        ).scalar() or 0

        late = db.query(func.count(models.Order.id)).filter(
            models.Order.assigned_staff_id == u.id,
            models.Order.sla_alert_1_sent == True,
        ).scalar() or 0

        result.append({
            "name": u.name,
            "role": u.role,
            "total_orders": total,
            "delivered": delivered,
            "late_orders": late,
        })
    return result


@router.get("/sla-summary")
def get_sla_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    total_rts = db.query(func.count(models.Order.id)).filter(
        models.Order.rts_at.isnot(None)
    ).scalar() or 0

    breached = db.query(func.count(models.Order.id)).filter(
        models.Order.sla_alert_1_sent == True
    ).scalar() or 0

    on_time = total_rts - breached
    breach_pct = round((breached / total_rts * 100) if total_rts > 0 else 0, 1)

    return {
        "total_rts_orders": total_rts,
        "on_time": on_time,
        "breached": breached,
        "breach_percentage": breach_pct,
    }


@router.get("/inventory-performance")
def get_inventory_performance(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Returns inventory turnover rate and wastage/spoilage logs for the business owner.
    """
    products = db.query(models.Product).filter(models.Product.is_active == True).all()
    base_stocks = {p.id: p.stock_qty for p in products}

    result = []

    for p in products:
        # Units Sold
        sold_qty = (
            db.query(func.sum(models.OrderItem.quantity))
            .join(models.Order)
            .filter(
                models.OrderItem.product_id == p.id if hasattr(models.OrderItem, 'product_id') else models.OrderItem.product_name.ilike(f"%{p.name}%"),
                models.Order.status == "delivered"
            )
            .scalar() or 0.0
        )

        # Wastage / Spoilage (movements with type adjustment or spoilage and change < 0)
        wastage_qty = (
            db.query(func.sum(func.abs(models.StockMovement.quantity_change)))
            .filter(
                models.StockMovement.product_id == p.id,
                models.StockMovement.movement_type.in_(["adjustment", "spoilage"]),
                models.StockMovement.quantity_change < 0
            )
            .scalar() or 0.0
        )

        # Restocks / Receivings
        restock_qty = (
            db.query(func.sum(models.StockMovement.quantity_change))
            .filter(
                models.StockMovement.product_id == p.id,
                models.StockMovement.movement_type == "restock",
            )
            .scalar() or 0.0
        )

        # Dynamically computed current stock for packs / bulk
        from routers.inventory import compute_stock_qty
        current_stock = compute_stock_qty(p, base_stocks)

        starting_stock = current_stock + sold_qty + wastage_qty - restock_qty
        avg_stock = (max(0, starting_stock) + current_stock) / 2.0
        turnover_rate = round(sold_qty / avg_stock, 2) if avg_stock > 0 else 0.0
        wastage_value = round(wastage_qty * p.unit_price, 2)

        result.append({
            "product_id": p.id,
            "product_name": p.name,
            "sku": p.sku,
            "unit": p.unit,
            "is_subitem": p.base_product_id is not None,
            "unit_multiplier": p.unit_multiplier or 1.0,
            "current_stock": current_stock,
            "restock_qty": restock_qty,
            "sold_qty": sold_qty,
            "wastage_qty": wastage_qty,
            "wastage_value": wastage_value,
            "turnover_rate": turnover_rate,
        })

    return result


@router.get("/monthly-inventory")
def get_monthly_inventory(
    month: Optional[str] = Query(None, description="Format: YYYY-MM, e.g. 2026-08"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Monthly inventory & spoilage report for official owner records.
    Calculates total receivings, sales, spoilages, and inventory value for the month.
    """
    now = datetime.utcnow()
    if not month:
        month = now.strftime("%Y-%m")
    
    try:
        year, month_num = map(int, month.split("-"))
        start_date = datetime(year, month_num, 1, 0, 0, 0)
        if month_num == 12:
            end_date = datetime(year + 1, 1, 1, 0, 0, 0)
        else:
            end_date = datetime(year, month_num + 1, 1, 0, 0, 0)
    except Exception:
        start_date = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        end_date = now

    products = db.query(models.Product).filter(models.Product.is_active == True).all()
    base_stocks = {p.id: p.stock_qty for p in products}

    # Fetch all movements within date range
    movements = (
        db.query(models.StockMovement)
        .filter(models.StockMovement.created_at >= start_date, models.StockMovement.created_at < end_date)
        .all()
    )

    items_report = []
    total_spoilage_cost = 0.0
    total_received_units = 0.0
    total_sold_units = 0.0

    from routers.inventory import compute_stock_qty

    for p in products:
        p_mvs = [m for m in movements if m.product_id == p.id]
        
        received = sum(m.quantity_change for m in p_mvs if m.movement_type == "restock")
        sold = sum(abs(m.quantity_change) for m in p_mvs if m.movement_type == "sale")
        spoiled = sum(abs(m.quantity_change) for m in p_mvs if m.movement_type in ("spoilage", "adjustment") and m.quantity_change < 0)

        spoilage_cost = round(spoiled * p.unit_price, 2)
        if p.base_product_id is None:
            total_spoilage_cost += spoilage_cost
            total_received_units += received
            total_sold_units += sold

        curr_qty = compute_stock_qty(p, base_stocks)

        items_report.append({
            "product_id": p.id,
            "name": p.name,
            "sku": p.sku,
            "category": p.category,
            "unit": p.unit,
            "is_subitem": p.base_product_id is not None,
            "multiplier": p.unit_multiplier or 1.0,
            "unit_price": p.unit_price,
            "received_qty": received,
            "sold_qty": sold,
            "spoiled_qty": spoiled,
            "spoilage_cost": spoilage_cost,
            "current_stock": curr_qty,
            "inventory_value": round(curr_qty * p.unit_price, 2) if p.base_product_id is None else 0.0
        })

    total_inventory_val = sum(r["inventory_value"] for r in items_report if not r["is_subitem"])

    return {
        "month": month,
        "period_start": start_date.strftime("%Y-%m-%d"),
        "period_end": end_date.strftime("%Y-%m-%d"),
        "total_received_units": total_received_units,
        "total_sold_units": total_sold_units,
        "total_spoilage_cost": total_spoilage_cost,
        "total_inventory_value": total_inventory_val,
        "items": items_report,
    }


@router.get("/daily-working")
def get_daily_working(
    date_str: Optional[str] = Query(None, description="Format YYYY-MM-DD"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Daily operations report — orders received, status breakdown, restocks & spoilage today.
    """
    now = datetime.utcnow()
    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
        except Exception:
            target_date = now
    else:
        target_date = now

    day_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)

    orders = (
        db.query(models.Order)
        .filter(models.Order.created_at >= day_start, models.Order.created_at <= day_end)
        .all()
    )

    movements = (
        db.query(models.StockMovement)
        .filter(models.StockMovement.created_at >= day_start, models.StockMovement.created_at <= day_end)
        .all()
    )

    total_orders = len(orders)
    total_revenue = sum(o.total_amount for o in orders)
    delivered_orders = [o for o in orders if o.status == "delivered"]
    
    restocks_today = [
        {"product_id": m.product_id, "qty": m.quantity_change, "note": m.note, "time": m.created_at.strftime("%H:%M")}
        for m in movements if m.movement_type == "restock"
    ]
    spoilage_today = [
        {"product_id": m.product_id, "qty": abs(m.quantity_change), "note": m.note, "time": m.created_at.strftime("%H:%M")}
        for m in movements if m.movement_type in ("spoilage", "adjustment") and m.quantity_change < 0
    ]

    orders_summary = [
        {
            "order_number": o.order_number,
            "customer_name": o.customer_name,
            "city": o.city,
            "status": o.status,
            "total_amount": o.total_amount,
            "payment_status": o.payment_status,
            "time": o.created_at.strftime("%H:%M")
        }
        for o in orders
    ]

    return {
        "report_date": day_start.strftime("%Y-%m-%d"),
        "total_orders": total_orders,
        "delivered_orders": len(delivered_orders),
        "total_revenue": total_revenue,
        "restocks_count": len(restocks_today),
        "spoilage_count": len(spoilage_today),
        "orders": orders_summary,
        "restocks": restocks_today,
        "spoilage": spoilage_today,
    }


from pydantic import BaseModel

class EmailReportRequest(BaseModel):
    recipient_email: Optional[str] = None
    date_str: Optional[str] = None
    custom_notes: Optional[str] = None
    include_pdf: bool = True


@router.post("/send-email-report")
def trigger_email_report(
    req: Optional[EmailReportRequest] = None,
    date_str: Optional[str] = Query(None, description="Format YYYY-MM-DD"),
    recipient_email: Optional[str] = Query(None),
    x_n8n_api_key: Optional[str] = Header(None),
    db: Session = Depends(get_db),
    credentials: Optional[object] = Depends(bearer_scheme) if "bearer_scheme" in globals() else Depends(HTTPBearer(auto_error=False)),
):
    """
    Manually triggers sending the daily report email with PDF attachment.
    Authorized via n8n API Key header or active Admin/Manager dashboard login.
    Can accept optional custom recipient_email and executive notes.
    """
    import os
    from fastapi import HTTPException
    from jose import jwt
    from auth import SECRET_KEY, ALGORITHM

    authorized = False

    # 1. Check if X-N8N-API-KEY is provided and correct
    n8n_key = os.getenv("N8N_API_KEY", "")
    if n8n_key and x_n8n_api_key == n8n_key:
        authorized = True

    # 2. Check if admin credentials are provided
    if not authorized and credentials:
        try:
            token = credentials.credentials
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            sub = payload.get("sub")
            if sub:
                user_id = int(sub)
                user = db.query(models.User).filter(models.User.id == user_id).first()
                if user and user.is_active and user.role in ["admin", "manager"]:
                    authorized = True
        except Exception:
            pass

    if not authorized:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized. Provide a valid Admin login session token or X-N8N-API-KEY header."
        )

    # Extract params from req body or query params
    target_date_str = (req.date_str if req and req.date_str else date_str)
    target_recipient = (req.recipient_email if req and req.recipient_email else recipient_email)
    custom_notes = (req.custom_notes if req else None)
    include_pdf = (req.include_pdf if req else True)

    from email_reports import send_daily_report_email
    success = send_daily_report_email(
        db,
        date_str=target_date_str,
        custom_recipient=target_recipient,
        custom_notes=custom_notes,
        include_pdf=include_pdf
    )
    if success:
        target_display = target_recipient if target_recipient else "default recipient"
        return {"status": "success", "message": f"Daily PDF report email successfully sent to {target_display}!"}
    else:
        raise HTTPException(
            status_code=500,
            detail="Failed to send email. Verify SMTP settings (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_EMAIL) in configuration."
        )


@router.get("/download-pdf-report")
def download_pdf_report(
    date_str: Optional[str] = Query(None, description="Format YYYY-MM-DD"),
    notes: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Generates and returns an instant corporate PDF report as a direct file download.
    """
    from fastapi.responses import Response
    from email_reports import generate_daily_report_pdf

    try:
        if date_str:
            target_date = datetime.strptime(date_str, "%Y-%m-%d")
        else:
            target_date = datetime.utcnow()
    except Exception:
        target_date = datetime.utcnow()

    pdf_bytes = generate_daily_report_pdf(db, target_date, custom_notes=notes)
    filename = f"Navaal_Operations_Report_{target_date.strftime('%Y-%m-%d')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )




