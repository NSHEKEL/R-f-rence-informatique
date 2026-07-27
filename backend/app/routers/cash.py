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


def current_session(db: Session) -> CashSession | None:
    return (
        db.query(CashSession)
        .filter(CashSession.closed_at.is_(None))
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


@router.get("/current", response_model=CashSessionDetail | None)
def get_current(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    session = current_session(db)
    if not session:
        return None
    return CashSessionDetail(
        **CashSessionOut.model_validate(session).model_dump(),
        **_totals(db, session),
    )


@router.get("", response_model=list[CashSessionOut])
def list_sessions(
    limit: int = 50,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return (
        db.query(CashSession)
        .order_by(CashSession.opened_at.desc())
        .limit(limit)
        .all()
    )


@router.post("/open", response_model=CashSessionOut, status_code=201)
def open_session(
    payload: CashSessionOpen,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_session(db):
        raise HTTPException(
            status_code=400, detail="Une caisse est déjà ouverte"
        )
    session = CashSession(
        opening_balance=payload.opening_balance,
        note=payload.note,
        opened_by_id=current_user.id,
    )
    db.add(session)
    db.add(
        Notification(
            kind="caisse",
            title="Ouverture de caisse",
            message=(
                f"{current_user.name} a ouvert la caisse avec un fonds de "
                f"{payload.opening_balance:,.0f} FCFA".replace(",", " ")
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    return session


@router.post("/close", response_model=CashSessionOut)
def close_session(
    payload: CashSessionClose,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = current_session(db)
    if not session:
        raise HTTPException(status_code=400, detail="Aucune caisse ouverte")
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
                f"{current_user.name} a fermé la caisse : {state}".replace(
                    ",", " "
                )
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    return session
