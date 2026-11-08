import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import (
    BankDeposit,
    CashSession,
    CompanySettings,
    DebtPayment,
    Expense,
    Notification,
    Order,
    Sale,
    SaleReturn,
    User,
)
from ..permissions import has_permission, require_permission
from ..schemas import (
    CashSessionClose,
    CashSessionDetail,
    CashSessionOpen,
    CashSessionOut,
    CashSessionZ,
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


def require_open_till(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """A seller sells nothing — and sees no article — with a closed till.

    The rule is enforced here and not only in the pages: a direct call to the
    API would otherwise still hand over the catalogue. The administrator and
    the stock manager keep their screens, the counter is not their job.
    """
    if current_user.role != "vendeur" or current_session(db, current_user):
        return current_user
    raise HTTPException(
        status_code=403,
        detail="Ouvrez votre caisse pour accéder aux articles et aux ventes",
    )


def _totals(db: Session, session: CashSession) -> dict:
    sales = (
        db.query(Sale)
        .filter(
            Sale.cash_session_id == session.id,
            Sale.status != "Annulée",
            Sale.is_gift.is_(False),
        )
        .all()
    )
    cash = 0.0
    other = 0.0
    for s in sales:
        if s.payments:
            # Mixed tender: each leg counts toward its own method.
            for leg in s.payments:
                if leg.method == CASH_PAYMENT:
                    cash += leg.amount
                else:
                    other += leg.amount
        elif s.payment_method == CASH_PAYMENT:
            cash += s.total
        else:
            other += s.total
    deposits = (
        db.query(BankDeposit)
        .filter(
            BankDeposit.cash_session_id == session.id,
            BankDeposit.status == "validé",
        )
        .all()
    )
    deposited = sum(d.amount or 0 for d in deposits)
    return {
        "cash_sales": cash,
        "other_sales": other,
        "sales_count": len(sales),
        "deposits_total": deposited,
        # A validated bank deposit is a cash outflow of the till: the
        # theoretical cash left no longer includes it.
        "expected_cash": session.opening_balance + cash - deposited,
        "sales": [
            {
                "id": s.id,
                "reference": s.reference,
                "total": s.total or 0,
                "paid_amount": s.paid_amount or 0,
                "payment_method": s.payment_method or "",
                "status": s.status or "",
                "date": s.date,
            }
            for s in sorted(sales, key=lambda s: s.date or datetime.min, reverse=True)
        ],
    }


def _detail(db: Session, session: CashSession, user: User) -> CashSessionDetail:
    can_closure = has_permission(db, user, "clotures_consulter") or has_permission(db, user, "caisse_z")
    if not has_permission(db, user, "soldes_consulter") or (session.closed_at is not None and not can_closure):
        out = CashSessionDetail(**CashSessionOut.model_validate(session).model_dump())
        for field in ("opening_balance", "closing_balance", "expected_balance", "difference"):
            setattr(out, field, None)
        return out
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
    return _detail(db, session, current_user) if session else None


@router.get("/today", response_model=CashSessionDetail | None)
def get_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Today's session for this cashier, so the UI knows it is already done."""
    session = day_session(db, current_user)
    return _detail(db, session, current_user) if session else None


@router.get("", response_model=list[CashSessionOut])
def list_sessions(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("clotures_consulter")),
):
    query = db.query(CashSession)
    return [CashSessionOut(**_detail(db, session, current_user).model_dump())
            for session in query.order_by(CashSession.opened_at.desc()).limit(limit).all()]


@router.post("/open", response_model=CashSessionDetail, status_code=201)
def open_session(
    payload: CashSessionOpen,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("caisse")),
):
    existing = current_session(db, current_user)
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Votre caisse est déjà ouverte",
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
                f"{current_user.name} a ouvert sa caisse"
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    return _detail(db, session, current_user)


