"""
Activity / Audit Log Router
GET  /api/audit  — List activity log entries (admin/manager only)
"""
from typing import Optional, List
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
import models
from auth import get_current_user

router = APIRouter(prefix="/api/audit", tags=["audit"])


# ─── Helper — call this from anywhere to record an action ─────────────────────

def log_action(
    db: Session,
    user: models.User,
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    resource_label: Optional[str] = None,
    detail: Optional[str] = None,
    ip_address: Optional[str] = None,
):
    """
    Write an immutable audit trail entry.
    Call this after any significant CRUD / operational event.
    """
    try:
        entry = models.AuditLog(
            user_id=user.id if user else None,
            user_name=user.name if user else "System",
            user_role=user.role if user else "system",
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            resource_label=resource_label,
            detail=detail,
            ip_address=ip_address,
            created_at=datetime.utcnow(),
        )
        db.add(entry)
        # NOTE: caller is responsible for db.commit()
    except Exception:
        pass  # Never let audit logging break primary operations


# ─── API Endpoints ─────────────────────────────────────────────────────────────

@router.get("")
def list_audit_log(
    limit: int = Query(200, le=500),
    offset: int = Query(0, ge=0),
    user_name: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Retrieve audit log entries — admin/manager only."""
    if current_user.role not in ("admin", "manager"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Not authorized to view audit log")

    since = datetime.utcnow() - timedelta(days=days)
    q = db.query(models.AuditLog).filter(models.AuditLog.created_at >= since)

    if user_name:
        q = q.filter(models.AuditLog.user_name.ilike(f"%{user_name}%"))
    if action:
        q = q.filter(models.AuditLog.action == action)
    if resource_type:
        q = q.filter(models.AuditLog.resource_type == resource_type)

    total = q.count()
    entries = q.order_by(models.AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "entries": [
            {
                "id": e.id,
                "user_name": e.user_name,
                "user_role": e.user_role,
                "action": e.action,
                "resource_type": e.resource_type,
                "resource_id": e.resource_id,
                "resource_label": e.resource_label,
                "detail": e.detail,
                "ip_address": e.ip_address,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in entries
        ],
    }


@router.get("/summary")
def audit_summary(
    days: int = Query(7, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Quick stats for the activity dashboard."""
    if current_user.role not in ("admin", "manager"):
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Not authorized")

    since = datetime.utcnow() - timedelta(days=days)
    entries = db.query(models.AuditLog).filter(models.AuditLog.created_at >= since).all()

    by_user: dict = {}
    by_action: dict = {}
    for e in entries:
        u = e.user_name or "Unknown"
        by_user[u] = by_user.get(u, 0) + 1
        a = e.action or "unknown"
        by_action[a] = by_action.get(a, 0) + 1

    return {
        "total_actions": len(entries),
        "by_user": [{"name": k, "count": v} for k, v in sorted(by_user.items(), key=lambda x: -x[1])],
        "by_action": [{"action": k, "count": v} for k, v in sorted(by_action.items(), key=lambda x: -x[1])],
    }
