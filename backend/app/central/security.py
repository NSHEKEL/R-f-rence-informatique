"""Authentication of the console and signature of the licences it issues.

Two very different secrets live here:

* the console session key (``CENTRAL_SECRET_KEY``), which signs the tokens of
  the global administrator;
* an RSA key pair whose *private* half never leaves the server and signs every
  licence answer. An installation only holds the public half, so editing its
  local database or files cannot turn a Business licence into an Entreprise
  one: the signature would no longer match.
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .database import get_db
from .models import GlobalAdmin

ALGORITHM = "HS256"
LICENSE_ALGORITHM = "RS256"
SESSION_MINUTES = int(os.getenv("CENTRAL_SESSION_MINUTES", "120"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/central/auth/login")


def _key_dir() -> Path:
    directory = Path(
        os.getenv("CENTRAL_DATA_DIR", "").strip()
        or Path(__file__).resolve().parent.parent.parent
    )
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _read_or_create(name: str, factory) -> str:
    path = _key_dir() / name
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    value = factory()
    path.write_text(value, encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:  # Windows / restricted filesystems
        pass
    return value


def session_key() -> str:
    from_env = os.getenv("CENTRAL_SECRET_KEY", "").strip()
    if from_env:
        return from_env
    return _read_or_create(
        "central-session.key", lambda: secrets.token_urlsafe(48)
    )


def _generate_private_key() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")


def license_private_key() -> str:
    from_env = os.getenv("CENTRAL_LICENSE_PRIVATE_KEY", "").strip()
    if from_env:
        return from_env.replace("\\n", "\n")
    return _read_or_create("license-private.pem", _generate_private_key)


def license_public_key() -> str:
    private = serialization.load_pem_private_key(
        license_private_key().encode("utf-8"), password=None
    )
    return (
        private.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )


def sign_license(payload: dict) -> str:
    """Signed statement of what an installation is allowed to do."""
    body = payload.copy()
    body["iat"] = int(datetime.now(timezone.utc).timestamp())
    return jwt.encode(
        body, license_private_key(), algorithm=LICENSE_ALGORITHM
    )


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8")[:72], bcrypt.gensalt()
    ).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))


def create_session_token(admin: GlobalAdmin) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=SESSION_MINUTES)
    return jwt.encode(
        {"sub": str(admin.id), "scope": "global_admin", "exp": expire},
        session_key(),
        algorithm=ALGORITHM,
    )


def current_admin(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> GlobalAdmin:
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session administrateur global invalide",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, session_key(), algorithms=[ALGORITHM])
    except JWTError:
        raise invalid
    if payload.get("scope") != "global_admin":
        raise invalid
    subject = payload.get("sub")
    admin = (
        db.query(GlobalAdmin).filter(GlobalAdmin.id == int(subject)).first()
        if subject
        else None
    )
    if admin is None or not admin.is_active:
        raise invalid
    return admin
