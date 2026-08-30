"""Sign-in of the global administrator."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import GlobalAdmin
from ..schemas import AdminLogin, AdminOut, Token
from ..security import create_session_token, current_admin, verify_password
from ..service import log, utcnow

router = APIRouter(prefix="/api/central/auth", tags=["central-auth"])


@router.post("/login", response_model=Token)
def login(payload: AdminLogin, db: Session = Depends(get_db)):
    admin = (
        db.query(GlobalAdmin)
        .filter(GlobalAdmin.email == payload.email.strip().lower())
        .first()
    )
    if admin is None or not verify_password(payload.password, admin.hashed_password):
        raise HTTPException(status_code=401, detail="Identifiants invalides")
    if not admin.is_active:
        raise HTTPException(status_code=403, detail="Compte désactivé")
    admin.last_login = utcnow()
    db.commit()
    log(db, admin, None, "Connexion administrateur", "", admin.email)
    return Token(access_token=create_session_token(admin))


@router.get("/me", response_model=AdminOut)
def me(admin: GlobalAdmin = Depends(current_admin)):
    return admin
