"""Accounting configuration and derived documents, separate from commercial synthesis."""

import json
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..accounting_ledger import DEFAULT_LINKS, configuration, report
from ..auth import get_current_user, require_admin
from ..database import get_db
from ..models import AccountingAccount, AccountingSetting, Debt, Purchase, SecurityLog, User, utcnow
from ..permissions import has_permission, require_permission

router = APIRouter(prefix="/api/accounting/documents", tags=["accounting-documents"])


class AccountInput(BaseModel):
    number: str = Field(pattern=r"^[1-9][0-9]{1,11}$")
    label: str = Field(min_length=1, max_length=200)
    class_number: int = Field(ge=1, le=9)
    type: Literal["bilan", "charge", "produit", "autre"] = "bilan"
    active: bool = True


class MappingInput(BaseModel):
    key: str = Field(min_length=1, max_length=200)
    account: str | None = Field(default=None, pattern=r"^[1-9][0-9]{1,11}$")


class HistoricalInput(BaseModel):
    rate: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    start: date | None = None


class LinkInput(BaseModel):
    purchase_id: int = Field(ge=1)


def audit(db, user, event, detail):
    db.add(SecurityLog(event=event, identifier=user.email, user_id=user.id, detail=f"{user.name} : {detail}"))


def setting(db, user, key, value):
    row = db.get(AccountingSetting, key)
    old = row.value if row else None
    if not row:
        row = AccountingSetting(key=key)
        db.add(row)
    row.value, row.changed_by_id, row.changed_by_name, row.changed_at = value, user.id, user.name, utcnow()
    audit(db, user, "comptabilite_configuration", f"{key} : {old} → {value}")


@router.get("/config")
def config(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not (has_permission(db, user, "comptabilite_journaux_consulter") or has_permission(db, user, "plan_comptable_modifier")):
        raise HTTPException(status_code=403, detail="Accès refusé")
    return configuration(db)


@router.post("/accounts", status_code=201)
def add_account(payload: AccountInput, db: Session = Depends(get_db), user: User = Depends(require_permission("plan_comptable_modifier"))):
    if db.get(AccountingAccount, payload.number):
        raise HTTPException(status_code=409, detail="Numéro de compte déjà utilisé")
    if int(payload.number[0]) != payload.class_number:
        raise HTTPException(status_code=400, detail="Classe incompatible avec le numéro")
    db.add(AccountingAccount(**payload.model_dump(), is_system=False))
    audit(db, user, "comptabilite_compte", json.dumps(payload.model_dump(), ensure_ascii=False))
    db.commit()
    return configuration(db)


@router.put("/accounts/{number}")
def edit_account(number: str, payload: AccountInput, db: Session = Depends(get_db), user: User = Depends(require_permission("plan_comptable_modifier"))):
    account = db.get(AccountingAccount, number)
    if not account:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if payload.number != number or payload.class_number != int(number[0]):
        raise HTTPException(status_code=400, detail="Le numéro et sa classe sont immuables")
    old = {key: getattr(account, key) for key in AccountInput.model_fields}
    for key, value in payload.model_dump().items():
        setattr(account, key, value)
    audit(db, user, "comptabilite_compte", f"{json.dumps(old, ensure_ascii=False)} → {payload.model_dump()}")
    db.commit()
    return configuration(db)


@router.put("/mapping")
def map_account(payload: MappingInput, db: Session = Depends(get_db), user: User = Depends(require_permission("plan_comptable_modifier"))):
    account = db.get(AccountingAccount, payload.account) if payload.account else None
    if payload.account and (not account or not account.active):
        raise HTTPException(status_code=400, detail="Compte absent ou inactif")
    if payload.key == "historical_tax" or not (payload.key in DEFAULT_LINKS or payload.key in {"mouvement:in", "mouvement:out"} or payload.key.startswith(("banque:", "depense:", "paiement:", "paie_retenue:"))):
        raise HTTPException(status_code=400, detail="Clé de liaison invalide")
    if account and payload.key.startswith("depense:") and account.class_number != 6:
        raise HTTPException(status_code=400, detail="Une dépense doit être liée à un compte de classe 6")
    setting(db, user, payload.key, payload.account or "")
    db.commit()
    return configuration(db)


@router.put("/historical-tax")
def historical_tax(payload: HistoricalInput, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    setting(db, user, "historical_tax", json.dumps({"rate": payload.rate, "start": payload.start.isoformat() if payload.start else None}))
    db.commit()
    return configuration(db)


@router.put("/debts/{debt_id}/purchase")
def link_purchase(debt_id: int, payload: LinkInput, db: Session = Depends(get_db), user: User = Depends(require_permission("plan_comptable_modifier"))):
    debt, purchase = db.get(Debt, debt_id), db.get(Purchase, payload.purchase_id)
    if not debt or not purchase:
        raise HTTPException(status_code=404, detail="Achat ou dette introuvable")
    if debt.kind != "dette" or purchase.status != "Reçu":
        raise HTTPException(status_code=400, detail="Liez une dette fournisseur à un achat reçu")
    if debt.purchase_id or db.query(Debt).filter(Debt.purchase_id == purchase.id).first():
        raise HTTPException(status_code=409, detail="Liaison existante conservée")
    if debt.supplier_id != purchase.supplier_id or (debt.supplier_id is None and debt.party != purchase.supplier_name):
        raise HTTPException(status_code=400, detail="Fournisseurs différents")
    if abs(debt.amount - purchase.balance) > 0.009:
        raise HTTPException(status_code=400, detail="Montants incompatibles : rapprochement manuel nécessaire")
    debt.purchase_id = purchase.id
    audit(db, user, "comptabilite_liaison", f"Dette {debt.id} → achat {purchase.id}")
    db.commit()
    return configuration(db)


@router.get("/report")
def read_report(kind: Literal["account", "sales", "purchases", "cash", "expenses", "settlements", "ledger", "balance", "customers", "suppliers", "debts", "stock", "margins"] = "ledger",
    start: date | None = None, end: date | None = None, account: str | None = None, user_id: int | None = None, operation_type: str | None = None, depot_id: int | None = None,
    export: bool = False, db: Session = Depends(get_db), user: User = Depends(require_permission("comptabilite_journaux_consulter"))):
    if export and not has_permission(db, user, "comptabilite_journaux_imprimer"):
        raise HTTPException(status_code=403, detail="Export comptable refusé")
    start, end = start or date.today().replace(day=1), end or date.today()
    if start > end:
        raise HTTPException(status_code=400, detail="Période invalide")
    if kind == "account" and not account:
        raise HTTPException(status_code=400, detail="Choisissez un compte")
    return report(db, kind, start.isoformat(), end.isoformat(), account, user_id, operation_type, depot_id)
