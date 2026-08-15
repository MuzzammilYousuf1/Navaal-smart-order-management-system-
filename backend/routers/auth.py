from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from sqlalchemy import func
from database import get_db
import models
import schemas
from auth import hash_password, verify_password, create_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=schemas.TokenResponse)
def login(data: schemas.LoginRequest, db: Session = Depends(get_db)):
    clean_username = (data.username or "").strip().lower()
    user = db.query(models.User).filter(func.lower(models.User.username) == clean_username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")

    password_ok = verify_password(data.password, user.password_hash)
    if not password_ok and data.password != data.password.strip():
        password_ok = verify_password(data.password.strip(), user.password_hash)

    if not password_ok:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Transparently migrate accounts created by the earlier SHA-256 scheme.
    if not user.password_hash.startswith("pbkdf2_sha256$"):
        user.password_hash = hash_password(data.password)
        db.commit()

    # JWT spec requires 'sub' claim to be a string
    token = create_access_token({"sub": str(user.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "role": user.role,
            "email": user.email,
        },
    }
