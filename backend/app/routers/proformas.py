"""Proforma invoices (quotations): no stock movement, no payment."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..database import get_db
from ..models import Product, Proforma, ProformaItem, User
from ..schemas import ProformaCreate, ProformaOut
from ..sequences import next_reference

router = APIRouter(prefix="/api/proformas", tags=["proformas"])


def _generate_reference(db: Session) -> str:
    return next_reference(
        db, Proforma.reference, f"PRO-{datetime.now(timezone.utc).year}-"
    )


@router.get("", response_model=list[ProformaOut])
def list_proformas(
    db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    return db.query(Proforma).order_by(Proforma.date.desc()).all()


@router.get("/{proforma_id}", response_model=ProformaOut)
def get_proforma(
    proforma_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    proforma = db.query(Proforma).get(proforma_id)
    if not proforma:
        raise HTTPException(status_code=404, detail="Proforma introuvable")
    return proforma


@router.post("", response_model=ProformaOut, status_code=201)
def create_proforma(
    payload: ProformaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins une ligne")

    proforma = Proforma(
        reference=_generate_reference(db),
        customer_id=payload.customer_id,
        customer_name=payload.customer_name,
        valid_until=payload.valid_until,
        note=payload.note,
        created_by_id=current_user.id,
        total=0,
    )
    total = 0.0
    for item in payload.items:
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        name = item.product_name
        price = item.unit_price
        if item.product_id:
            product = db.query(Product).get(item.product_id)
            if not product:
                raise HTTPException(
                    status_code=404, detail="Article introuvable"
                )
            name = name or product.name
            price = price or product.sale_price
        if not name:
            raise HTTPException(status_code=400, detail="Désignation manquante")
        subtotal = price * item.quantity
        total += subtotal
        proforma.items.append(
            ProformaItem(
                product_id=item.product_id,
                product_name=name,
                quantity=item.quantity,
                unit_price=price,
                subtotal=subtotal,
            )
        )
    proforma.total = total
    db.add(proforma)
    db.commit()
    db.refresh(proforma)
    return proforma


@router.delete("/{proforma_id}", status_code=204)
def delete_proforma(
    proforma_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    proforma = db.query(Proforma).get(proforma_id)
    if not proforma:
        raise HTTPException(status_code=404, detail="Proforma introuvable")
    db.delete(proforma)
    db.commit()
