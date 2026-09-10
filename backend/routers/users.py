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
    current_user: models.User = Depends(require_roles("admin")),
):
    existing = db.query(models.User).filter(models.User.username == data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    user = models.User(
        name=data.name,
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = data.model_dump(exclude_unset=True)
    if "password" in update_data:
        update_data["password_hash"] = hash_password(update_data.pop("password"))

    for field, value in update_data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
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

    db.delete(user)
    db.commit()
    return {"message": f"User '{user.username}' deleted successfully"}
