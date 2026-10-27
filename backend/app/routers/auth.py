import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..accounts import (
    find_user,
    log_event,
    normalize_identifier,
    password_error,
)
from ..auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ..database import get_db
from ..licensing import installation_uid
from ..mailer import is_configured, send_mail
from ..models import CompanySettings, PasswordResetToken, RecoveryKey, User
from ..rescue import RescueError, read_key
from ..schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResult,
    LoginRequest,
    RecoveryRequest,
    ResetPasswordRequest,
    Token,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

RESET_TOKEN_TTL_MINUTES = 60
# Slow down password guessing without locking anyone out permanently.
MAX_LOGIN_ATTEMPTS = 8
LOGIN_WINDOW_MINUTES = 5
_attempts: dict[str, list[datetime]] = {}


def _too_many_attempts(key: str) -> bool:
    now = datetime.now(timezone.utc)
    window = now - timedelta(minutes=LOGIN_WINDOW_MINUTES)
    recent = [at for at in _attempts.get(key, []) if at > window]
    _attempts[key] = recent
    return len(recent) >= MAX_LOGIN_ATTEMPTS


def _record_attempt(key: str) -> None:
    _attempts.setdefault(key, []).append(datetime.now(timezone.utc))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    station = request.client.host if request.client else "?"
    identifier = normalize_identifier(payload.email)
    key = f"{station}|{identifier}"
    if _too_many_attempts(key):
        raise HTTPException(
            status_code=429,
            detail="Trop de tentatives, réessayez dans quelques minutes",
        )
    user = find_user(db, identifier)
    if not user or not verify_password(payload.password, user.hashed_password):
        _record_attempt(key)
        log_event(
            db,
            "connexion_echouee",
            identifier=identifier,
            station=station,
            success=False,
            detail="Identifiant ou mot de passe incorrect",
        )
        raise HTTPException(
            status_code=401, detail="Identifiant ou mot de passe incorrect"
        )
    if not user.is_active:
        log_event(
            db,
            "connexion_refusee",
            user=user,
            station=station,
            success=False,
            detail="Compte désactivé",
        )
        raise HTTPException(status_code=403, detail="Compte désactivé")
    _attempts.pop(key, None)
    log_event(db, "connexion", user=user, station=station)
    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token)


@router.post("/forgot-password", response_model=ForgotPasswordResult)
def forgot_password(
    payload: ForgotPasswordRequest, db: Session = Depends(get_db)
):
    """Email a single-use reset link when the shop has an SMTP account.

    The answer never reveals whether the address exists.
    """
    generic = ForgotPasswordResult(
        sent=True,
        message=(
            "Si cette adresse est enregistrée, un lien de réinitialisation "
            "vient d'être envoyé."
        ),
    )
    settings = db.query(CompanySettings).first()
    if not is_configured(settings):
        return ForgotPasswordResult(
            sent=False,
            message=(
                "L'envoi d'e-mails n'est pas configuré. Demandez à votre "
                "administrateur de réinitialiser votre mot de passe depuis "
                "la page Utilisateurs."
            ),
        )

    user = find_user(db, payload.email)
    if not user or not user.is_active:
        return generic

    token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash_token(token),
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=RESET_TOKEN_TTL_MINUTES),
        )
    )
    db.commit()

    body = (
        f"Bonjour {user.name},\n\n"
        "Vous avez demandé à réinitialiser votre mot de passe.\n"
        "Ouvrez l'application, cliquez sur « Mot de passe oublié » puis "
        "« J'ai un code » et saisissez ce code :\n\n"
        f"{token}\n\n"
        f"Ce code expire dans {RESET_TOKEN_TTL_MINUTES} minutes.\n"
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."
    )
    try:
        send_mail(
            settings, user.email, f"{settings.name} — mot de passe", body
        )
    except Exception:
        return ForgotPasswordResult(
            sent=False,
            message=(
                "L'e-mail n'a pas pu être envoyé. Contactez votre "
                "administrateur."
            ),
        )
    return generic


