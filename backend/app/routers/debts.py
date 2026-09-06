"""Debts and receivables: what customers owe, what the shop owes.

A sale settled later opens a receivable by itself; purchases and other
commitments are written down by hand. Settlements are kept one by one, so the
history stays readable and nothing is overwritten.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Customer, Debt, DebtPayment, Supplier, User
from ..permissions import require_permission
from ..schemas import (
    DebtCreate,
    DebtOut,
    DebtPaymentCreate,
    DebtPaymentOut,
    DebtSummary,
)

router = APIRouter(prefix="/api/debts", tags=["debts"])

KINDS = ("creance", "dette")


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
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("dettes")),
):
    answer = DebtSummary()
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
    debt.payments.append(
        DebtPayment(
            amount=payload.amount,
            method=payload.method,
            note=payload.note,
            created_by_id=current_user.id,
        )
    )
    db.commit()
    db.refresh(debt)
    return debt


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
