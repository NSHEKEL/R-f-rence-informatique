"""Quotes and proforma invoices: no stock movement, no payment, ever.

Both live in the same table; `kind` says whether the paper is a commercial
offer (devis) or a forecast invoice (proforma). Converting one into the other,
or into a real order, copies the lines and leaves the source untouched.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Order, OrderItem, Product, Proforma, ProformaItem, User
from ..permissions import require_permission
from ..schemas import (
    ProformaConvert,
    ProformaCreate,
    ProformaItemCreate,
    ProformaOut,
    ProformaUpdate,
)
from ..sequences import next_reference

router = APIRouter(prefix="/api/proformas", tags=["proformas"])

KINDS = ("devis", "proforma")
STATUSES = ("Brouillon", "Envoyé", "Accepté", "Refusé", "Expiré")


def _generate_reference(db: Session, kind: str) -> str:
    prefix = "DEV" if kind == "devis" else "PRO"
    return next_reference(
        db, Proforma.reference, f"{prefix}-{datetime.now(timezone.utc).year}-"
    )


def _get(db: Session, proforma_id: int) -> Proforma:
    document = db.query(Proforma).get(proforma_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document introuvable")
    return document


def _fill(db: Session, document: Proforma, items: list[ProformaItemCreate]):
    """Rebuild the lines and the total; prices come from the catalogue."""
    if not items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins une ligne")
    document.items.clear()
    total = 0.0
    for item in items:
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        name = item.product_name
        price = item.unit_price
        reference = ""
        if item.product_id:
            product = db.query(Product).get(item.product_id)
            if not product:
                raise HTTPException(status_code=404, detail="Article introuvable")
            name = name or product.name
            price = price or product.sale_price
            reference = product.sku or ""
        if not name:
            raise HTTPException(status_code=400, detail="Désignation manquante")
        subtotal = max(price * item.quantity - (item.discount or 0), 0)
        total += subtotal
        document.items.append(
            ProformaItem(
                product_id=item.product_id,
                product_name=name,
                reference=reference,
                unit=item.unit or "u",
                quantity=item.quantity,
                unit_price=price,
                discount=item.discount or 0,
                subtotal=subtotal,
            )
        )
    document.total = max(total - (document.discount or 0), 0)


@router.get("", response_model=list[ProformaOut])
def list_proformas(
    kind: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("proformas")),
):
    query = db.query(Proforma)
    if kind:
        query = query.filter(Proforma.kind == kind)
    if status:
        query = query.filter(Proforma.status == status)
    return query.order_by(Proforma.date.desc()).all()


@router.get("/{proforma_id}", response_model=ProformaOut)
def get_proforma(
    proforma_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("proformas")),
):
    return _get(db, proforma_id)


@router.post("", response_model=ProformaOut, status_code=201)
def create_proforma(
    payload: ProformaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("proformas")),
):
    kind = payload.kind if payload.kind in KINDS else "devis"
    status = payload.status if payload.status in STATUSES else "Brouillon"
    document = Proforma(
        reference=_generate_reference(db, kind),
        customer_id=payload.customer_id,
        customer_name=payload.customer_name,
        valid_until=payload.valid_until,
        note=payload.note,
        kind=kind,
        status=status,
        discount=payload.discount,
        created_by_id=current_user.id,
        total=0,
    )
    _fill(db, document, payload.items)
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.put("/{proforma_id}", response_model=ProformaOut)
def update_proforma(
    proforma_id: int,
    payload: ProformaUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("proformas")),
):
    """Correct a document as long as it has not been turned into an order."""
    document = _get(db, proforma_id)
    if document.order_id:
        raise HTTPException(
            status_code=400,
            detail="Document déjà transformé en commande : modification impossible",
        )
    data = payload.model_dump(exclude_unset=True)
    for field in ("customer_id", "customer_name", "valid_until", "note"):
        if field in data:
            setattr(document, field, data[field])
    if data.get("status"):
        if data["status"] not in STATUSES:
            raise HTTPException(status_code=400, detail="Statut inconnu")
        document.status = data["status"]
    if data.get("discount") is not None:
        document.discount = data["discount"]
    if payload.items is not None:
        _fill(db, document, payload.items)
    elif data.get("discount") is not None:
        _fill(
            db,
            document,
            [
                ProformaItemCreate(
                    product_id=line.product_id,
                    product_name=line.product_name,
                    unit=line.unit,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount=line.discount,
                )
                for line in document.items
            ],
        )
    db.commit()
    db.refresh(document)
    return document


@router.post("/{proforma_id}/dupliquer", response_model=ProformaOut, status_code=201)
def duplicate_proforma(
    proforma_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("proformas")),
):
    """Same customer, same lines, a fresh number and a clean status."""
    source = _get(db, proforma_id)
    copy = Proforma(
        reference=_generate_reference(db, source.kind),
        customer_id=source.customer_id,
        customer_name=source.customer_name,
        valid_until=source.valid_until,
        note=source.note,
        kind=source.kind,
        status="Brouillon",
        discount=source.discount,
        created_by_id=current_user.id,
        total=source.total,
    )
    for line in source.items:
        copy.items.append(
            ProformaItem(
                product_id=line.product_id,
                product_name=line.product_name,
                reference=line.reference,
                unit=line.unit,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount=line.discount,
                subtotal=line.subtotal,
            )
        )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


@router.post("/{proforma_id}/transformer", response_model=ProformaOut)
def convert_proforma(
    proforma_id: int,
    payload: ProformaConvert,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("documents_transformer")),
):
    """Devis → Proforma, or either → Commande, keeping every amount."""
    source = _get(db, proforma_id)
    if source.status == "Annulé":
        raise HTTPException(status_code=400, detail="Document annulé")
    if payload.target == "proforma":
        if source.kind != "devis":
            raise HTTPException(
                status_code=400, detail="Ce document est déjà une proforma"
            )
        proforma = Proforma(
            reference=_generate_reference(db, "proforma"),
            customer_id=source.customer_id,
            customer_name=source.customer_name,
            valid_until=source.valid_until,
            note=source.note,
            kind="proforma",
            status="Brouillon",
            discount=source.discount,
            converted_from_id=source.id,
            created_by_id=current_user.id,
            total=source.total,
        )
        for line in source.items:
            proforma.items.append(
                ProformaItem(
                    product_id=line.product_id,
                    product_name=line.product_name,
                    reference=line.reference,
                    unit=line.unit,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    discount=line.discount,
                    subtotal=line.subtotal,
                )
            )
        source.status = "Accepté"
        db.add(proforma)
        db.commit()
        db.refresh(proforma)
        return proforma

    if payload.target != "commande":
        raise HTTPException(status_code=400, detail="Transformation inconnue")
    if source.order_id:
        raise HTTPException(
            status_code=400, detail="Document déjà transformé en commande"
        )
    missing = [line.product_name for line in source.items if not line.product_id]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Article hors catalogue : {missing[0]}",
        )
    order = Order(
        reference=next_reference(
            db, Order.reference, f"BC-{datetime.now(timezone.utc).year}-"
        ),
        customer_id=source.customer_id,
        customer_name=source.customer_name,
        status="Confirmée",
        total=source.total,
        discount=source.discount,
        deposit=max(payload.deposit, 0),
        note=source.note,
        created_by_id=current_user.id,
    )
    if order.deposit > order.total:
        raise HTTPException(
            status_code=400, detail="L'acompte dépasse le total de la commande"
        )
    for line in source.items:
        order.items.append(
            OrderItem(
                product_id=line.product_id,
                product_name=line.product_name,
                reference=line.reference,
                unit=line.unit,
                quantity=line.quantity,
                unit_price=line.unit_price,
                discount=line.discount,
                subtotal=line.subtotal,
            )
        )
    db.add(order)
    db.flush()
    source.order_id = order.id
    source.status = "Accepté"
    db.commit()
    db.refresh(source)
    return source


@router.delete("/{proforma_id}", status_code=204)
def delete_proforma(
    proforma_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("proformas")),
):
    document = _get(db, proforma_id)
    if document.order_id:
        raise HTTPException(
            status_code=400,
            detail="Document transformé en commande : suppression impossible",
        )
    db.delete(document)
    db.commit()
