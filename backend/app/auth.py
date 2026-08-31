import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import bcrypt
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .paths import data_dir


def _secret_key() -> str:
    """Signing key: from the environment on a server, generated once locally.

    A shared deployment must set SECRET_KEY so every workstation validates the
    same tokens; the desktop package keeps a generated key beside its database
    so that restarting the app does not log everyone out.
    """
    from_env = os.getenv("SECRET_KEY", "").strip()
    if from_env:
        return from_env
    key_file = (
        data_dir() / "secret.key"
        if getattr(sys, "frozen", False)
        else Path(__file__).resolve().parent.parent / ".secret.key"
    )
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    generated = secrets.token_urlsafe(48)
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key_file.write_text(generated, encoding="utf-8")
    return generated


SECRET_KEY = _secret_key()
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 12))
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Identifiants invalides",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.id == int(user_id)).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Compte désactivé")
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Accès réservé aux administrateurs",
        )
    return current_user


def require_stock_manager(
    current_user: User = Depends(get_current_user),
) -> User:
    """Administrators and stock managers: catalogue, stock and purchases."""
    if current_user.role not in ("admin", "gestionnaire"):
        raise HTTPException(
            status_code=403,
            detail="Accès réservé à la gestion de stock",
        )
    return current_user


def require_cashier(current_user: User = Depends(get_current_user)) -> User:
    """Administrators and cashiers: till sessions and sales."""
    if current_user.role not in ("admin", "vendeur"):
        raise HTTPException(
            status_code=403,
            detail="Accès réservé à la caisse",
        )
    return current_user
