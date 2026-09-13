"""Customer orders and their deliveries (administrator side).

An order reserves nothing: stock is only moved when the goods actually leave
the shop. Delivering an order therefore decrements the stock, records the
movements and books the matching sale so the turnover appears in the reports.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..database import get_db
from ..documents import (
    delivery_reference,
    fill_order_items,
    order_reference,
    refresh_order_status,
)
from ..models import (
    Customer,
    Delivery,
    DeliveryItem,
    Notification,
    Order,
    OrderItem,
    Product,
    Sale,
    SaleItem,
    StockMovement,
    User,
)
from ..permissions import require_permission
from ..receivables import open_order_receivable
from ..schemas import (
    DeliveryCreate,
    DeliveryOut,
    DeliveryUpdate,
    OrderCreate,
    OrderOut,
    OrderUpdate,
)
from ..sequences import next_reference

router = APIRouter(prefix="/api/orders", tags=["orders"])

OPEN_STATUSES = ("Brouillon", "En attente", "Confirmée", "Partiellement livrée")


@router.get("", response_model=list[OrderOut])
def list_orders(
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("commandes")),
):
    query = db.query(Order)
    if status:
        query = query.filter(Order.status == status)
    return query.order_by(Order.date.desc()).all()


@router.get("/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("commandes")),
):
    order = db.query(Order).get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    return order


@router.post("", response_model=OrderOut, status_code=201)
def create_order(
    payload: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("commandes_gerer")),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins un article")
    customer_name = payload.customer_name.strip()
    if payload.customer_id:
        customer = db.query(Customer).get(payload.customer_id)
        if not customer:
            raise HTTPException(status_code=404, detail="Client introuvable")
        customer_name = customer.name
    if not customer_name:
        raise HTTPException(status_code=400, detail="Indiquez le client")

    order = Order(
        reference=order_reference(db),
        customer_id=payload.customer_id,
        customer_name=customer_name,
        expected_date=payload.expected_date,
        deposit=payload.deposit,
        discount=max(payload.discount, 0.0),
        status=payload.status or "Brouillon",
        price_mode="gros" if payload.price_mode == "gros" else "detail",
        delivery_address=payload.delivery_address,
        payment_terms=payload.payment_terms,
        delivery_terms=payload.delivery_terms,
        note=payload.note,
        created_by_id=current_user.id,
    )
    fill_order_items(db, order, payload.items)
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


@router.put("/{order_id}", response_model=OrderOut)
def update_order(
    order_id: int,
    payload: OrderUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("commandes_gerer")),
):
    order = db.query(Order).get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    if order.status == "Livrée":
        raise HTTPException(
            status_code=400, detail="Une commande livrée ne peut plus changer"
        )
    data = payload.model_dump(exclude_unset=True)
    for field in (
        "customer_id",
        "customer_name",
        "expected_date",
        "deposit",
        "discount",
        "delivery_address",
        "payment_terms",
        "delivery_terms",
        "note",
        "status",
        "price_mode",
    ):
        if field in data and data[field] is not None:
            setattr(order, field, data[field])
    if payload.items is not None:
        if any((item.delivered_quantity or 0) > 0 for item in order.items):
            raise HTTPException(
                status_code=400,
                detail="Commande déjà livrée en partie : lignes verrouillées",
            )
        fill_order_items(db, order, payload.items)
    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/duplicate", response_model=OrderOut, status_code=201)
def duplicate_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("commandes_gerer")),
):
    """Copy an order into a fresh draft, nothing delivered yet."""
    source = db.query(Order).get(order_id)
    if not source:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    order = Order(
        reference=order_reference(db),
        customer_id=source.customer_id,
        customer_name=source.customer_name,
        expected_date=source.expected_date,
        discount=source.discount,
        status="Brouillon",
        price_mode=source.price_mode,
        delivery_address=source.delivery_address,
        payment_terms=source.payment_terms,
        delivery_terms=source.delivery_terms,
        note=source.note,
        created_by_id=current_user.id,
    )
    for item in source.items:
        order.items.append(
            OrderItem(
                product_id=item.product_id,
                product_name=item.product_name,
                reference=item.reference,
                unit=item.unit,
                quantity=item.quantity,
                unit_price=item.unit_price,
                discount=item.discount,
                subtotal=item.subtotal,
            )
        )
    order.total = source.total
    db.add(order)
    db.commit()
    db.refresh(order)
    return order


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("commandes_annuler")),
):
    order = db.query(Order).get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    if any((item.delivered_quantity or 0) > 0 for item in order.items):
        raise HTTPException(
            status_code=400,
            detail="Commande déjà livrée en partie : annulation impossible",
        )
    order.status = "Annulée"
    db.commit()
    db.refresh(order)
    return order


@router.delete("/{order_id}", status_code=204)
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("commandes_gerer")),
):
    order = db.query(Order).get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    if order.status == "Livrée":
        raise HTTPException(
            status_code=400,
            detail="Une commande livrée ne peut pas être supprimée",
        )
    db.delete(order)
    db.commit()


@router.post("/{order_id}/deliver", response_model=DeliveryOut, status_code=201)
def deliver_order(
    order_id: int,
    payload: DeliveryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("commandes_gerer")),
):
    """Hand the goods over: stock out, delivery note and matching sale."""
    order = db.query(Order).get(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Commande introuvable")
    if order.status not in OPEN_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Commande « {order.status} » : livraison impossible",
        )

    remaining = [item for item in order.items if item.remaining_quantity > 0]
    if not remaining:
        raise HTTPException(status_code=400, detail="Commande déjà livrée")
    lines: list[DeliveryItem] = []
    sale = Sale(
        reference=next_reference(
            db, Sale.reference, f"VNT-{datetime.now(timezone.utc).year}-"
        ),
        customer_id=order.customer_id,
        status="Payée" if payload.paid else "En attente",
        payment_method=payload.payment_method,
        note=f"Commande {order.reference}",
        price_mode=order.price_mode,
        created_by_id=current_user.id,
        total=sum(
            item.unit_price * item.remaining_quantity for item in remaining
        ),
    )
    for item in remaining:
        quantity = item.remaining_quantity
        product = db.query(Product).get(item.product_id) if item.product_id else None
        if product is None:
            raise HTTPException(
                status_code=400,
                detail=f"L'article « {item.product_name} » n'existe plus",
            )
        result = db.execute(
            update(Product)
            .where(Product.id == product.id, Product.quantity >= quantity)
            .values(quantity=Product.quantity - quantity)
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
                quantity=-quantity,
                stock_before=product.quantity + quantity,
                stock_after=product.quantity,
                reason=f"Livraison {order.reference}",
                created_by_id=current_user.id,
            )
        )
        sale.items.append(
            SaleItem(
                product_id=product.id,
                product_name=product.name,
                quantity=quantity,
                unit_price=item.unit_price,
                subtotal=item.unit_price * quantity,
            )
        )
        lines.append(
            DeliveryItem(
                product_id=product.id,
                product_name=product.name,
                reference=item.reference or product.sku,
                unit=item.unit or "u",
                ordered_quantity=item.quantity,
                previously_delivered=item.delivered_quantity or 0,
                quantity=quantity,
                unit_price=item.unit_price,
                subtotal=item.unit_price * quantity,
            )
        )
        item.delivered_quantity = (item.delivered_quantity or 0) + quantity
    db.add(sale)
    db.flush()

    delivery = Delivery(
        reference=delivery_reference(db),
        order_id=order.id,
        customer_id=order.customer_id,
        customer_name=order.customer_name,
        status="Validé",
        validated_at=datetime.now(timezone.utc),
        sale_id=sale.id,
        address=payload.address or order.delivery_address,
        carrier=payload.carrier,
        recipient=payload.recipient,
        note=payload.note,
        created_by_id=current_user.id,
    )
    delivery.items.extend(lines)
    refresh_order_status(order)
    if payload.paid:
        order.deposit = order.total
    else:
        open_order_receivable(db, order, current_user)
    db.add(delivery)
    db.add(
        Notification(
            kind="livraison",
            title=f"Commande livrée — {order.reference}",
            message=(
                f"{order.customer_name} — bon de livraison "
                f"{delivery.reference}"
            ),
            link="/commandes",
            sale_id=sale.id,
        )
    )
    db.commit()
    db.refresh(delivery)
    return delivery


@router.put("/deliveries/{delivery_id}", response_model=DeliveryOut)
def update_delivery(
    delivery_id: int,
    payload: DeliveryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("commandes_gerer")),
):
    """Correct a delivery note: address, carrier, recipient or remark.

    The goods already left, so the stock movements and the sale are untouched.
    """
    delivery = db.query(Delivery).get(delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Livraison introuvable")
    data = payload.model_dump(exclude_unset=True)
    for field in ("address", "carrier", "recipient", "note"):
        if field in data and data[field] is not None:
            setattr(delivery, field, data[field])
    db.commit()
    db.refresh(delivery)
    return delivery


@router.get("/deliveries/all", response_model=list[DeliveryOut])
def list_deliveries(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("livraisons")),
):
    return db.query(Delivery).order_by(Delivery.date.desc()).all()
