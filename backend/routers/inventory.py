"""
Inventory / Stock Management Router
- Product catalog CRUD
- Auto low-stock alerts
- Manual restock
- Stock movement audit log
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
from auth import get_current_user

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


# ─── Helper ───────────────────────────────────────────────────────────────────

def _log_movement(db, product: models.Product, change: int, m_type: str,
                  order_id=None, note=None, created_by=None):
    """Record a stock movement and update product stock_qty."""
    product.stock_qty += change
    mv = models.StockMovement(
        product_id=product.id,
        order_id=order_id,
        movement_type=m_type,
        quantity_change=change,
        quantity_after=product.stock_qty,
        note=note,
        created_by=created_by,
        created_at=datetime.utcnow(),
    )
    db.add(mv)

    # Auto low-stock notification
    if product.stock_qty <= product.low_stock_threshold:
        existing = db.query(models.NotificationLog).filter(
            models.NotificationLog.notification_type == "low_stock",
            models.NotificationLog.subject == f"LOW_STOCK_{product.sku}",
        ).order_by(models.NotificationLog.sent_at.desc()).first()

        # Only alert once per day per product
        if not existing or (datetime.utcnow() - existing.sent_at).total_seconds() > 86400:
            db.add(models.NotificationLog(
                notification_type="low_stock",
                subject=f"LOW_STOCK_{product.sku}",
                recipient="Warehouse Manager",
                message=(
                    f"LOW STOCK ALERT: {product.name} (SKU: {product.sku}) "
                    f"has only {product.stock_qty} units remaining "
                    f"(threshold: {product.low_stock_threshold} units). "
                    f"Please restock soon."
                ),
                delivery_status="logged",
            ))
    return mv


# ─── Product CRUD ─────────────────────────────────────────────────────────────

def compute_stock_qty(p: models.Product, base_stocks: dict) -> float:
    """Pack products derive their qty from base stock. Base products use their own stock_qty."""
    if p.base_product_id and p.base_product_id in base_stocks:
        base_qty = base_stocks[p.base_product_id]
        mult = p.unit_multiplier or 1.0
        if mult <= 0:
            return 0.0
        return round(base_qty / mult, 2)  # e.g. 3000 eggs / 6 = 500 packs
    return p.stock_qty


@router.get("/products", response_model=List[schemas.ProductOut])
def list_products(
    active_only: bool = True,
    category: Optional[str] = None,
    low_stock_only: bool = False,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.Product)
    if active_only:
        q = q.filter(models.Product.is_active == True)
    if category:
        q = q.filter(models.Product.category == category)
    products = q.order_by(models.Product.name).all()

    # Pre-fetch all products stock to construct computed stocks
    base_stocks = {p.id: p.stock_qty for p in db.query(models.Product.id, models.Product.stock_qty).all()}

    result = []
    for p in products:
        computed_qty = compute_stock_qty(p, base_stocks)
        p_out = schemas.ProductOut.model_validate(p)
        p_out.stock_qty = computed_qty
        result.append(p_out)

    if low_stock_only:
        result = [r for r in result if r.stock_qty <= r.low_stock_threshold]

    return result


@router.post("/products", response_model=schemas.ProductOut)
def create_product(
    data: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can add products")

    existing = db.query(models.Product).filter(models.Product.sku == data.sku).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"SKU '{data.sku}' already exists")

    # Pack/subunit products NEVER store their own stock — their qty is computed from the base product.
    # Base (bulk) products store real stock_qty.
    is_pack = bool(data.base_product_id)

    product = models.Product(
        name=data.name,
        sku=data.sku,
        category=data.category,
        unit=data.unit,
        unit_price=data.unit_price,
        stock_qty=0.0,          # Always start at 0; _log_movement will add for base products
        low_stock_threshold=data.low_stock_threshold,
        base_product_id=data.base_product_id,
        unit_multiplier=data.unit_multiplier,
        is_active=True,
        created_at=datetime.utcnow(),
    )
    db.add(product)
    db.flush()

    # Only log initial stock movement for BASE (bulk) products, not packs
    if data.stock_qty > 0 and not is_pack:
        _log_movement(db, product, data.stock_qty, "restock",
                      note="Initial stock entry", created_by=current_user.name)

    db.commit()
    db.refresh(product)

    # Compute stock
    base_stocks = {p.id: p.stock_qty for p in db.query(models.Product.id, models.Product.stock_qty).all()}
    computed_qty = compute_stock_qty(product, base_stocks)

    p_out = schemas.ProductOut.model_validate(product)
    p_out.stock_qty = computed_qty
    return p_out


@router.get("/products/{product_id}", response_model=schemas.ProductOut)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    base_stocks = {x.id: x.stock_qty for x in db.query(models.Product.id, models.Product.stock_qty).all()}
    computed_qty = compute_stock_qty(p, base_stocks)

    p_out = schemas.ProductOut.model_validate(p)
    p_out.stock_qty = computed_qty
    return p_out


@router.put("/products/{product_id}", response_model=schemas.ProductOut)
def update_product(
    product_id: int,
    data: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can update products")
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(p, field, value)

    db.commit()
    db.refresh(p)

    base_stocks = {x.id: x.stock_qty for x in db.query(models.Product.id, models.Product.stock_qty).all()}
    computed_qty = compute_stock_qty(p, base_stocks)

    p_out = schemas.ProductOut.model_validate(p)
    p_out.stock_qty = computed_qty
    return p_out


@router.post("/products/{product_id}/restock", response_model=schemas.ProductOut)
def restock_product(
    product_id: int,
    data: schemas.RestockRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager", "warehouse"):
        raise HTTPException(status_code=403, detail="Not authorized to restock")
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")

    # Pack products: always restock the base/bulk product, converting pack qty → base qty
    # Base products: restock directly
    if p.base_product_id:
        base_p = db.query(models.Product).filter(models.Product.id == p.base_product_id).first()
        if not base_p:
            raise HTTPException(status_code=400, detail="Parent bulk product not found")
        mult = p.unit_multiplier or 1.0
        change = round(data.quantity * mult, 2)  # e.g. 50 packs × 6 = 300 eggs
        note = data.note or (
            f"Restock via pack '{p.name}': {data.quantity} packs × {mult} = {change} {base_p.unit}s added to '{base_p.name}'"
        )
        _log_movement(db, base_p, change, "restock", note=note, created_by=current_user.name)
    else:
        # Direct bulk restock
        note = data.note or f"Bulk restock: +{data.quantity} {p.unit}s added"
        _log_movement(db, p, data.quantity, "restock", note=note, created_by=current_user.name)

    db.commit()
    db.refresh(p)

    base_stocks = {x.id: x.stock_qty for x in db.query(models.Product.id, models.Product.stock_qty).all()}
    computed_qty = compute_stock_qty(p, base_stocks)

    p_out = schemas.ProductOut.model_validate(p)
    p_out.stock_qty = computed_qty
    return p_out


@router.post("/products/{product_id}/set-stock", response_model=schemas.ProductOut)
def set_stock(
    product_id: int,
    data: schemas.RestockRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """SET stock to an exact absolute value. Use to correct doubled/wrong stock levels."""
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can correct stock")
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if p.base_product_id:
        raise HTTPException(
            status_code=400,
            detail="Cannot set stock on a pack product — it is computed from its base product automatically."
        )
    if data.quantity < 0:
        raise HTTPException(status_code=400, detail="Stock cannot be negative")

    old_qty = p.stock_qty
    change = data.quantity - old_qty
    note = data.note or f"Stock correction: set to {data.quantity} {p.unit}s (was {old_qty})"

    p.stock_qty = data.quantity
    db.add(models.StockMovement(
        product_id=p.id,
        movement_type="adjustment",
        quantity_change=change,
        quantity_after=p.stock_qty,
        note=note,
        created_by=current_user.name,
        created_at=datetime.utcnow(),
    ))
    db.commit()
    db.refresh(p)

    base_stocks = {x.id: x.stock_qty for x in db.query(models.Product.id, models.Product.stock_qty).all()}
    p_out = schemas.ProductOut.model_validate(p)
    p_out.stock_qty = compute_stock_qty(p, base_stocks)
    return p_out


@router.post("/products/{product_id}/spoilage", response_model=schemas.ProductOut)
def report_spoilage(
    product_id: int,
    data: schemas.SpoilageRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Report spoiled / broken / damaged stock.
    Deducts stock from base bulk item (or directly for standalone items).
    Automatically reduces available packs across all subunits.
    """
    if current_user.role not in ("admin", "manager", "warehouse"):
        raise HTTPException(status_code=403, detail="Not authorized to report spoilage")
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.quantity <= 0:
        raise HTTPException(status_code=400, detail="Spoiled quantity must be positive")

    action_label = {
        "sent_in_order": "Sent with Customer Order",
        "discarded": "Discarded / Dumped",
        "staff_use": "Staff / Internal Usage",
        "returned_to_supplier": "Returned to Supplier",
        "other": "Other Action",
    }.get(data.action, data.action or "Spoilage/Broken")

    action_details = f"Action: {action_label}"
    if data.order_number:
        action_details += f" (Order #{data.order_number})"
    if data.note:
        action_details += f" | Note: {data.note}"

    # Pack products: convert pack spoilage -> base bulk units and deduct from parent bulk product
    if p.base_product_id:
        base_p = db.query(models.Product).filter(models.Product.id == p.base_product_id).first()
        if not base_p:
            raise HTTPException(status_code=400, detail="Parent bulk product not found")
        mult = p.unit_multiplier or 1.0
        deduct_qty = round(data.quantity * mult, 2)
        note = f"Spoilage/Broken via '{p.name}': {data.quantity} packs ({deduct_qty} {base_p.unit}s) | {action_details}"
        _log_movement(db, base_p, -deduct_qty, "spoilage", note=note, created_by=current_user.name)
    else:
        # Direct bulk / standalone product spoilage
        note = f"Spoilage/Broken reported: -{data.quantity} {p.unit}s | {action_details}"
        _log_movement(db, p, -data.quantity, "spoilage", note=note, created_by=current_user.name)

    db.commit()
    db.refresh(p)

    base_stocks = {x.id: x.stock_qty for x in db.query(models.Product.id, models.Product.stock_qty).all()}
    computed_qty = compute_stock_qty(p, base_stocks)
    p_out = schemas.ProductOut.model_validate(p)
    p_out.stock_qty = computed_qty
    return p_out



