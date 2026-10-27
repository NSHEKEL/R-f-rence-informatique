"""« Assistance et support » : contact points plus the internal request form.

The form writes locally first — the user only sees the confirmation after a
real insert — then the request is mirrored to the owner's console through the
same push the sales use, so it shows up under « Suggestions et critiques ».
"""

import html
import threading
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import remote_sales
from ..auth import get_current_user
from ..database import get_db
from ..models import (
    SUPPORT_CATEGORIES,
    CompanySettings,
    SupportRequest,
    User,
)
from ..schemas import SupportContactOut, SupportRequestIn, SupportRequestOut

router = APIRouter(prefix="/api/support", tags=["support"])

# One sender can only open a few requests per hour: enough for real questions,
# too tight to flood the owner's console.
_MAX_PER_HOUR = 5
_window_seconds = 3600
_recent: dict[int, list[float]] = {}
_recent_lock = threading.Lock()


def _settings(db: Session) -> CompanySettings | None:
    return db.query(CompanySettings).first()


def _clean(value: str, limit: int) -> str:
    """Trim, bound and escape a free-text field (defence in depth: React
    already escapes on render, the console may not)."""
    return html.escape(value.strip(), quote=False)[:limit]


@router.get("/contact", response_model=SupportContactOut)
def contact(
    db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    """Every logged-in user may read the support contact points."""
    settings = _settings(db)
    return SupportContactOut(
        whatsapp=(settings.support_whatsapp if settings else "") or "",
        email=(settings.support_email if settings else "") or "",
    )


@router.post("/requests", response_model=SupportRequestOut, status_code=201)
def create_request(
    payload: SupportRequestIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = time.time()
    with _recent_lock:
        stamps = [t for t in _recent.get(user.id, []) if now - t < _window_seconds]
        if len(stamps) >= _MAX_PER_HOUR:
            raise HTTPException(
                status_code=429,
                detail="Trop de demandes envoyées, réessayez plus tard.",
            )
        stamps.append(now)
        _recent[user.id] = stamps

    if not payload.name.strip() or not payload.subject.strip() or not payload.message.strip():
        raise HTTPException(status_code=400, detail="Nom, sujet et message requis.")
    category = payload.category.strip().lower()
    if category not in SUPPORT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Catégorie inconnue.")

    row = SupportRequest(
        name=_clean(payload.name, 120),
        email=_clean(payload.email, 200),
        subject=_clean(payload.subject, 200),
        category=category,
        message=_clean(payload.message, 5000),
        created_by_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Mirror it to the console a few seconds later, like the sales.
    remote_sales.schedule()
    return row


@router.get("/requests/mine", response_model=list[SupportRequestOut])
def my_requests(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """Own sent requests, most recent first (history of what was sent)."""
    return (
        db.query(SupportRequest)
        .filter(SupportRequest.created_by_id == user.id)
        .order_by(SupportRequest.created_at.desc())
        .limit(50)
        .all()
    )
