"""Debts and receivables: what customers owe, what the shop owes.

A sale settled later opens a receivable by itself; purchases and other
commitments are written down by hand. Settlements are kept one by one, so the
history stays readable and nothing is overwritten.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Customer, Debt, DebtPayment, Supplier, User, utcnow
from ..permissions import require_permission
from ..schemas import (
    DebtAlert,
    DebtCreate,
    DebtOut,
    DebtPaymentCancel,
    DebtPaymentCreate,
    DebtPaymentOut,
    DebtSummary,
    PartyBalance,
    SettlementOut,
)
from ..sequences import next_reference

router = APIRouter(prefix="/api/debts", tags=["debts"])

KINDS = ("creance", "dette")


def _aware(moment: datetime) -> datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _receipt_reference(db: Session) -> str:
    """Payment receipts are numbered RP-YYYY-000001, once and for all."""
    year = utcnow().year
    return next_reference(
        db, DebtPayment.receipt_reference, f"RP-{year}-", 6
    )


def _in_period(moment: datetime, start: str, end: str) -> bool:
    day = _aware(moment).date().isoformat()
    if start and day < start:
        return False
    if end and day > end:
        return False
    return True


def _named(db: Session, payload: DebtCreate) -> str:
    """Name shown in the list, even if the file entry disappears later."""
    if payload.party.strip():
        return payload.party.strip()
    if payload.customer_id:
        customer = db.query(Customer).get(payload.customer_id)
        if customer:
            return customer.name
    if payload.supplier_id:
        supplier = db.query(Supplier).get(payload.supplier_id)
        if supplier:
            return supplier.name
    return ""


def _find(db: Session, debt_id: int) -> Debt:
    debt = db.query(Debt).get(debt_id)
    if debt is None:
        raise HTTPException(status_code=404, detail="Écriture introuvable")
    return debt


@router.get("", response_model=list[DebtOut])
def list_debts(
    kind: str = "",
    status: str = "",
    search: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes")),
):
    query = db.query(Debt)
    if kind in KINDS:
        query = query.filter(Debt.kind == kind)
    term = search.strip()
    if term:
        like = f"%{term}%"
        query = query.filter((Debt.party.ilike(like)) | (Debt.reference.ilike(like)))
    rows = query.order_by(Debt.created_at.desc()).all()
    if status == "ouvertes":
        rows = [row for row in rows if not row.settled]
    elif status == "soldees":
        rows = [row for row in rows if row.settled]
    elif status == "retard":
        rows = [row for row in rows if row.overdue]
    return rows


@router.get("/resume", response_model=DebtSummary)
def summary(
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes")),
):
    answer = DebtSummary()
    for payment in db.query(DebtPayment).all():
        if payment.cancelled or not _in_period(payment.date, start, end):
            continue
        if payment.debt is not None and payment.debt.kind == "dette":
            answer.disbursed += payment.amount
        else:
            answer.collected += payment.amount
    for debt in db.query(Debt).all():
        if debt.settled:
            continue
        if debt.kind == "dette":
            answer.payable_total += debt.remaining
            answer.payable_count += 1
            if debt.overdue:
                answer.payable_overdue += debt.remaining
        else:
            answer.receivable_total += debt.remaining
            answer.receivable_count += 1
            if debt.overdue:
                answer.receivable_overdue += debt.remaining
    return answer


@router.post("", response_model=DebtOut, status_code=201)
def create_debt(
    payload: DebtCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dettes_gerer")),
):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    kind = payload.kind if payload.kind in KINDS else "creance"
    debt = Debt(
        kind=kind,
        party=_named(db, payload),
        customer_id=payload.customer_id,
        supplier_id=payload.supplier_id,
        reference=payload.reference,
        amount=payload.amount,
        due_date=payload.due_date,
        note=payload.note,
        created_by_id=current_user.id,
    )
    db.add(debt)
    db.commit()
    db.refresh(debt)
    return debt


@router.put("/{debt_id}", response_model=DebtOut)
def update_debt(
    debt_id: int,
    payload: DebtCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes_gerer")),
):
    debt = _find(db, debt_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    debt.kind = payload.kind if payload.kind in KINDS else debt.kind
    debt.party = _named(db, payload)
    debt.customer_id = payload.customer_id
    debt.supplier_id = payload.supplier_id
    debt.reference = payload.reference
    debt.amount = payload.amount
    debt.due_date = payload.due_date
    debt.note = payload.note
    db.commit()
    db.refresh(debt)
    return debt


@router.post("/{debt_id}/paiements", response_model=DebtOut, status_code=201)
def add_payment(
    debt_id: int,
    payload: DebtPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dettes_regler")),
):
    debt = _find(db, debt_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    if payload.amount - debt.remaining > 0.009:
        raise HTTPException(
            status_code=400,
            detail=f"Il ne reste que {debt.remaining:.0f} à régler",
        )
    payment = DebtPayment(
        amount=payload.amount,
        method=payload.method,
        note=payload.note,
        reference=payload.reference,
        receipt_reference=_receipt_reference(db),
        created_by_id=current_user.id,
    )
    if payload.date is not None:
        payment.date = payload.date
    debt.payments.append(payment)
    db.commit()
    db.refresh(debt)
    return debt


@router.post(
    "/{debt_id}/paiements/{payment_id}/annuler", response_model=DebtOut
)
def cancel_payment(
    debt_id: int,
    payment_id: int,
    payload: DebtPaymentCancel,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dettes_annuler")),
):
    """A settlement is never erased: it is cancelled, with its reason."""
    debt = _find(db, debt_id)
    payment = next((p for p in debt.payments if p.id == payment_id), None)
    if payment is None:
        raise HTTPException(status_code=404, detail="Règlement introuvable")
    if payment.cancelled:
        raise HTTPException(status_code=400, detail="Règlement déjà annulé")
    if not payload.reason.strip():
        raise HTTPException(
            status_code=400, detail="Indiquez le motif de l'annulation"
        )
    payment.cancelled = True
    payment.cancel_reason = payload.reason.strip()
    payment.cancelled_at = utcnow()
    payment.cancelled_by_id = current_user.id
    db.commit()
    db.refresh(debt)
    return debt


@router.get("/reglements", response_model=list[SettlementOut])
def settlements(
    kind: str = "",
    method: str = "",
    party: str = "",
    user_id: int = 0,
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes")),
):
    """Every settlement, cash in and cash out, newest first."""
    rows: list[SettlementOut] = []
    needle = party.strip().lower()
    for payment in db.query(DebtPayment).order_by(DebtPayment.date.desc()):
        debt = payment.debt
        if debt is None:
            continue
        if kind in KINDS and debt.kind != kind:
            continue
        if method and payment.method != method:
            continue
        if user_id and payment.created_by_id != user_id:
            continue
        if needle and needle not in debt.party.lower():
            continue
        if not _in_period(payment.date, start, end):
            continue
        row = SettlementOut.model_validate(payment)
        row.kind = debt.kind
        row.party = debt.party
        row.document = debt.reference
        rows.append(row)
    return rows


@router.get("/soldes", response_model=list[PartyBalance])
def balances(
    kind: str = "creance",
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes")),
):
    """Customers with a balance, or suppliers left to pay."""
    wanted = kind if kind in KINDS else "creance"
    grouped: dict[str, PartyBalance] = {}
    for debt in db.query(Debt).filter(Debt.kind == wanted):
        key = debt.party or "—"
        row = grouped.setdefault(key, PartyBalance(party=key))
        row.customer_id = row.customer_id or debt.customer_id
        row.supplier_id = row.supplier_id or debt.supplier_id
        if not row.phone:
            if debt.customer is not None:
                row.phone = debt.customer.phone or ""
            elif debt.supplier is not None:
                row.phone = debt.supplier.phone or ""
        row.total += debt.amount
        row.paid += debt.paid
        row.remaining += debt.remaining
        if debt.overdue:
            row.overdue += debt.remaining
            row.days_late = max(row.days_late, debt.days_late)
        if not debt.settled and debt.due_date is not None:
            due = _aware(debt.due_date)
            if row.next_due is None or due < _aware(row.next_due):
                row.next_due = debt.due_date
    return [row for row in grouped.values() if row.remaining > 0.009]


@router.get("/alertes", response_model=list[DebtAlert])
def alerts(
    days: int = 7,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes")),
):
    """Short sentences about the terms that are near or already missed."""
    horizon = utcnow() + timedelta(days=max(days, 0))
    soon_receivable = 0
    late_receivable = 0.0
    late_payable = 0.0
    late_parties: set[str] = set()
    for debt in db.query(Debt).all():
        if debt.settled:
            continue
        if debt.overdue:
            if debt.kind == "dette":
                late_payable += debt.remaining
            else:
                late_receivable += debt.remaining
                late_parties.add(debt.party)
            continue
        if debt.due_date is not None and _aware(debt.due_date) <= horizon:
            if debt.kind == "creance":
                soon_receivable += 1
    found: list[DebtAlert] = []
    if soon_receivable:
        found.append(
            DebtAlert(
                level="info",
                message=(
                    f"{soon_receivable} créance(s) arrivent à échéance dans "
                    f"les {days} prochains jours."
                ),
            )
        )
    if late_parties:
        found.append(
            DebtAlert(
                level="warning",
                message=(
                    f"{len(late_parties)} client(s) ont des paiements en "
                    f"retard, soit {late_receivable:.0f} FCFA."
                ),
            )
        )
    if late_payable > 0.009:
        found.append(
            DebtAlert(
                level="warning",
                message=(
                    f"Dettes fournisseurs en retard : "
                    f"{late_payable:.0f} FCFA."
                ),
            )
        )
    return found


@router.get("/{debt_id}/paiements", response_model=list[DebtPaymentOut])
def list_payments(
    debt_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes")),
):
    return sorted(_find(db, debt_id).payments, key=lambda row: row.date)


@router.delete("/{debt_id}", status_code=204)
def delete_debt(
    debt_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes_gerer")),
):
    debt = _find(db, debt_id)
    if debt.payments:
        raise HTTPException(
            status_code=400,
            detail="Des règlements sont enregistrés : cette écriture se conserve",
        )
    db.delete(debt)
    db.commit()
