from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import (
    BankAccount,
    BankDeposit,
    CashSession,
    Notification,
    User,
)
from ..permissions import has_permission, require_permission
from ..schemas import (
    BankAccountIn,
    BankAccountOut,
    BankDepositDecision,
    BankDepositIn,
    BankDepositOut,
    BankDepositReconcile,
)
from .cash import current_session

router = APIRouter(prefix="/api/bank", tags=["bank"])


def require_versements_reader(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    """Treasury screens are for the roles explicitly allowed to read them:
    a plain `get_current_user` would let any seller list the accounts."""
    if not (
        has_permission(db, current_user, "versements_gerer")
        or has_permission(db, current_user, "versements_valider")
    ):
        raise HTTPException(
            status_code=403, detail="Accès refusé : trésorerie"
        )
    return current_user

FINAL_STATUSES = {"rejeté", "annulé"}


def _account_balance(db: Session, account_id: int) -> float:
    """Bank balance = validated deposits not cancelled afterwards."""
    rows = (
        db.query(BankDeposit)
        .filter(
            BankDeposit.account_id == account_id,
            BankDeposit.status == "validé",
        )
        .all()
    )
    return sum(row.amount or 0 for row in rows)


def _account_out(db: Session, account: BankAccount) -> BankAccountOut:
    out = BankAccountOut.model_validate(account)
    out.balance = _account_balance(db, account.id)
    return out


def _deposit_out(row: BankDeposit) -> BankDepositOut:
    out = BankDepositOut.model_validate(row)
    out.bank_name = row.account.bank_name if row.account else ""
    out.account_label = (
        row.account.label or row.account.account_number
        if row.account
        else ""
    )
    out.created_by_name = row.created_by.name if row.created_by else ""
    out.decided_by_name = row.decided_by.name if row.decided_by else ""
    return out


# ------------------------------------------------------------- accounts


@router.get("/accounts", response_model=list[BankAccountOut])
def list_accounts(
    db: Session = Depends(get_db),
    _: User = Depends(require_versements_reader),
):
    accounts = (
        db.query(BankAccount).order_by(BankAccount.bank_name).all()
    )
    return [_account_out(db, account) for account in accounts]


@router.post("/accounts", response_model=BankAccountOut, status_code=201)
def create_account(
    payload: BankAccountIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not payload.bank_name.strip():
        raise HTTPException(status_code=400, detail="Nom de la banque obligatoire")
    account = BankAccount(**payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return _account_out(db, account)


@router.put("/accounts/{account_id}", response_model=BankAccountOut)
def update_account(
    account_id: int,
    payload: BankAccountIn,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    account = (
        db.query(BankAccount).filter(BankAccount.id == account_id).first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte bancaire introuvable")
    for field, value in payload.model_dump().items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return _account_out(db, account)


# ------------------------------------------------------------- deposits


@router.get("/deposits", response_model=list[BankDepositOut])
def list_deposits(
    account_id: int = 0,
    status: str = "",
    reconciled: str = "",
    limit: int = 200,
    db: Session = Depends(get_db),
    _: User = Depends(require_versements_reader),
):
    query = db.query(BankDeposit)
    if account_id:
        query = query.filter(BankDeposit.account_id == account_id)
    if status:
        query = query.filter(BankDeposit.status == status)
    if reconciled in ("oui", "non"):
        query = query.filter(BankDeposit.reconciled.is_(reconciled == "oui"))
    rows = query.order_by(BankDeposit.deposit_date.desc()).limit(limit).all()
    return [_deposit_out(row) for row in rows]


@router.post("/deposits", response_model=BankDepositOut, status_code=201)
def create_deposit(
    payload: BankDepositIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("versements_gerer")),
):
    """Record a cash deposit from a till to a bank account.

    It is an internal treasury transfer — never a sale, never revenue.
    """
    account = (
        db.query(BankAccount)
        .filter(BankAccount.id == payload.account_id, BankAccount.is_active)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte bancaire introuvable")
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    if payload.slip_number:
        duplicate = (
            db.query(BankDeposit)
            .filter(
                BankDeposit.account_id == payload.account_id,
                BankDeposit.slip_number == payload.slip_number,
                BankDeposit.status != "annulé",
            )
            .first()
        )
        if duplicate:
            raise HTTPException(
                status_code=400,
                detail=f"Ce bordereau est déjà enregistré (versement #{duplicate.id})",
            )
    session_id = payload.cash_session_id
    if session_id is None:
        session = current_session(db, current_user)
        session_id = session.id if session else None
    elif db.query(CashSession).filter(CashSession.id == session_id).first() is None:
        raise HTTPException(status_code=404, detail="Session de caisse introuvable")
    deposit = BankDeposit(
        account_id=account.id,
        cash_session_id=session_id,
        amount=payload.amount,
        deposit_date=payload.deposit_date or datetime.now(timezone.utc),
        method=payload.method or "Espèces",
        reference=payload.reference,
        slip_number=payload.slip_number,
        note=payload.note,
        attachment=payload.attachment,
        status="en attente",
        created_by_id=current_user.id,
    )
    db.add(deposit)
    db.commit()
    db.refresh(deposit)
    return _deposit_out(deposit)


def _deposit_or_404(db: Session, deposit_id: int) -> BankDeposit:
    row = db.query(BankDeposit).filter(BankDeposit.id == deposit_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Versement introuvable")
    return row


@router.post("/deposits/{deposit_id}/decision", response_model=BankDepositOut)
def decide_deposit(
    deposit_id: int,
    payload: BankDepositDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("versements_valider")),
):
    """Validation par un responsable: en attente -> validé / rejeté ; un
    versement validé ne peut plus qu'être annulé (tracé)."""
    deposit = _deposit_or_404(db, deposit_id)
    targets = {"valider": "validé", "rejeter": "rejeté", "annuler": "annulé"}
    target = targets.get(payload.action)
    if target is None:
        raise HTTPException(status_code=400, detail="Action inconnue")
    if deposit.status == target:
        raise HTTPException(status_code=400, detail="Déjà fait — pas de double validation")
    if deposit.status in FINAL_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Ce versement est déjà {deposit.status} et ne peut plus changer",
        )
    if deposit.status == "validé" and target != "annulé":
        raise HTTPException(
            status_code=400,
            detail="Un versement validé ne peut être qu'annulé",
        )
    deposit.status = target
    deposit.decided_by_id = current_user.id
    deposit.decided_at = datetime.now(timezone.utc)
    if payload.note:
        deposit.note = (deposit.note + "\n" if deposit.note else "") + (
            f"{target} par {current_user.name}: {payload.note}"
        )
    db.add(
        Notification(
            kind="banque",
            title=f"Versement {target}",
            message=(
                f"{current_user.name} a {target} le versement "
                f"#{deposit.id} de {deposit.amount:,.0f} FCFA".replace(",", " ")
            ),
            link="/banque",
        )
    )
    db.commit()
    db.refresh(deposit)
    return _deposit_out(deposit)


@router.post("/deposits/{deposit_id}/reconcile", response_model=BankDepositOut)
def reconcile_deposit(
    deposit_id: int,
    payload: BankDepositReconcile,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("versements_valider")),
):
    """Manual reconciliation against the bank statement."""
    deposit = _deposit_or_404(db, deposit_id)
    if deposit.status != "validé":
        raise HTTPException(
            status_code=400,
            detail="Seul un versement validé peut être rapproché",
        )
    deposit.reconciled = payload.reconciled
    if payload.statement_ref:
        deposit.statement_ref = payload.statement_ref
    db.commit()
    db.refresh(deposit)
    return _deposit_out(deposit)