@router.post("/close", response_model=CashSessionDetail)
def close_session(
    payload: CashSessionClose,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("caisse_fermer")),
):
    session = current_session(db, current_user)
    if not session:
        raise HTTPException(
            status_code=400, detail="Aucune caisse ouverte à votre nom"
        )
    totals = _totals(db, session)
    if not has_permission(db, current_user, "soldes_consulter") and not payload.note.strip():
        raise HTTPException(status_code=400, detail="Une note est obligatoire pour clôturer sans accès aux soldes")
    gap = payload.closing_balance - totals["expected_cash"]
    if abs(gap) >= 1 and not payload.note.strip():
        raise HTTPException(
            status_code=400,
            detail="Un écart de caisse exige une justification (note obligatoire)",
        )
    session.closed_at = datetime.now(timezone.utc)
    session.closed_by_id = current_user.id
    session.closing_balance = payload.closing_balance
    session.expected_balance = totals["expected_cash"]
    session.difference = gap
    if payload.note:
        session.note = payload.note
    # Freeze the Z snapshot at closing: it can never be edited afterwards.
    session.z_report = _z_report(db, session).model_dump_json()
    db.add(
        Notification(
            kind="caisse",
            title="Fermeture de caisse",
            message=(
                f"{current_user.name} a fermé sa caisse"
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    return _detail(db, session, current_user)


def _session_or_404(db: Session, session_id: int) -> CashSession:
    session = db.query(CashSession).filter(CashSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session de caisse introuvable")
    return session


def _z_report(db: Session, session: CashSession) -> CashSessionZ:
    """Build the definitive recap of a till session (État Z)."""
    sales = (
        db.query(Sale).filter(Sale.cash_session_id == session.id).all()
    )
    payments: dict[str, float] = {}
    total_sales = 0.0
    cancelled_total = 0.0
    cancelled_count = 0
    gift_total = 0.0
    sales_count = 0
    for s in sales:
        if s.status == "Annulée":
            cancelled_total += s.total or 0
            cancelled_count += 1
            continue
        if s.is_gift:
            gift_total += s.total or 0
            continue
        sales_count += 1
        total_sales += s.total or 0
        if s.payments:
            for leg in s.payments:
                payments[leg.method] = payments.get(leg.method, 0.0) + (
                    leg.amount or 0
                )
        else:
            method = s.payment_method or CASH_PAYMENT
            payments[method] = payments.get(method, 0.0) + (s.total or 0)

    opened_at = session.opened_at
    closed_at = session.closed_at or datetime.now(timezone.utc)
    expenses = (
        db.query(Expense)
        .filter(
            Expense.date >= opened_at,
            Expense.date <= closed_at,
        )
        .all()
    )
    deposits = (
        db.query(BankDeposit)
        .filter(
            BankDeposit.cash_session_id == session.id,
            BankDeposit.status != "annulé",
        )
        .all()
    )
    validated_deposits = sum(
        d.amount or 0 for d in deposits if d.status == "validé"
    )
    company = db.query(CompanySettings).first()

    # Credit notes (remboursements / retours) issued inside the session window.
    returns = (
        db.query(SaleReturn)
        .filter(
            SaleReturn.date >= opened_at,
            SaleReturn.date <= closed_at,
        )
        .all()
    )
    # Client settlements received during the session: cash legs sit in the
    # drawer, the other methods only show up in the breakdown.
    settlements = (
        db.query(DebtPayment)
        .filter(
            DebtPayment.cancelled.is_(False),
            DebtPayment.date >= opened_at,
            DebtPayment.date <= closed_at,
        )
        .all()
    )
    settlement_payments: dict[str, float] = {}
    cash_settlements = 0.0
    for p in settlements:
        method = p.method or CASH_PAYMENT
        settlement_payments[method] = (
            settlement_payments.get(method, 0.0) + (p.amount or 0)
        )
        if method == CASH_PAYMENT:
            cash_settlements += p.amount or 0
    # Order deposits (acomptes) booked during the session.
    advances = (
        db.query(Order)
        .filter(
            Order.date >= opened_at,
            Order.date <= closed_at,
            Order.deposit > 0,
        )
        .all()
    )

    expected = (
        session.opening_balance
        + payments.get(CASH_PAYMENT, 0.0)
        + cash_settlements
        - validated_deposits
    )
    return CashSessionZ(
        session_id=session.id,
        company=company.name if company else "",
        company_address=company.address if company else "",
        company_phone=(company.phone or company.phone2) if company else "",
        company_logo=company.logo if company else "",
        cashier=session.opened_by.name if session.opened_by else "",
        opened_at=opened_at,
        closed_at=session.closed_at,
        business_day=session.business_day or "",
        opening_balance=session.opening_balance or 0,
        total_sales=total_sales,
        sales_count=sales_count,
        cancelled_total=cancelled_total,
        cancelled_count=cancelled_count,
        gift_total=gift_total,
        payments=payments,
        refunds_total=sum(r.total or 0 for r in returns),
        refunds=[
            {
                "reference": r.reference,
                "sale_reference": r.sale_reference,
                "total": r.total,
            }
            for r in returns
        ],
        advances_total=sum(o.deposit or 0 for o in advances),
        advances=[
            {"reference": o.reference, "customer": o.customer_name, "amount": o.deposit}
            for o in advances
        ],
        settlements_total=sum(p.amount or 0 for p in settlements),
        settlements=settlement_payments,
        expenses_total=sum(e.amount or 0 for e in expenses),
        expenses=[
            {"label": e.label, "category": e.category, "amount": e.amount}
            for e in expenses
        ],
        deposits_total=validated_deposits,
        deposits=[
            {
                "id": d.id,
                "amount": d.amount,
                "bank": d.account.bank_name if d.account else "",
                "reference": d.reference,
                "status": d.status,
            }
            for d in deposits
        ],
        expected_cash=expected,
        counted_cash=session.closing_balance,
        difference=session.difference,
        note=session.note or "",
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/{session_id}/z", response_model=CashSessionZ)
def z_report(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("soldes_consulter")),
):
    """État Z: the definitive recap. Once the session is closed the snapshot
    stored on it is served, so a validated Z can never change."""
    session = _session_or_404(db, session_id)
    can_close_read = has_permission(db, current_user, "clotures_consulter")
    can_own_ticket = session.opened_by_id == current_user.id and has_permission(db, current_user, "caisse_z")
    if not (can_close_read or can_own_ticket):
        raise HTTPException(status_code=403, detail="Accès refusé : clôtures de caisse")
    if session.z_report:
        try:
            return CashSessionZ(**json.loads(session.z_report))
        except (ValueError, TypeError):
            pass
    report = _z_report(db, session)
    if session.closed_at is not None:
        session.z_report = report.model_dump_json()
        db.commit()
    return report


@router.post("/{session_id}/reopen", response_model=CashSessionDetail)
def reopen_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Exceptional re-opening of a closed till — administrator only, traced."""
    session = _session_or_404(db, session_id)
    if session.closed_at is None:
        raise HTTPException(status_code=400, detail="Cette caisse est déjà ouverte")
    if current_session(db, session.opened_by):
        raise HTTPException(
            status_code=400,
            detail="Le caissier a déjà une caisse ouverte",
        )
    stamp = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")
    session.note = (
        (session.note or "")
        + f"\nRéouverture exceptionnelle par {current_user.name} le {stamp}"
    ).strip()
    session.closed_at = None
    session.closed_by_id = None
    session.closing_balance = None
    session.expected_balance = None
    session.difference = None
    session.z_report = ""  # a new Z will be frozen at the next closing
    db.add(
        Notification(
            kind="caisse",
            title="Réouverture de caisse",
            message=(
                f"{current_user.name} a rouvert la session #{session.id} "
                f"de {session.opened_by.name if session.opened_by else '?'}"
            ),
            link="/caisse",
        )
    )
    db.commit()
    db.refresh(session)
    return _detail(db, session, current_user)