# ─── Stock Movements Log ──────────────────────────────────────────────────────

@router.get("/movements", response_model=List[schemas.StockMovementOut])
def list_movements(
    product_id: Optional[int] = None,
    movement_type: Optional[str] = None,
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    q = db.query(models.StockMovement)
    if product_id:
        q = q.filter(models.StockMovement.product_id == product_id)
    if movement_type:
        q = q.filter(models.StockMovement.movement_type == movement_type)
    return q.order_by(models.StockMovement.created_at.desc()).limit(limit).all()


# ─── Dashboard Summary ────────────────────────────────────────────────────────

@router.get("/summary")
def inventory_summary(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Quick summary for Dashboard KPI card."""
    all_products = db.query(models.Product).filter(models.Product.is_active == True).all()
    base_stocks = {p.id: p.stock_qty for p in db.query(models.Product.id, models.Product.stock_qty).all()}

    low_stock = []
    out_of_stock = []
    total_value = 0.0

    for p in all_products:
        computed_qty = compute_stock_qty(p, base_stocks)
        if computed_qty <= p.low_stock_threshold:
            low_stock.append(p)
        if computed_qty == 0:
            out_of_stock.append(p)
        # Only count base bulk physical stock in inventory valuation (avoid double-counting subitem packs)
        if p.base_product_id is None:
            total_value += p.stock_qty * p.unit_price

    return {
        "total_products": len(all_products),
        "low_stock_count": len(low_stock),
        "out_of_stock_count": len(out_of_stock),
        "total_inventory_value": round(total_value, 2),
        "low_stock_products": [
            {"id": p.id, "name": p.name, "sku": p.sku, "stock_qty": compute_stock_qty(p, base_stocks),
             "low_stock_threshold": p.low_stock_threshold}
            for p in low_stock
        ],
    }


@router.delete("/products/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admin/manager can delete products")
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    p.is_active = False
    db.commit()
    return {"message": f"Product '{p.name}' deactivated/removed successfully"}
