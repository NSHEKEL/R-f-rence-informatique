from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import CashSession, Notification, Sale, User
from ..schemas import (
    CashSessionClose,
    CashSessionDetail,
    CashSessionOpen,
    CashSessionOut,
)

router = APIRouter(prefix="/api/cash-sessions", tags=["cash"])

CASH_PAYMENT = "Espèces"


def business_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def current_session(db: Session, user: User) -> CashSession | None:
    """The till this cashier currently has open (one per cashier)."""
    return (
        db.query(CashSession)
        .filter(
            CashSession.closed_at.is_(None),
            CashSession.opened_by_id == user.id,
        )
        .order_by(CashSession.opened_at.desc())
        .first()
    )


def day_session(db: Session, user: User) -> CashSession | None:
    """This cashier's session for today, open or already closed."""
    return (
        db.query(CashSession)
        .filter(
            CashSession.opened_by_id == user.id,
            CashSession.business_day == business_day(),
        )
        .order_by(CashSession.opened_at.desc())
        .first()
    )


def _totals(db: Session, session: CashSession) -> dict:
    sales = (
        db.query(Sale)
        .filter(Sale.cash_session_id == session.id, Sale.status != "Annulée")
        .all()
    )
    cash = sum(s.total for s in sales if s.payment_method == CASH_PAYMENT)
    other = sum(s.total for s in sales if s.payment_method != CASH_PAYMENT)
    return {
        "cash_sales": cash,
        "other_sales": other,
        "sales_count": len(sales),
        "expected_cash": session.opening_balance + cash,
    }


def _detail(db: Session, session: CashSession) -> CashSessionDetail:
    return CashSessionDetail(
        **CashSessionOut.model_validate(session).model_dump(),
        **_totals(db, session),
    )


@router.get("/current", response_model=CashSessionDetail | None)
def get_current(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = current_session(db, current_user)
    return _detail(db, session) if session else None


@router.get("/today", response_model=CashSessionDetail | None)
def get_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Today's session for this cashier, so the UI knows it is already done."""
    session = day_session(db, current_user)
    return _detail(db, session) if session else None


@router.get("", response_model=list[CashSessionOut])
def list_sessions(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(CashSession)
    if current_user.role != "admin":
        query = query.filter(CashSession.opened_by_id == current_user.id)
    return query.order_by(CashSession.opened_at.desc()).limit(limit).all()


@router.post("/open", response_model=CashSessionDetail, status_code=201)
def open_session(
    payload: CashSessionOpen,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = day_session(db, current_user)
    if existing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Votre caisse a déjà été ouverte aujourd'hui"
                if existing.closed_at
                else "Votre caisse est déjà ouverte"
            ),
        )
    session = CashSession(
        opening_balance=payload.opening_balance,
        note=payload.note,
        opened_by_id=current_user.id,
        business_day=business_day(),
    )
    db.add(session)
    db.add(
        Notification(
            kind="caisse",
            title="Ouverture de caisse",
            message=(
                f"{current_user.name} a ouvert sa caisse avec un fonds de "
                f"{payload.opening_balance:,.0f} FCFA".replace(",", " ")
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    return _detail(db, session)


@router.post("/close", response_model=CashSessionDetail)
def close_session(
    payload: CashSessionClose,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = current_session(db, current_user)
    if not session:
        raise HTTPException(
            status_code=400, detail="Aucune caisse ouverte à votre nom"
        )
    totals = _totals(db, session)
    session.closed_at = datetime.now(timezone.utc)
    session.closed_by_id = current_user.id
    session.closing_balance = payload.closing_balance
    session.expected_balance = totals["expected_cash"]
    session.difference = payload.closing_balance - totals["expected_cash"]
    if payload.note:
        session.note = payload.note
    gap = session.difference
    state = "conforme" if abs(gap) < 1 else f"écart de {gap:,.0f} FCFA"
    db.add(
        Notification(
            kind="caisse",
            title="Fermeture de caisse",
            message=(
                f"{current_user.name} a fermé sa caisse : {state}".replace(
                    ",", " "
                )
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    return _detail(db, session)
