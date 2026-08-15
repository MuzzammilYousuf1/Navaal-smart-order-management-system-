import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
import models

# Set SOF_SECRET_KEY on the server in production.  A random development key
# prevents a source-code secret from being used to forge login tokens.
SECRET_KEY = os.getenv("SOF_SECRET_KEY") or "navaal_smart_orderflow_secret_key_2026_dev_fallback"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    """Return a salted PBKDF2 hash suitable for passwords created today."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000)
    return f"pbkdf2_sha256$600000${salt.hex()}${digest.hex()}"


def verify_password(plain: str, hashed: str) -> bool:
    # Existing users retain access and are upgraded automatically on login.
    if hashed.startswith("pbkdf2_sha256$"):
        try:
            _, iterations, salt_hex, expected = hashed.split("$", 3)
            actual = hashlib.pbkdf2_hmac(
                "sha256", plain.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
            ).hex()
            return hmac.compare_digest(actual, expected)
        except (TypeError, ValueError):
            return False

    legacy = hashlib.sha256(("navaal_salt_2026_" + plain).encode("utf-8")).hexdigest()
    return hmac.compare_digest(legacy, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = int(sub)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def require_roles(*roles):
    def checker(current_user: models.User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(roles)}",
            )
        return current_user
    return checker
