"""Account identifiers, password rules and the security journal.

EasyGest signs in with a free-form identifier: ``admin`` and
``admin@boutique.ci`` are both valid, the "@" is never required. The
identifier only names the account; it has no link with the server address,
the API URL or the database settings, so renaming a user can never stop a
workstation from reaching its shop.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import SecurityLog, User

MIN_PASSWORD_LENGTH = 6
MIN_IDENTIFIER_LENGTH = 3


def normalize_identifier(raw: str) -> str:
    """Trim and lowercase, so ``Admin`` and ``admin`` are the same account."""
    return (raw or "").strip().lower()


def identifier_error(identifier: str) -> str:
    """Empty string when the identifier is acceptable, else the reason."""
    if len(identifier) < MIN_IDENTIFIER_LENGTH:
        return (
            "L'identifiant doit contenir au moins "
            f"{MIN_IDENTIFIER_LENGTH} caractères"
        )
    if any(char.isspace() for char in identifier):
        return "L'identifiant ne doit pas contenir d'espace"
    return ""


def password_error(password: str) -> str:
    """Empty string when the password is acceptable, else the reason."""
    if len(password or "") < MIN_PASSWORD_LENGTH:
        return (
            "Le mot de passe doit contenir au moins "
            f"{MIN_PASSWORD_LENGTH} caractères"
        )
    return ""


def find_user(db: Session, identifier: str) -> User | None:
    """Look up an account whatever the case used when typing it."""
    wanted = normalize_identifier(identifier)
    if not wanted:
        return None
    return db.query(User).filter(func.lower(User.email) == wanted).first()


def identifier_taken(db: Session, identifier: str, keep_id: int = 0) -> bool:
    other = find_user(db, identifier)
    return other is not None and other.id != keep_id


def log_event(
    db: Session,
    event: str,
    *,
    identifier: str = "",
    user: User | None = None,
    detail: str = "",
    station: str = "",
    success: bool = True,
) -> None:
    """Append one line to the security journal, never a password."""
    db.add(
        SecurityLog(
            event=event,
            identifier=normalize_identifier(identifier)
            or (user.email if user else ""),
            detail=detail,
            station=station[:120],
            success=success,
            user_id=user.id if user else None,
        )
    )
    db.commit()
