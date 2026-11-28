import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Debt, DebtPayment, Product, Purchase, SecurityLog, Supplier, User
from ..permissions import require_permission
from ..schemas import SupplierCreate, SupplierOut

router = APIRouter(prefix="/api/suppliers", tags=["suppliers"])


@router.get("", response_model=list[SupplierOut])
def list_suppliers(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Supplier).order_by(Supplier.name).all()


@router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("fournisseurs_gerer")),
):
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.put("/{supplier_id}", response_model=SupplierOut)
def update_supplier(
    supplier_id: int,
    payload: SupplierCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("fournisseurs_gerer")),
):
    supplier = db.query(Supplier).get(supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail="Fournisseur introuvable")
    for key, value in payload.model_dump().items():
        setattr(supplier, key, value)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}", status_code=204)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("fournisseurs_gerer")),
):
    supplier = db.query(Supplier).filter_by(id=supplier_id).with_for_update().first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Fournisseur introuvable")
    sources = {"supplier": {col.name: getattr(supplier, col.name) for col in Supplier.__table__.columns},
        "products": [row[0] for row in db.query(Product.id).filter_by(supplier_id=supplier_id)],
        "purchases": [row[0] for row in db.query(Purchase.id).filter_by(supplier_id=supplier_id)],
        "debts": [row[0] for row in db.query(Debt.id).filter_by(supplier_id=supplier_id)],
        "payments": [row[0] for row in db.query(DebtPayment.id).join(Debt).filter(Debt.supplier_id == supplier_id)]}
    for model in (Product, Purchase, Debt):
        db.query(model).filter(model.supplier_id == supplier_id).update({model.supplier_id: None}, synchronize_session="fetch")
    db.add(SecurityLog(event="suppression_fournisseur", user_id=user.id, identifier=user.email,
        success=True, detail=json.dumps(sources, ensure_ascii=False, default=str)))
    db.delete(supplier)
    db.commit()
