import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from ..database import get_db
from ..mailer import is_configured, send_mail
from ..models import CompanySettings, PasswordResetToken, User
from ..schemas import (
    ForgotPasswordRequest,
    ForgotPasswordResult,
    LoginRequest,
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
    key = f"{request.client.host if request.client else '?'}|{payload.email}"
    if _too_many_attempts(key):
        raise HTTPException(
            status_code=429,
            detail="Trop de tentatives, réessayez dans quelques minutes",
        )
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        _record_attempt(key)
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Compte désactivé")
    _attempts.pop(key, None)
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

    user = (
        db.query(User)
        .filter(User.email == payload.email.strip(), User.is_active.is_(True))
        .first()
    )
    if not user:
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
    if len(payload.password) < 6:
        raise HTTPException(
            status_code=400,
            detail="Le mot de passe doit contenir au moins 6 caractères",
        )
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
    return ForgotPasswordResult(sent=True, message="Mot de passe mis à jour.")


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
