"""
Daily Inventory Log & Stock Reports Router
- Dedicated Admin-only section for daily stock logs, purchase pricing, and spoilage/breakage reporting.
- Auto-synced with restock/spoilage actions from the main Inventory tab.
"""
import io
import csv
from typing import List, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from database import get_db
import models
import schemas
from auth import get_current_user

router = APIRouter(prefix="/api/daily-inventory", tags=["daily_inventory"])


def require_admin(current_user: models.User = Depends(get_current_user)):
    """Enforce strict Admin-only access for daily inventory report tab."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Access restricted to System Administrators only"
        )
    return current_user


def sync_daily_inventory_log(
    db: Session,
    product: models.Product,
    added_qty: float = 0.0,
    spoiled_qty: float = 0.0,
    broken_qty: float = 0.0,
    unit_cost: float = 0.0,
    vendor_id: Optional[int] = None,
    vendor_name: Optional[str] = None,
    peti_qty: float = 0.0,
    carton_qty: float = 0.0,
    loose_qty: float = 0.0,
    spoilage_vendor_id: Optional[int] = None,
    spoilage_vendor_name: Optional[str] = None,
    spoilage_reason: Optional[str] = None,
    note: Optional[str] = None,
    created_by: Optional[str] = None,
    target_date: Optional[datetime] = None,
):
    """
    Auto-sync helper: Called when restock or spoilage is performed anywhere in the system.
    Creates a new DailyInventoryLog record for every stock addition / spoilage action.
    """
    log_dt = target_date or datetime.utcnow()

    target_product = product
    if product.base_product_id:
        parent = db.query(models.Product).filter(models.Product.id == product.base_product_id).first()
        if parent:
            target_product = parent

    cost = unit_cost if unit_cost > 0 else (target_product.unit_price or 0.0)

    # Auto compute total added if peti/carton/loose supplied and added_qty is 0
    calculated_added = added_qty
    if calculated_added == 0 and (peti_qty > 0 or carton_qty > 0 or loose_qty > 0):
        calculated_added = (peti_qty * 480.0) + (carton_qty * 360.0) + loose_qty

    log = models.DailyInventoryLog(
        log_date=log_dt,
        product_id=target_product.id,
        product_name=target_product.name,
        category_name=target_product.category or "General",
        vendor_id=vendor_id,
        vendor_name=vendor_name,
        peti_qty=peti_qty,
        carton_qty=carton_qty,
        loose_qty=loose_qty,
        added_qty=calculated_added,
        unit_cost=cost,
        total_cost=round(calculated_added * cost, 2),
        spoilage_vendor_id=spoilage_vendor_id,
        spoilage_vendor_name=spoilage_vendor_name,
        spoilage_reason=spoilage_reason,
        spoiled_qty=spoiled_qty,
        broken_qty=broken_qty,
        notes=note,
        created_by=created_by or "System",
        created_at=datetime.utcnow(),
    )
    db.add(log)
    return log


@router.get("", response_model=List[schemas.DailyInventoryLogOut])
def list_daily_inventory_logs(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    category: Optional[str] = Query(None),
    product_id: Optional[int] = Query(None),
    vendor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin),
):
    """List daily inventory logs with optional date range, category, and vendor filters."""
    q = db.query(models.DailyInventoryLog)

    if start_date:
        try:
            st = datetime.strptime(start_date, "%Y-%m-%d")
            q = q.filter(models.DailyInventoryLog.log_date >= st)
        except ValueError:
            pass

    if end_date:
        try:
            et = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            q = q.filter(models.DailyInventoryLog.log_date < et)
        except ValueError:
            pass

    if category:
        q = q.filter(models.DailyInventoryLog.category_name == category)

    if product_id:
        q = q.filter(models.DailyInventoryLog.product_id == product_id)

    if vendor_id:
        q = q.filter(
            or_(
                models.DailyInventoryLog.vendor_id == vendor_id,
                models.DailyInventoryLog.spoilage_vendor_id == vendor_id
            )
        )

    return q.order_by(models.DailyInventoryLog.log_date.desc(), models.DailyInventoryLog.id.desc()).all()


@router.get("/summary", response_model=schemas.DailyInventorySummaryOut)
def get_daily_inventory_summary(
    start_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin),
):
    """
    Get top summary KPIs for the Daily Inventory Report:
    - Total eggs / stock in hand (sum of base products stock)
    - Peti count in hand (total_stock / 480)
    - Carton count in hand (total_stock / 360)
    - Total added stock
    - Total purchase cost (PKR)
    - Total spoiled stock & damaged stock with loss PKR
    - Vendor accountability matrix
    """
    # 1. Total Stock in Hand across base bulk products
    base_products_q = db.query(models.Product).filter(
        models.Product.is_active == True,
        models.Product.base_product_id.is_(None)
    )
    if category:
        base_products_q = base_products_q.filter(models.Product.category == category)
    base_products = base_products_q.all()
    total_stock_in_hand = sum(p.stock_qty for p in base_products)

    # 2. Query Daily Logs for aggregated totals
    q = db.query(models.DailyInventoryLog)
    if start_date:
        try:
            st = datetime.strptime(start_date, "%Y-%m-%d")
            q = q.filter(models.DailyInventoryLog.log_date >= st)
        except ValueError:
            pass
    if end_date:
        try:
            et = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            q = q.filter(models.DailyInventoryLog.log_date < et)
        except ValueError:
            pass
    if category:
        q = q.filter(models.DailyInventoryLog.category_name == category)

    logs = q.all()

    total_added = sum(l.added_qty for l in logs)
    total_purchase_cost = sum(l.total_cost for l in logs)
    total_spoiled = sum(l.spoiled_qty for l in logs)
    total_broken = sum(l.broken_qty for l in logs)
    total_loss_pkr = sum((l.spoiled_qty + l.broken_qty) * (l.unit_cost or 0.0) for l in logs)

    # 3. Build category breakdown
    category_map = {}
    for p in base_products:
        cat = p.category or "General"
        if cat not in category_map:
            category_map[cat] = {
                "category_name": cat,
                "total_stock_in_hand": 0.0,
                "total_added": 0.0,
                "total_purchase_cost": 0.0,
                "total_spoiled": 0.0,
                "total_broken": 0.0,
            }
        category_map[cat]["total_stock_in_hand"] += p.stock_qty

    for l in logs:
        cat = l.category_name or "General"
        if cat not in category_map:
            category_map[cat] = {
                "category_name": cat,
                "total_stock_in_hand": 0.0,
                "total_added": 0.0,
                "total_purchase_cost": 0.0,
                "total_spoiled": 0.0,
                "total_broken": 0.0,
            }
        category_map[cat]["total_added"] += l.added_qty
        category_map[cat]["total_purchase_cost"] += l.total_cost
        category_map[cat]["total_spoiled"] += l.spoiled_qty
        category_map[cat]["total_broken"] += l.broken_qty

    categories_list = [
        schemas.CategoryStockSummary(**data) for data in category_map.values()
    ]

    # 4. Vendor Accountability Matrix
    vendor_stats = {}
    for l in logs:
        v_name = l.vendor_name or "Unassigned Vendor"
        if v_name not in vendor_stats:
            vendor_stats[v_name] = {
                "vendor_id": l.vendor_id,
                "vendor_name": v_name,
                "total_petis": 0.0,
                "total_cartons": 0.0,
                "total_loose": 0.0,
                "total_eggs_received": 0.0,
                "total_cost_pkr": 0.0,
                "total_spoiled_eggs": 0.0,
                "total_broken_eggs": 0.0,
                "total_loss_pkr": 0.0,
            }

        vendor_stats[v_name]["total_petis"] += l.peti_qty or 0.0
        vendor_stats[v_name]["total_cartons"] += l.carton_qty or 0.0
        vendor_stats[v_name]["total_loose"] += l.loose_qty or 0.0
        vendor_stats[v_name]["total_eggs_received"] += l.added_qty or 0.0
        vendor_stats[v_name]["total_cost_pkr"] += l.total_cost or 0.0

        sp_v_name = l.spoilage_vendor_name or v_name
        if sp_v_name not in vendor_stats:
            vendor_stats[sp_v_name] = {
                "vendor_id": l.spoilage_vendor_id,
                "vendor_name": sp_v_name,
                "total_petis": 0.0,
                "total_cartons": 0.0,
                "total_loose": 0.0,
                "total_eggs_received": 0.0,
                "total_cost_pkr": 0.0,
                "total_spoiled_eggs": 0.0,
                "total_broken_eggs": 0.0,
                "total_loss_pkr": 0.0,
            }

        sp_qty = l.spoiled_qty or 0.0
        brk_qty = l.broken_qty or 0.0
        cost = l.unit_cost or 0.0
        vendor_stats[sp_v_name]["total_spoiled_eggs"] += sp_qty
        vendor_stats[sp_v_name]["total_broken_eggs"] += brk_qty
        vendor_stats[sp_v_name]["total_loss_pkr"] += round((sp_qty + brk_qty) * cost, 2)

    vendor_acc_list = []
    for item in vendor_stats.values():
        total_recv = item["total_eggs_received"]
        total_bad = item["total_spoiled_eggs"] + item["total_broken_eggs"]
        rate = round((total_bad / total_recv * 100), 2) if total_recv > 0 else 0.0

        if total_recv > 0 or total_bad > 0:
            vendor_acc_list.append(schemas.VendorAccountabilityItem(
                vendor_id=item["vendor_id"],
                vendor_name=item["vendor_name"],
                total_petis=round(item["total_petis"], 1),
                total_cartons=round(item["total_cartons"], 1),
                total_loose=round(item["total_loose"], 1),
                total_eggs_received=round(item["total_eggs_received"], 1),
                total_cost_pkr=round(item["total_cost_pkr"], 2),
                total_spoiled_eggs=round(item["total_spoiled_eggs"], 1),
                total_broken_eggs=round(item["total_broken_eggs"], 1),
                total_loss_pkr=round(item["total_loss_pkr"], 2),
                spoilage_rate_pct=rate,
            ))

    return schemas.DailyInventorySummaryOut(
        total_stock_in_hand=round(total_stock_in_hand, 2),
        total_petis_in_hand=round(total_stock_in_hand / 480.0, 1),
        total_cartons_in_hand=round(total_stock_in_hand / 360.0, 1),
        total_added=round(total_added, 2),
        total_purchase_cost=round(total_purchase_cost, 2),
        total_spoiled=round(total_spoiled, 2),
        total_broken=round(total_broken, 2),
        total_loss_pkr=round(total_loss_pkr, 2),
        categories=categories_list,
        vendor_accountability=sorted(vendor_acc_list, key=lambda x: x.total_eggs_received, reverse=True),
    )


@router.post("", response_model=schemas.DailyInventoryLogOut)
def create_daily_inventory_log(
    data: schemas.DailyInventoryLogCreate,
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin),
):
    """
    Manually create or add a Daily Inventory entry.
    Supports Petis (480 eggs avg), Cartons (360 eggs avg), Loose eggs, and Vendor assignment.
    """
    prod = None
    if data.product_id:
        prod = db.query(models.Product).filter(models.Product.id == data.product_id).first()
    elif data.product_name:
        prod = db.query(models.Product).filter(
            func.lower(models.Product.name) == data.product_name.strip().lower()
        ).first()

    if not prod and not data.product_name:
        raise HTTPException(status_code=400, detail="Product is required")

    log_date = data.log_date or datetime.utcnow()

    # Calculate added_qty if peti / carton / loose supplied
    calculated_added = data.added_qty
    if calculated_added == 0 and (data.peti_qty > 0 or data.carton_qty > 0 or data.loose_qty > 0):
        calculated_added = (data.peti_qty * 480.0) + (data.carton_qty * 360.0) + data.loose_qty

    total_cost = data.total_cost
    if total_cost is None:
        total_cost = round(calculated_added * data.unit_cost, 2)

    category = data.category_name or (prod.category if prod else "General")

    # Fetch vendor names if vendor_ids supplied
    v_name = data.vendor_name
    if data.vendor_id and not v_name:
        v_obj = db.query(models.Vendor).filter(models.Vendor.id == data.vendor_id).first()
        if v_obj:
            v_name = v_obj.name

    sp_v_name = data.spoilage_vendor_name
    if data.spoilage_vendor_id and not sp_v_name:
        sp_obj = db.query(models.Vendor).filter(models.Vendor.id == data.spoilage_vendor_id).first()
        if sp_obj:
            sp_v_name = sp_obj.name

    log = models.DailyInventoryLog(
        log_date=log_date,
        product_id=prod.id if prod else None,
        product_name=prod.name if prod else data.product_name,
        category_name=category,
        vendor_id=data.vendor_id,
        vendor_name=v_name,
        peti_qty=data.peti_qty,
        carton_qty=data.carton_qty,
        loose_qty=data.loose_qty,
        added_qty=calculated_added,
        unit_cost=data.unit_cost,
        total_cost=total_cost,
        spoilage_vendor_id=data.spoilage_vendor_id,
        spoilage_vendor_name=sp_v_name,
        spoilage_reason=data.spoilage_reason,
        spoiled_qty=data.spoiled_qty,
        broken_qty=data.broken_qty,
        notes=data.notes,
        created_by=admin_user.name,
        created_at=datetime.utcnow(),
    )
    db.add(log)

    # If linked to a product, adjust product stock and log StockMovement
    if prod:
        target_prod = prod
        mult = 1.0
        if prod.base_product_id:
            parent = db.query(models.Product).filter(models.Product.id == prod.base_product_id).first()
            if parent:
                target_prod = parent
                mult = prod.unit_multiplier or 1.0

        raw_net = calculated_added - data.spoiled_qty - data.broken_qty
        net_change = round(raw_net * mult, 2)
        if net_change != 0:
            target_prod.stock_qty += net_change
            mv_type = "restock" if net_change > 0 else "adjustment"
            db.add(models.StockMovement(
                product_id=target_prod.id,
                movement_type=mv_type,
                quantity_change=net_change,
                quantity_after=target_prod.stock_qty,
                note=f"Daily Warehouse Log ({log_date.strftime('%Y-%m-%d')}) | Vendor: {v_name or 'N/A'} | Added: +{calculated_added * mult}, Spoiled: -{data.spoiled_qty * mult}, Broken: -{data.broken_qty * mult}",
                created_by=admin_user.name,
                created_at=datetime.utcnow(),
            ))

        # Update unit_price if purchase price supplied
        if data.unit_cost > 0:
            target_prod.unit_price = data.unit_cost

    db.commit()
    db.refresh(log)
    return log


@router.put("/{log_id}", response_model=schemas.DailyInventoryLogOut)
def update_daily_inventory_log(
    log_id: int,
    data: schemas.DailyInventoryLogUpdate,
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin),
):
    """Edit a Daily Inventory Log entry and re-adjust stock levels."""
    log = db.query(models.DailyInventoryLog).filter(models.DailyInventoryLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Daily inventory log not found")

    old_net = log.added_qty - log.spoiled_qty - log.broken_qty

    if data.log_date is not None:
        log.log_date = data.log_date
    if data.vendor_id is not None:
        log.vendor_id = data.vendor_id
    if data.vendor_name is not None:
        log.vendor_name = data.vendor_name
    if data.peti_qty is not None:
        log.peti_qty = data.peti_qty
    if data.carton_qty is not None:
        log.carton_qty = data.carton_qty
    if data.loose_qty is not None:
        log.loose_qty = data.loose_qty

    if data.added_qty is not None and data.added_qty > 0:
        log.added_qty = data.added_qty
    elif (data.peti_qty is not None or data.carton_qty is not None or data.loose_qty is not None):
        log.added_qty = (log.peti_qty * 480.0) + (log.carton_qty * 360.0) + log.loose_qty

    if data.unit_cost is not None:
        log.unit_cost = data.unit_cost
    if data.spoilage_vendor_id is not None:
        log.spoilage_vendor_id = data.spoilage_vendor_id
    if data.spoilage_vendor_name is not None:
        log.spoilage_vendor_name = data.spoilage_vendor_name
    if data.spoilage_reason is not None:
        log.spoilage_reason = data.spoilage_reason
    if data.spoiled_qty is not None:
        log.spoiled_qty = data.spoiled_qty
    if data.broken_qty is not None:
        log.broken_qty = data.broken_qty
    if data.notes is not None:
        log.notes = data.notes

    if data.total_cost is not None:
        log.total_cost = data.total_cost
    else:
        log.total_cost = round(log.added_qty * log.unit_cost, 2)

    log.updated_at = datetime.utcnow()

    # Calculate stock adjustment delta
    new_net = log.added_qty - log.spoiled_qty - log.broken_qty
    diff = new_net - old_net

    if diff != 0 and log.product_id:
        prod = db.query(models.Product).filter(models.Product.id == log.product_id).first()
        if prod:
            target_prod = prod
            if prod.base_product_id:
                parent = db.query(models.Product).filter(models.Product.id == prod.base_product_id).first()
                if parent:
                    target_prod = parent

            target_prod.stock_qty += diff
            db.add(models.StockMovement(
                product_id=target_prod.id,
                movement_type="adjustment",
                quantity_change=diff,
                quantity_after=target_prod.stock_qty,
                note=f"Daily Log Adjustment (#{log.id})",
                created_by=admin_user.name,
                created_at=datetime.utcnow(),
            ))

    db.commit()
    db.refresh(log)
    return log


@router.delete("/{log_id}")
def delete_daily_inventory_log(
    log_id: int,
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin),
):
    """Delete a Daily Inventory Log entry and revert stock additions/deductions."""
    log = db.query(models.DailyInventoryLog).filter(models.DailyInventoryLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Daily inventory log not found")

    net_qty = log.added_qty - log.spoiled_qty - log.broken_qty

    if net_qty != 0 and log.product_id:
        prod = db.query(models.Product).filter(models.Product.id == log.product_id).first()
        if prod:
            target_prod = prod
            if prod.base_product_id:
                parent = db.query(models.Product).filter(models.Product.id == prod.base_product_id).first()
                if parent:
                    target_prod = parent

            target_prod.stock_qty -= net_qty
            db.add(models.StockMovement(
                product_id=target_prod.id,
                movement_type="adjustment",
                quantity_change=-net_qty,
                quantity_after=target_prod.stock_qty,
                note=f"Daily Log Deleted (#{log.id})",
                created_by=admin_user.name,
                created_at=datetime.utcnow(),
            ))

    db.delete(log)
    db.commit()
    return {"message": "Daily inventory log deleted successfully"}


@router.get("/export")
def export_daily_inventory_csv(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin_user: models.User = Depends(require_admin),
):
    """Export daily inventory log report to CSV with Vendor and Peti/Carton breakdown."""
    q = db.query(models.DailyInventoryLog)
    if start_date:
        try:
            q = q.filter(models.DailyInventoryLog.log_date >= datetime.strptime(start_date, "%Y-%m-%d"))
        except ValueError:
            pass
    if end_date:
        try:
            q = q.filter(models.DailyInventoryLog.log_date < datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1))
        except ValueError:
            pass
    if category:
        q = q.filter(models.DailyInventoryLog.category_name == category)

    logs = q.order_by(models.DailyInventoryLog.log_date.desc()).all()

    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow([
        "ID", "Date", "Vendor Name", "Product Name", "Category",
        "Petis Came (480)", "Cartons Came (360)", "Loose Eggs", "Total Added Eggs",
        "Unit Purchase Cost (PKR)", "Total Purchase Cost (PKR)",
        "Spoilage Vendor", "Spoilage Reason", "Spoiled Qty", "Broken Qty", "Net Stock Change", "Notes", "Logged By"
    ])

    for l in logs:
        net = l.added_qty - l.spoiled_qty - l.broken_qty
        writer.writerow([
            l.id,
            l.log_date.strftime("%Y-%m-%d"),
            l.vendor_name or "N/A",
            l.product_name,
            l.category_name,
            l.peti_qty or 0,
            l.carton_qty or 0,
            l.loose_qty or 0,
            l.added_qty,
            l.unit_cost,
            l.total_cost,
            l.spoilage_vendor_name or l.vendor_name or "N/A",
            l.spoilage_reason or "N/A",
            l.spoiled_qty,
            l.broken_qty,
            net,
            l.notes or "",
            l.created_by or "",
        ])

    out.seek(0)
    filename = f"warehouse_inventory_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        io.BytesIO(out.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

