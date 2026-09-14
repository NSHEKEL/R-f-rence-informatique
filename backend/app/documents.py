"""Purchase orders (BC) and delivery notes (BL): shared rules.

A purchase order never moves the stock; only a validated delivery note does,
and each note only takes out the quantity it really hands over. The helpers
below are used by both routers so the numbering, the totals and the status of
a partially delivered order stay consistent.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import CompanySettings, Delivery, Order, OrderItem, Product
from .printing import read_config
from .sequences import next_reference

DOCUMENT_DIGITS = 6


def document_config(db: Session):
    settings = db.query(CompanySettings).first()
    if settings is None:
        settings = CompanySettings()
    return read_config(settings).documents


def order_reference(db: Session) -> str:
    prefix = document_config(db).order_prefix or "BC"
    year = datetime.now(timezone.utc).year
    return next_reference(
        db, Order.reference, f"{prefix}-{year}-", DOCUMENT_DIGITS
    )


def delivery_reference(db: Session) -> str:
    prefix = document_config(db).delivery_prefix or "BL"
    year = datetime.now(timezone.utc).year
    return next_reference(
        db, Delivery.reference, f"{prefix}-{year}-", DOCUMENT_DIGITS
    )


def unit_price(product: Product, price_mode: str) -> float:
    if price_mode == "gros" and (product.wholesale_price or 0) > 0:
        return product.wholesale_price
    return product.sale_price


def fill_order_items(db: Session, order: Order, items) -> None:
    """Replace the lines of an order and recompute its total."""
    order.items.clear()
    total = 0.0
    for item in items:
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
            else unit_price(product, order.price_mode)
        )
        discount = max(getattr(item, "discount", 0) or 0, 0)
        subtotal = max(price * item.quantity - discount, 0)
        total += subtotal
        order.items.append(
            OrderItem(
                product_id=product.id,
                product_name=product.name,
                reference=product.sku,
                unit=getattr(item, "unit", "u") or "u",
                quantity=item.quantity,
                unit_price=price,
                discount=discount,
                subtotal=subtotal,
            )
        )
    order.total = max(total - (order.discount or 0), 0)


def refresh_order_status(order: Order) -> None:
    """Move the order between confirmed, partially delivered and delivered."""
    if order.status == "Annulée":
        return
    delivered = sum((item.delivered_quantity or 0) for item in order.items)
    ordered = sum(item.quantity for item in order.items)
    if delivered <= 0:
        if order.status in ("Partiellement livrée", "Livrée"):
            order.status = "Confirmée"
        return
    order.status = "Livrée" if delivered >= ordered else "Partiellement livrée"
