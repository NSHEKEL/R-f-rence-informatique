import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import hash_password, require_admin
from ..database import get_db
from ..models import User
from ..schemas import UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])

ROLES = {"admin", "vendeur"}


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.query(User).order_by(User.name).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Rôle invalide")
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Cet email est déjà utilisé")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Mot de passe requis")
    user = User(
        name=payload.name.strip(),
        email=email,
        role=payload.role,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    if payload.role is not None and payload.role not in ROLES:
        raise HTTPException(status_code=400, detail="Rôle invalide")

    # Protect the last active admin from losing admin/being disabled.
    def _demoting_last_admin() -> bool:
        if user.role != "admin":
            return False
        losing_admin = payload.role is not None and payload.role != "admin"
        being_disabled = payload.is_active is False
        if not (losing_admin or being_disabled):
            return False
        active_admins = (
            db.query(User)
            .filter(User.role == "admin", User.is_active.is_(True))
            .count()
        )
        return active_admins <= 1

    if _demoting_last_admin():
        raise HTTPException(
            status_code=400,
            detail="Impossible : au moins un administrateur actif est requis",
        )

    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.email is not None:
        email = payload.email.strip().lower()
        existing = db.query(User).filter(User.email == email).first()
        if existing and existing.id != user.id:
            raise HTTPException(status_code=400, detail="Cet email est déjà utilisé")
        user.email = email
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.hashed_password = hash_password(payload.password)

    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Give a user a temporary password, shown once to the administrator."""
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    temporary = secrets.token_urlsafe(6)
    user.hashed_password = hash_password(temporary)
    db.commit()
    return {"password": temporary}


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if user.id == current_user.id:
        raise HTTPException(
            status_code=400, detail="Vous ne pouvez pas supprimer votre propre compte"
        )
    if user.role == "admin":
        active_admins = (
            db.query(User)
            .filter(User.role == "admin", User.is_active.is_(True))
            .count()
        )
        if active_admins <= 1:
            raise HTTPException(
                status_code=400,
                detail="Impossible : au moins un administrateur actif est requis",
            )
    db.delete(user)
    db.commit()
