from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
import models
import schemas
from auth import get_current_user, hash_password, require_roles

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/", response_model=List[schemas.UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    return db.query(models.User).all()


@router.post("/", response_model=schemas.UserOut)
def create_user(
    data: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin", "manager")),
):
    clean_username = (data.username or "").strip()
    clean_name = (data.name or "").strip()
    clean_email = (data.email or "").strip() if data.email else None

    if not clean_username:
        raise HTTPException(status_code=400, detail="Username is required")
    if not clean_name:
        raise HTTPException(status_code=400, detail="Full name is required")

    existing = db.query(models.User).filter(models.User.username.ilike(clean_username)).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Username '{clean_username}' is already taken. Please choose another username.")

    try:
        user = models.User(
            name=clean_name,
            username=clean_username,
            email=clean_email,
            password_hash=hash_password(data.password),
            role=data.role,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    except Exception as ex:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Failed to create user: {str(ex.orig if hasattr(ex, 'orig') else ex)}"
        )

    try:
        from routers.audit_log import log_action
        log_action(db, current_user, "create", "user", user.id, user.username,
                   f"Created user '{user.name}' with role '{user.role}'")
        db.commit()
    except Exception:
        pass

    return user


@router.put("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin", "manager")),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = data.model_dump(exclude_unset=True)
    if "password" in update_data:
        update_data["password_hash"] = hash_password(update_data.pop("password"))

    if "username" in update_data and update_data["username"]:
        update_data["username"] = update_data["username"].strip()
    if "name" in update_data and update_data["name"]:
        update_data["name"] = update_data["name"].strip()
    if "email" in update_data and update_data["email"]:
        update_data["email"] = update_data["email"].strip()

    try:
        for field, value in update_data.items():
            setattr(user, field, value)
        db.commit()
        db.refresh(user)
    except Exception as ex:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Failed to update user: {str(ex.orig if hasattr(ex, 'orig') else ex)}"
        )
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin", "manager")),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Clear Foreign Key dependencies so PostgreSQL FK constraint won't fail
    db.query(models.Order).filter(models.Order.assigned_staff_id == user_id).update({models.Order.assigned_staff_id: None}, synchronize_session=False)
    db.query(models.RiderLocation).filter(models.RiderLocation.rider_id == user_id).delete(synchronize_session=False)
    db.query(models.Task).filter(models.Task.assigned_to_id == user_id).update({models.Task.assigned_to_id: None}, synchronize_session=False)
    db.query(models.ChatMessage).filter(models.ChatMessage.sender_id == user_id).update({models.ChatMessage.sender_id: None}, synchronize_session=False)
    db.query(models.AuditLog).filter(models.AuditLog.user_id == user_id).update({models.AuditLog.user_id: None}, synchronize_session=False)

    deleted_username = user.username
    deleted_name = user.name
    db.delete(user)
    db.commit()

    try:
        from routers.audit_log import log_action
        log_action(db, current_user, "delete", "user", user_id, deleted_username,
                   f"Deleted user '{deleted_name}' (role: {user.role if hasattr(user, 'role') else 'unknown'})")
        db.commit()
    except Exception:
        pass

    return {"message": f"User '{deleted_username}' deleted successfully"}
