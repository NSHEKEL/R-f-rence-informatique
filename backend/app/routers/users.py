import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..accounts import (
    identifier_error,
    identifier_taken,
    log_event,
    normalize_identifier,
    password_error,
)
from ..auth import get_current_user, hash_password, require_admin
from ..database import get_db
from ..licensing import has_feature
from ..models import User
from ..schemas import UserCreate, UserOut, UserPhoto, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])

ROLES = {"admin", "vendeur", "gestionnaire"}


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
    if not has_feature(db, "multi_utilisateurs"):
        others = db.query(User).filter(User.is_active.is_(True)).count()
        if others >= 1:
            raise HTTPException(
                status_code=403,
                detail=(
                    "🔒 Multi-utilisateurs n'est pas inclus dans votre "
                    "formule : un seul compte est autorisé."
                ),
            )
    email = normalize_identifier(payload.email)
    problem = identifier_error(email)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if identifier_taken(db, email):
        raise HTTPException(
            status_code=400, detail="Cet identifiant est déjà utilisé"
        )
    weak = password_error(payload.password)
    if weak:
        raise HTTPException(status_code=400, detail=weak)
    user = User(
        name=payload.name.strip(),
        email=email,
        role=payload.role,
        photo=payload.photo,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_event(db, "utilisateur_cree", user=user, detail=f"Rôle {user.role}")
    return user


@router.put("/me/photo", response_model=UserOut)
def update_my_photo(
    payload: UserPhoto,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Everyone may change their own picture, whatever their role."""
    current_user.photo = payload.photo
    db.commit()
    db.refresh(current_user)
    return current_user


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

    changes: list[str] = []
    if payload.name is not None:
        user.name = payload.name.strip()
    if payload.email is not None:
        email = normalize_identifier(payload.email)
        problem = identifier_error(email)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        if identifier_taken(db, email, keep_id=user.id):
            raise HTTPException(
                status_code=400, detail="Cet identifiant est déjà utilisé"
            )
        if email != user.email:
            changes.append(f"identifiant {user.email} → {email}")
        user.email = email
    if payload.role is not None:
        if payload.role != user.role:
            changes.append(f"rôle {user.role} → {payload.role}")
        user.role = payload.role
    if payload.photo is not None:
        user.photo = payload.photo
    if payload.is_active is not None:
        if payload.is_active != user.is_active:
            changes.append("réactivation" if payload.is_active else "désactivation")
        user.is_active = payload.is_active
    if payload.password:
        weak = password_error(payload.password)
        if weak:
            raise HTTPException(status_code=400, detail=weak)
        user.hashed_password = hash_password(payload.password)
        changes.append("mot de passe changé")

    db.commit()
    db.refresh(user)
    log_event(
        db,
        "utilisateur_modifie",
        user=user,
        detail="; ".join(changes) or "aucun changement",
        station=f"par {current_user.email}",
    )
    return user


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Give a user a temporary password, shown once to the administrator."""
    user = db.query(User).get(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    temporary = secrets.token_urlsafe(6)
    user.hashed_password = hash_password(temporary)
    db.commit()
    log_event(
        db,
        "mot_de_passe_reinitialise",
        user=user,
        detail="Mot de passe temporaire remis à l'administrateur",
        station=f"par {current_user.email}",
    )
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
    identifier = user.email
    db.delete(user)
    db.commit()
    log_event(
        db,
        "utilisateur_supprime",
        identifier=identifier,
        detail=f"Supprimé par {current_user.email}",
    )
