"""
Vendor / Supplier Management Router
- CRUD operations for Egg Farms, Suppliers & Wholesale Vendors
- Vendor Spoilage & Quality Accountability Reports
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
import models
import schemas
from auth import get_current_user

router = APIRouter(prefix="/api/vendors", tags=["vendors"])


def require_admin_or_manager(current_user: models.User = Depends(get_current_user)):
    if current_user.role not in ("admin", "manager", "warehouse"):
        raise HTTPException(status_code=403, detail="Not authorized to manage vendors")
    return current_user


@router.get("", response_model=List[schemas.VendorOut])
def list_vendors(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_manager),
):
    """List all vendors."""
    return db.query(models.Vendor).order_by(models.Vendor.name.asc()).all()


@router.post("", response_model=schemas.VendorOut)
def create_vendor(
    data: schemas.VendorCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_manager),
):
    """Create a new vendor/farm."""
    existing = db.query(models.Vendor).filter(
        func.lower(models.Vendor.name) == data.name.strip().lower()
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Vendor '{data.name}' already exists")

    vendor = models.Vendor(
        name=data.name.strip(),
        contact_person=data.contact_person,
        phone=data.phone,
        email=data.email,
        address=data.address,
        notes=data.notes,
        created_at=datetime.utcnow(),
    )
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


@router.put("/{vendor_id}", response_model=schemas.VendorOut)
def update_vendor(
    vendor_id: int,
    data: schemas.VendorUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_manager),
):
    """Update vendor info."""
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    for field, val in data.model_dump(exclude_unset=True).items():
        if field == "name" and val:
            val = val.strip()
        setattr(vendor, field, val)

    db.commit()
    db.refresh(vendor)
    return vendor


@router.delete("/{vendor_id}")
def delete_vendor(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_manager),
):
    """Delete a vendor."""
    vendor = db.query(models.Vendor).filter(models.Vendor.id == vendor_id).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    db.delete(vendor)
    db.commit()
    return {"message": "Vendor deleted successfully"}


@router.get("/accountability", response_model=List[schemas.VendorAccountabilityItem])
def get_vendor_accountability_report(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_admin_or_manager),
):
    """
    Get vendor-wise accountability metrics:
    - Petis supplied (480 eggs each)
    - Cartons supplied (360 eggs each)
    - Loose eggs supplied
    - Total eggs supplied
    - Total cost (PKR)
    - Total spoilage & breakage attributed to vendor
    - Total PKR Loss
    - Spoilage Rate %
    """
    q = db.query(models.DailyInventoryLog)
    if start_date:
        try:
            st = datetime.strptime(start_date, "%Y-%m-%d")
            q = q.filter(models.DailyInventoryLog.log_date >= st)
        except ValueError:
            pass
    if end_date:
        try:
            et = datetime.strptime(end_date, "%Y-%m-%d")
            q = q.filter(models.DailyInventoryLog.log_date <= et)
        except ValueError:
            pass

    logs = q.all()
    all_vendors = db.query(models.Vendor).all()

    stats_map = {}

    # Initialize stats for existing registered vendors
    for v in all_vendors:
        stats_map[v.name] = {
            "vendor_id": v.id,
            "vendor_name": v.name,
            "total_petis": 0.0,
            "total_cartons": 0.0,
            "total_loose": 0.0,
            "total_eggs_received": 0.0,
            "total_cost_pkr": 0.0,
            "total_spoiled_eggs": 0.0,
            "total_broken_eggs": 0.0,
            "total_loss_pkr": 0.0,
        }

    # Aggregate entries
    for l in logs:
        # Received attribution
        v_name = l.vendor_name or "Unassigned Vendor"
        if v_name not in stats_map:
            stats_map[v_name] = {
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

        stats_map[v_name]["total_petis"] += l.peti_qty or 0.0
        stats_map[v_name]["total_cartons"] += l.carton_qty or 0.0
        stats_map[v_name]["total_loose"] += l.loose_qty or 0.0
        stats_map[v_name]["total_eggs_received"] += l.added_qty or 0.0
        stats_map[v_name]["total_cost_pkr"] += l.total_cost or 0.0

        # Spoilage attribution (could be a different vendor if specified)
        sp_v_name = l.spoilage_vendor_name or v_name
        if sp_v_name not in stats_map:
            stats_map[sp_v_name] = {
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
        unit_c = l.unit_cost or 0.0

        stats_map[sp_v_name]["total_spoiled_eggs"] += sp_qty
        stats_map[sp_v_name]["total_broken_eggs"] += brk_qty
        stats_map[sp_v_name]["total_loss_pkr"] += round((sp_qty + brk_qty) * unit_c, 2)

    result = []
    for item in stats_map.values():
        total_recv = item["total_eggs_received"]
        total_bad = item["total_spoiled_eggs"] + item["total_broken_eggs"]
        rate = round((total_bad / total_recv * 100), 2) if total_recv > 0 else 0.0

        # Only list vendors with received stock or recorded spoilage
        if total_recv > 0 or total_bad > 0:
            result.append(schemas.VendorAccountabilityItem(
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

    return sorted(result, key=lambda x: x.total_eggs_received, reverse=True)