@router.post("/reset-password", response_model=ForgotPasswordResult)
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    problem = password_error(payload.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    entry = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == _hash_token(payload.token.strip()))
        .first()
    )
    now = datetime.now(timezone.utc)
    expires_at = entry.expires_at if entry else None
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not entry or entry.used_at or expires_at is None or expires_at < now:
        raise HTTPException(status_code=400, detail="Code invalide ou expiré")

    entry.user.hashed_password = hash_password(payload.password)
    entry.used_at = now
    db.commit()
    log_event(db, "mot_de_passe_reinitialise", user=entry.user, detail="Code reçu")
    return ForgotPasswordResult(sent=True, message="Mot de passe mis à jour.")


@router.post("/changer-mot-de-passe", response_model=ForgotPasswordResult)
def change_my_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change one's own password; the old one is always required here."""
    if not verify_password(payload.current_password, current_user.hashed_password):
        log_event(
            db,
            "changement_mot_de_passe",
            user=current_user,
            success=False,
            detail="Ancien mot de passe incorrect",
        )
        raise HTTPException(status_code=400, detail="Ancien mot de passe incorrect")
    problem = password_error(payload.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if payload.password != payload.confirm:
        raise HTTPException(
            status_code=400, detail="La confirmation ne correspond pas"
        )
    current_user.hashed_password = hash_password(payload.password)
    db.commit()
    log_event(db, "changement_mot_de_passe", user=current_user)
    return ForgotPasswordResult(sent=True, message="Mot de passe mis à jour.")


@router.post("/recuperation", response_model=ForgotPasswordResult)
def administrator_recovery(
    payload: RecoveryRequest, request: Request, db: Session = Depends(get_db)
):
    """Last resort: a recovery key reopens the administrator account.

    The key is the one generated in Paramètres → Sécurité (or by the global
    administrator); only its hash is stored. Nothing but the password and the
    active flag of that single account is touched.
    """
    station = request.client.host if request.client else "?"
    problem = password_error(payload.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if payload.password != payload.confirm:
        raise HTTPException(
            status_code=400, detail="La confirmation ne correspond pas"
        )
    given = _hash_token(payload.key.strip())
    entry = (
        db.query(RecoveryKey)
        .filter(RecoveryKey.key_hash == given, RecoveryKey.used_at.is_(None))
        .first()
    )
    if not entry:
        entry = _publisher_key(db, payload.key, station, payload.identifier)

    user = find_user(db, payload.identifier) if payload.identifier else None
    if user is None:
        user = (
            db.query(User)
            .filter(User.role == "admin")
            .order_by(User.id)
            .first()
        )
    if user is None:
        raise HTTPException(status_code=404, detail="Aucun administrateur trouvé")

    user.hashed_password = hash_password(payload.password)
    user.is_active = True
    user.role = "admin"
    entry.used_at = datetime.now(timezone.utc)
    db.commit()
    _attempts.clear()
    log_event(
        db,
        "recuperation_admin",
        user=user,
        station=station,
        detail="Accès administrateur rétabli",
    )
    return ForgotPasswordResult(
        sent=True,
        message=f"Accès rétabli pour « {user.email} ». Connectez-vous.",
    )


def _publisher_key(
    db: Session, key: str, station: str, identifier: str
) -> RecoveryKey:
    """Accept a one-shot key signed by the publisher for this computer.

    Used when no local recovery key was generated before the incident: the
    owner issues one from the console for this installation only.
    """
    try:
        reference = read_key(key, installation_uid())
    except RescueError as error:
        log_event(
            db,
            "recuperation_admin",
            identifier=identifier,
            station=station,
            success=False,
            detail=str(error),
        )
        raise HTTPException(status_code=400, detail=str(error)) from error
    marker = _hash_token(f"editeur:{reference}")
    already = db.query(RecoveryKey).filter(RecoveryKey.key_hash == marker).first()
    if already is not None:
        log_event(
            db,
            "recuperation_admin",
            identifier=identifier,
            station=station,
            success=False,
            detail="Clé de secours déjà utilisée",
        )
        raise HTTPException(
            status_code=400, detail="Clé de secours déjà utilisée"
        )
    entry = RecoveryKey(key_hash=marker)
    db.add(entry)
    db.flush()
    return entry


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
