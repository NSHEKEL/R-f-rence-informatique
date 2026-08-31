"""Sign-in of the global administrator."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import GlobalAdmin
from ..schemas import AdminLogin, AdminOut, AdminSetup, SetupState, Token
from ..security import (
    create_session_token,
    current_admin,
    hash_password,
    verify_password,
)
from ..service import log, utcnow

router = APIRouter(prefix="/api/central/auth", tags=["central-auth"])


@router.get("/setup", response_model=SetupState)
def setup_state(db: Session = Depends(get_db)):
    """A brand new central server has no owner yet: the console asks for one."""
    return SetupState(needed=db.query(GlobalAdmin).count() == 0)


@router.post("/setup", response_model=Token, status_code=201)
def create_first_admin(payload: AdminSetup, db: Session = Depends(get_db)):
    if db.query(GlobalAdmin).count():
        raise HTTPException(
            status_code=403, detail="Un administrateur global existe déjà"
        )
    if len(payload.password) < 8:
        raise HTTPException(
            status_code=400, detail="Mot de passe : 8 caractères au minimum"
        )
    admin = GlobalAdmin(
        name=payload.name.strip() or "Administrateur global",
        email=payload.email.strip().lower(),
        hashed_password=hash_password(payload.password),
        is_active=True,
        last_login=utcnow(),
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    log(db, admin, None, "Création administrateur global", "", admin.email)
    return Token(access_token=create_session_token(admin))


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
