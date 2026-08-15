"""
Tasks & Reports Management Router
- Create tasks (assign to specific staff)
- View to-do list / assigned tasks
- Complete task by submitting inventory/egg reports
- Automatic inventory adjustments for spoiled/broken stock
"""
from typing import List, Optional
from datetime import datetime
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
from auth import get_current_user
from sla_engine import broadcast_ws_message

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.post("", response_model=schemas.TaskOut)
def create_task(
    data: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admins or managers can assign tasks")

    assigned_user = None
    if data.assigned_to_id:
        assigned_user = db.query(models.User).filter(models.User.id == data.assigned_to_id).first()
        if not assigned_user:
            raise HTTPException(status_code=400, detail="Assigned user not found")

    task = models.Task(
        title=data.title,
        description=data.description,
        assigned_to_id=data.assigned_to_id,
        assigned_to_name=assigned_user.name if assigned_user else data.assigned_to_name,
        assigned_by=current_user.name,
        due_date=data.due_date,
        status="pending",
        requires_report=data.requires_report,
        form_schema=data.form_schema,
        created_at=datetime.utcnow(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    msg = f"Task '{task.title}' has been assigned to {task.assigned_to_name or 'unassigned'} by {current_user.name}."
    db.add(models.NotificationLog(
        notification_type="info",
        subject=f"TASK_ASSIGNED_{task.id}",
        recipient=task.assigned_to_name or "Operations Team",
        message=msg,
        delivery_status="logged",
        sent_at=datetime.utcnow(),
    ))
    db.commit()

    broadcast_ws_message({
        "type": "sla_alert",
        "order_number": f"TASK #{task.id}",
        "customer_name": "New Task Assigned",
        "notification_type": "info",
        "message": task.title,
        "timestamp": datetime.utcnow().isoformat(),
    })

    return task


@router.get("", response_model=List[schemas.TaskOut])
def list_tasks(
    status: Optional[str] = None,
    assigned_to_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    query = db.query(models.Task)

    if status:
        query = query.filter(models.Task.status == status)
    if assigned_to_id:
        query = query.filter(models.Task.assigned_to_id == assigned_to_id)
    
    # If the user is warehouse or rider, they can filter but default to seeing their own tasks or unassigned ones
    if current_user.role not in ("admin", "manager") and not assigned_to_id:
        query = query.filter(
            (models.Task.assigned_to_id == current_user.id) | 
            (models.Task.assigned_to_id == None)
        )

    return query.order_by(models.Task.created_at.desc()).all()


@router.get("/{task_id}", response_model=schemas.TaskOut)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/{task_id}/complete", response_model=schemas.TaskOut)
def complete_task(
    task_id: int,
    report: schemas.TaskReportSubmit,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status == "completed":
        raise HTTPException(status_code=400, detail="Task is already completed")

    # Load the product for stock adjustments
    product = db.query(models.Product).filter(models.Product.id == report.product_id).first()
    if not product:
        raise HTTPException(status_code=400, detail="Product not found")

    # Determine base/target product for stock modification
    target_product = product
    multiplier = 1.0
    if product.base_product_id:
        base_p = db.query(models.Product).filter(models.Product.id == product.base_product_id).first()
        if base_p:
            target_product = base_p
            multiplier = product.unit_multiplier or 1.0

    original_stock = target_product.stock_qty

    # Scale reported spoiled/broken values if the report was submitted for a pack product
    scaled_spoiled = int(report.spoiled_qty * multiplier)
    scaled_broken = int(report.broken_qty * multiplier)
    total_lost = scaled_spoiled + scaled_broken

    # Calculate new stock level
    if report.actual_qty is not None:
        scaled_actual = int(report.actual_qty * multiplier)
        new_stock = scaled_actual
    else:
        new_stock = original_stock - total_lost

    stock_change = new_stock - original_stock

    # Apply inventory stock change in database
    target_product.stock_qty = new_stock

    # Record stock movement log
    note_details = f"Task #{task.id} report. Spoiled: {report.spoiled_qty}, Broken: {report.broken_qty}"
    if report.notes:
        note_details += f". Note: {report.notes}"

    movement = models.StockMovement(
        product_id=target_product.id,
        movement_type="adjustment",
        quantity_change=stock_change,
        quantity_after=new_stock,
        note=note_details,
        created_by=current_user.name,
        created_at=datetime.utcnow(),
    )
    db.add(movement)

    # Save the report details as JSON on the Task
    report_dict = {
        "product_id": product.id,
        "product_name": product.name,
        "unit": product.unit,
        "opening_stock": int(original_stock // multiplier),
        "spoiled_qty": report.spoiled_qty,
        "broken_qty": report.broken_qty,
        "actual_qty": report.actual_qty if report.actual_qty is not None else int(new_stock // multiplier),
        "notes": report.notes
    }
    task.report_json = json.dumps(report_dict)
    task.status = "completed"
    task.completed_at = datetime.utcnow()

    # Low stock alert after adjustment
    if target_product.stock_qty <= target_product.low_stock_threshold:
        db.add(models.NotificationLog(
            notification_type="low_stock",
            subject=f"LOW_STOCK_{target_product.sku}",
            recipient="Warehouse Manager",
            message=(
                f"LOW STOCK: {target_product.name} now has only {target_product.stock_qty} "
                f"{target_product.unit}s remaining after Task #{task.id} report adjustment."
            ),
            delivery_status="logged",
            sent_at=datetime.utcnow(),
        ))

    db.commit()
    db.refresh(task)

    # Notify completion
    db.add(models.NotificationLog(
        notification_type="info",
        subject=f"TASK_COMPLETED_{task.id}",
        recipient="Manager",
        message=f"Task '{task.title}' completed by {current_user.name}. Report submitted.",
        delivery_status="logged",
        sent_at=datetime.utcnow(),
    ))
    db.commit()

    broadcast_ws_message({
        "type": "sla_alert",
        "order_number": f"TASK #{task.id}",
        "customer_name": "Task Completed",
        "notification_type": "success",
        "message": f"Completed by {current_user.name}",
        "timestamp": datetime.utcnow().isoformat(),
    })

    return task


@router.post("/{task_id}/complete-form", response_model=schemas.TaskOut)
def complete_task_form(
    task_id: int,
    response: schemas.TaskFormResponse,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Complete a task by submitting custom form field responses.
    Used when task.requires_report=True and task.form_schema is set.
    """
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status == "completed":
        raise HTTPException(status_code=400, detail="Task is already completed")

    # Save the responses as JSON
    report_data = {
        "form_responses": response.responses,
        "notes": response.notes,
        "submitted_by": current_user.name,
        "submitted_at": datetime.utcnow().isoformat(),
    }
    task.report_json = json.dumps(report_data)
    task.status = "completed"
    task.completed_at = datetime.utcnow()

    db.add(models.NotificationLog(
        notification_type="info",
        subject=f"TASK_FORM_COMPLETED_{task.id}",
        recipient="Manager",
        message=f"Task '{task.title}' form report completed by {current_user.name}.",
        delivery_status="logged",
        sent_at=datetime.utcnow(),
    ))

    db.commit()
    db.refresh(task)

    broadcast_ws_message({
        "type": "sla_alert",
        "order_number": f"TASK #{task.id}",
        "customer_name": "Form Report Submitted",
        "notification_type": "success",
        "message": f"Completed by {current_user.name}",
        "timestamp": datetime.utcnow().isoformat(),
    })

    return task
