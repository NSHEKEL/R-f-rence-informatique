"""Delivery notes (BL): drafts, partial deliveries and validation.

A draft moves nothing. Validating a note takes the delivered quantities out of
the stock exactly once, records the movements and books the matching sale, so
an order can be handed over in several times without ever being counted twice.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..database import get_db
from ..documents import delivery_reference, refresh_order_status
from ..models import (
    Customer,
    Delivery,
    DeliveryItem,
    Notification,
    Order,
    Product,
    Sale,
    SaleItem,
    StockMovement,
    User,
)
from ..permissions import require_permission
from ..receivables import open_order_receivable
from ..schemas import (
    DeliveryNoteCreate,
    DeliveryNoteUpdate,
    DeliveryOut,
    DeliveryValidate,
)
from ..sequences import next_reference

router = APIRouter(prefix="/api/delivery-notes", tags=["deliveries"])


def _get(db: Session, delivery_id: int) -> Delivery:
    delivery = db.query(Delivery).get(delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Bon de livraison introuvable")
    return delivery


def _order_line(order: Order | None, product_id: int):
    if order is None:
        return None
    return next(
        (item for item in order.items if item.product_id == product_id), None
    )


def _fill_lines(db: Session, delivery: Delivery, items) -> None:
    """Rebuild the lines, refusing to deliver more than what remains."""
    order = delivery.order
    delivery.items.clear()
    if not items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins un article")
    for item in items:
        product = db.query(Product).get(item.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Produit {item.product_id} introuvable"
            )
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        line = _order_line(order, product.id)
        if order is not None and line is None:
            raise HTTPException(
                status_code=400,
                detail=f"« {product.name} » n'est pas dans la commande",
            )
        already = line.delivered_quantity or 0 if line else 0
        if line is not None and item.quantity > line.quantity - already:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{product.name} : reste à livrer "
                    f"{line.quantity - already}, demandé {item.quantity}"
                ),
            )
        price = (
            item.unit_price
            if item.unit_price is not None and item.unit_price > 0
            else line.unit_price if line else product.sale_price
        )
        delivery.items.append(
            DeliveryItem(
                product_id=product.id,
                product_name=product.name,
                reference=product.sku,
                unit=item.unit or "u",
                ordered_quantity=line.quantity if line else item.quantity,
                previously_delivered=already,
                quantity=item.quantity,
                unit_price=price,
                subtotal=price * item.quantity,
                observation=item.observation,
            )
        )


@router.get("", response_model=list[DeliveryOut])
def list_notes(
    status: str | None = None,
    order_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("livraisons")),
):
    query = db.query(Delivery)
    if status:
        query = query.filter(Delivery.status == status)
    if order_id:
        query = query.filter(Delivery.order_id == order_id)
    return query.order_by(Delivery.date.desc()).all()


@router.get("/{delivery_id}", response_model=DeliveryOut)
def get_note(
    delivery_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("livraisons")),
):
    return _get(db, delivery_id)


@router.post("", response_model=DeliveryOut, status_code=201)
def create_note(
    payload: DeliveryNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("livraisons_gerer")),
):
    """Create a draft note, either standalone or from a purchase order."""
    order = None
    if payload.order_id:
        order = db.query(Order).get(payload.order_id)
        if not order:
            raise HTTPException(status_code=404, detail="Commande introuvable")
        if order.status == "Annulée":
            raise HTTPException(
                status_code=400, detail="Commande annulée : livraison impossible"
            )
    customer_name = payload.customer_name.strip()
    customer_id = payload.customer_id
    if order is not None:
        customer_id = customer_id or order.customer_id
        customer_name = customer_name or order.customer_name
    if customer_id:
        customer = db.query(Customer).get(customer_id)
        if not customer:
            raise HTTPException(status_code=404, detail="Client introuvable")
        customer_name = customer.name
    if not customer_name:
        raise HTTPException(status_code=400, detail="Indiquez le client")

    delivery = Delivery(
        reference=delivery_reference(db),
        order_id=order.id if order else None,
        customer_id=customer_id,
        customer_name=customer_name,
        status="Brouillon",
        address=payload.address or (order.delivery_address if order else ""),
        carrier=payload.carrier,
        recipient=payload.recipient or customer_name,
        note=payload.note,
        created_by_id=current_user.id,
    )
    delivery.order = order
    _fill_lines(db, delivery, payload.items)
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


@router.put("/{delivery_id}", response_model=DeliveryOut)
def update_note(
    delivery_id: int,
    payload: DeliveryNoteUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("livraisons_gerer")),
):
    delivery = _get(db, delivery_id)
    if delivery.status != "Brouillon":
        raise HTTPException(
            status_code=400,
            detail="Seul un bon en brouillon peut être modifié",
        )
    data = payload.model_dump(exclude_unset=True)
    for field in (
        "customer_id",
        "customer_name",
        "address",
        "carrier",
        "recipient",
        "note",
    ):
        if field in data and data[field] is not None:
            setattr(delivery, field, data[field])
    if payload.items is not None:
        _fill_lines(db, delivery, payload.items)
    db.commit()
    db.refresh(delivery)
    return delivery


@router.post("/{delivery_id}/validate", response_model=DeliveryOut)
def validate_note(
    delivery_id: int,
    payload: DeliveryValidate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("livraisons_valider")),
):
    """Hand the goods over: stock out once, movements, sale and receivable."""
    delivery = _get(db, delivery_id)
    if delivery.status == "Validé":
        raise HTTPException(status_code=400, detail="Bon déjà validé")
    if delivery.status == "Annulé":
        raise HTTPException(status_code=400, detail="Bon annulé")

    order = delivery.order
    sale = Sale(
        reference=next_reference(
            db, Sale.reference, f"VNT-{datetime.now(timezone.utc).year}-"
        ),
        customer_id=delivery.customer_id,
        status="Payée" if payload.paid else "En attente",
        payment_method=payload.payment_method,
        note=f"Livraison {delivery.reference}",
        price_mode=order.price_mode if order else "detail",
        created_by_id=current_user.id,
        total=sum(line.subtotal for line in delivery.items),
    )
    for line in delivery.items:
        product = db.query(Product).get(line.product_id) if line.product_id else None
        if product is None:
            raise HTTPException(
                status_code=400,
                detail=f"L'article « {line.product_name} » n'existe plus",
            )
        result = db.execute(
            update(Product)
            .where(Product.id == product.id, Product.quantity >= line.quantity)
            .values(quantity=Product.quantity - line.quantity)
        )
        if result.rowcount == 0:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Stock insuffisant pour {product.name} "
                    f"(disponible : {product.quantity})"
                ),
            )
        db.refresh(product)
        db.add(
            StockMovement(
                product_id=product.id,
                product_name=product.name,
                kind="vente",
                quantity=-line.quantity,
                stock_before=product.quantity + line.quantity,
                stock_after=product.quantity,
                reason=f"Bon de livraison {delivery.reference}",
                created_by_id=current_user.id,
            )
        )
        sale.items.append(
            SaleItem(
                product_id=product.id,
                product_name=product.name,
                quantity=line.quantity,
                unit_price=line.unit_price,
                subtotal=line.subtotal,
            )
        )
        if order is not None:
            item = next(
                (i for i in order.items if i.product_id == product.id), None
            )
            if item is not None:
                item.delivered_quantity = (
                    item.delivered_quantity or 0
                ) + line.quantity
    db.add(sale)
    db.flush()

    delivery.sale_id = sale.id
    delivery.status = "Validé"
    delivery.validated_at = datetime.now(timezone.utc)
    if order is not None:
        refresh_order_status(order)
        if payload.paid:
            order.deposit = min(
                (order.deposit or 0) + sale.total, order.total
            )
        elif order.status == "Livrée":
            open_order_receivable(db, order, current_user)
    db.add(
        Notification(
            kind="livraison",
            title=f"Bon de livraison validé — {delivery.reference}",
            message=f"{delivery.customer_name} — {len(delivery.items)} ligne(s)",
            link="/livraisons",
            sale_id=sale.id,
        )
    )
    db.commit()
    db.refresh(delivery)
    return delivery


@router.post("/{delivery_id}/cancel", response_model=DeliveryOut)
def cancel_note(
    delivery_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("livraisons_annuler")),
):
    """Cancel a note. A validated one keeps its stock movements."""
    delivery = _get(db, delivery_id)
    if delivery.status == "Annulé":
        return delivery
    delivery.status = "Annulé"
    db.commit()
    db.refresh(delivery)
    return delivery


@router.delete("/{delivery_id}", status_code=204)
def delete_note(
    delivery_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("livraisons_gerer")),
):
    delivery = _get(db, delivery_id)
    if delivery.status == "Validé":
        raise HTTPException(
            status_code=400,
            detail="Un bon validé ne peut pas être supprimé, seulement annulé",
        )
    db.delete(delivery)
    db.commit()
