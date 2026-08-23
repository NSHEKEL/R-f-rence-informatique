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
from ..models import (
    Customer,
    Delivery,
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
from ..schemas import (
    DeliveryCreate,
    DeliveryOut,
    OrderCreate,
    OrderOut,
    OrderUpdate,
)
from ..sequences import next_reference

router = APIRouter(prefix="/api/orders", tags=["orders"])

OPEN_STATUSES = ("En attente", "Confirmée")


def _order_reference(db: Session) -> str:
    return next_reference(
        db, Order.reference, f"CMD-{datetime.now(timezone.utc).year}-"
    )


def _delivery_reference(db: Session) -> str:
    return next_reference(
        db, Delivery.reference, f"LIV-{datetime.now(timezone.utc).year}-"
    )


def _unit_price(product: Product, price_mode: str) -> float:
    if price_mode == "gros" and (product.wholesale_price or 0) > 0:
        return product.wholesale_price
    return product.sale_price


def _fill_items(db: Session, order: Order, payload) -> None:
    order.items.clear()
    total = 0.0
    for item in payload.items:
        product = db.query(Product).get(item.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Produit {item.product_id} introuvable"
            )
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        price = (
            item.unit_price
            if item.unit_price is not None and item.unit_price > 0
            else _unit_price(product, order.price_mode)
        )
        subtotal = price * item.quantity
        total += subtotal
        order.items.append(
            OrderItem(
                product_id=product.id,
                product_name=product.name,
                quantity=item.quantity,
                unit_price=price,
                subtotal=subtotal,
            )
        )
    order.total = total


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
        reference=_order_reference(db),
        customer_id=payload.customer_id,
        customer_name=customer_name,
        expected_date=payload.expected_date,
        deposit=payload.deposit,
        price_mode="gros" if payload.price_mode == "gros" else "detail",
        delivery_address=payload.delivery_address,
        note=payload.note,
        created_by_id=current_user.id,
    )
    _fill_items(db, order, payload)
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
        "delivery_address",
        "note",
        "status",
        "price_mode",
    ):
        if field in data and data[field] is not None:
            setattr(order, field, data[field])
    if payload.items is not None:
        _fill_items(db, order, payload)
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
        total=order.total,
    )
    for item in order.items:
        product = db.query(Product).get(item.product_id) if item.product_id else None
        if product is None:
            raise HTTPException(
                status_code=400,
                detail=f"L'article « {item.product_name} » n'existe plus",
            )
        result = db.execute(
            update(Product)
            .where(Product.id == product.id, Product.quantity >= item.quantity)
            .values(quantity=Product.quantity - item.quantity)
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
                quantity=-item.quantity,
                stock_before=product.quantity + item.quantity,
                stock_after=product.quantity,
                reason=f"Livraison {order.reference}",
                created_by_id=current_user.id,
            )
        )
        sale.items.append(
            SaleItem(
                product_id=product.id,
                product_name=product.name,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=item.subtotal,
            )
        )
    db.add(sale)
    db.flush()

    delivery = Delivery(
        reference=_delivery_reference(db),
        order_id=order.id,
        sale_id=sale.id,
        address=payload.address or order.delivery_address,
        carrier=payload.carrier,
        recipient=payload.recipient,
        note=payload.note,
        created_by_id=current_user.id,
    )
    order.status = "Livrée"
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


@router.get("/deliveries/all", response_model=list[DeliveryOut])
def list_deliveries(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("livraisons")),
):
    return db.query(Delivery).order_by(Delivery.date.desc()).all()
