from typing import List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
from auth import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/", response_model=List[schemas.NotificationOut])
def list_notifications(
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return (
        db.query(models.NotificationLog)
        .order_by(models.NotificationLog.sent_at.desc())
        .limit(limit)
        .all()
    )


@router.get("/unread-count")
def get_unread_count(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    count = (
        db.query(models.NotificationLog)
        .filter(models.NotificationLog.delivery_status == "logged")
        .count()
    )
    return {"unread": count}
