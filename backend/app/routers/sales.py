from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import backup, remote_sales
from ..database import get_db
from ..models import (
    Debt,
    Notification,
    Product,
    Sale,
    SaleItem,
    SalePayment,
    StockLot,
    StockMovement,
    User,
)
from ..permissions import has_permission, require_permission
from ..schemas import SaleCreate, SaleOut, SaleUpdate
from ..sequences import next_reference
from .cash import lock_current_session
from ..units import base_quantity, prices, snapshot, selected_packaging, resolve_tier
from ..profits import financials
from .. import stock
from ..product_codes import scanned_product

router = APIRouter(prefix="/api/sales", tags=["sales"])


MAX_REFERENCE_ATTEMPTS = 5


def sale_output(sale, db, user):
    result = SaleOut.model_validate(sale)
    if has_permission(db, user, "rapports_financiers"):
        purchase_prices = {item.product_id: (item.product.purchase_price or 0) if item.product else 0 for item in sale.items}
        for source, target in zip(sale.items, result.items):
            for key, value in financials(sale, source, purchase_prices).items():
                setattr(target, key, value)
        result.cost = sum(item.cost for item in result.items)
        result.profit = sum(item.profit for item in result.items)
        revenue = sum(item.revenue for item in result.items)
        result.margin = result.profit / revenue * 100 if revenue else 0.0
    else:
        for item in result.items:
            item.unit_cost = None
    return result


def _generate_reference(db: Session) -> str:
    return next_reference(
        db, Sale.reference, f"VNT-{datetime.now(timezone.utc).year}-"
    )


@router.get("", response_model=list[SaleOut])
def list_sales(
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ventes")),
):
    return [sale_output(sale, db, user) for sale in db.query(Sale).order_by(Sale.date.desc()).all()]


@router.get("/by-reference/{reference}", response_model=SaleOut)
def get_sale_by_reference(
    reference: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ventes")),
):
    """Ticket lookup used by the returns screen."""
    sale = db.query(Sale).filter(Sale.reference == reference.strip()).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    return sale_output(sale, db, user)


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ventes")),
):
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    return sale_output(sale, db, user)


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(
    payload: SaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("vente_nouvelle")),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins un article")

    if payload.client_id:
        # Replay of a ticket recorded offline: return the stored one.
        existing = (
            db.query(Sale).filter(Sale.client_id == payload.client_id).first()
        )
        if existing:
            return sale_output(existing, db, current_user)

    # Several workstations may checkout at the same time: retry when two of
    # them pick the same reference.
    for attempt in range(MAX_REFERENCE_ATTEMPTS):
        try:
            return sale_output(_persist_sale(db, payload, current_user), db, current_user)
        except (IntegrityError, HTTPException) as exc:
            db.rollback()
            if payload.client_id:
                existing = db.query(Sale).filter(Sale.client_id == payload.client_id).first()
                if existing:
                    return sale_output(existing, db, current_user)
            if isinstance(exc, HTTPException):
                raise
            if attempt == MAX_REFERENCE_ATTEMPTS - 1:
                raise HTTPException(
                    status_code=409,
                    detail="Caisse occupée, veuillez réessayer",
                )
    raise HTTPException(status_code=409, detail="Caisse occupée, veuillez réessayer")


def _consume_lots_fefo(db: Session, product: Product, quantity: int, depot_id=None) -> None:
    """Draw `quantity` from the product's tagged lots, earliest expiry first.

    Never fails the sale: if the tagged lots run out, the remainder comes
    from the untagged stock already decremented on the product row.
    """
    remaining = quantity
    lots = (
        db.query(StockLot)
        .filter(
            StockLot.product_id == product.id,
            StockLot.quantity > 0,
            (StockLot.depot_id == stock.resolve(db, depot_id)) | (StockLot.depot_id.is_(None) & (stock.resolve(db, depot_id) == stock.resolve(db))),
            # Expired lots never reach the customer.
            (StockLot.expiry_date.is_(None)) | (StockLot.expiry_date >= datetime.now()),
        )
        .order_by(StockLot.expiry_date.is_(None), StockLot.expiry_date.asc(), StockLot.id.asc())
        .all()
    )
    for lot in lots:
        if remaining <= 0:
            break
        take = min(lot.quantity, remaining)
        lot.quantity -= take
        remaining -= take


def _persist_sale(db: Session, payload: SaleCreate, current_user: User) -> Sale:
    depot_id = stock.resolve(db)
    if payload.discount > 0 and not has_permission(db, current_user, "prix_modifier"):
        raise HTTPException(status_code=403, detail="Vous n'avez pas le droit de modifier le prix de vente")
    if payload.is_gift and not has_permission(
        db, current_user, "ventes_cadeau"
    ):
        raise HTTPException(
            status_code=403,
            detail="Vous n'avez pas le droit d'enregistrer une vente cadeau",
        )
    reference = _generate_reference(db)
    session = lock_current_session(db, current_user)
    if session is None:
        raise HTTPException(
            status_code=400,
            detail="Votre caisse est fermée. Veuillez ouvrir une session de "
            "caisse avant d'effectuer une vente.",
        )
    sale = Sale(
        reference=reference,
        client_id=payload.client_id,
        customer_id=payload.customer_id,
        status=payload.status,
        payment_method=payload.payment_method,
        note=payload.note,
        price_mode=payload.price_mode if payload.price_mode in {"detail", "semi_gros", "gros", "auto"} else "detail",
        paid_amount=max(payload.paid_amount, 0.0),
        discount=max(payload.discount, 0.0),
        discount_by_id=current_user.id if payload.discount > 0 else None,
        is_gift=bool(payload.is_gift),
        created_by_id=current_user.id,
        cash_session_id=session.id,
        total=0,
    )
    total = 0.0
    low_stock: list[Product] = []
    for item in payload.items:
        product = db.query(Product).get(item.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Produit {item.product_id} introuvable"
            )
        spec = selected_packaging(db, product, item.packaging_id)
        if item.expected_units_per_packaging is not None and item.expected_units_per_packaging != (spec.units_per_packaging or 1):
            raise HTTPException(status_code=409, detail="Conditionnement modifié : vérifiez le ticket avant synchronisation")
        quantity = base_quantity(item, spec)
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        item = item.model_copy(update={"quantity": quantity})
        if product.quantity < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuffisant pour {product.name} "
                f"(disponible : {product.quantity})",
            )
        tier = resolve_tier(product, item.price_tier or sale.price_mode, quantity)
        base_price, pack_price = prices(spec, tier)
        packs = item.packaging_quantity or 0
        pieces = item.piece_quantity if item.piece_quantity is not None else (0 if item.packaging_quantity is not None else item.quantity)
        unit_price = (packs * pack_price + pieces * base_price) / quantity
        catalog_unit_price = unit_price
        if item.unit_price is not None and abs(item.unit_price - unit_price) > 0.000001:
            if not has_permission(db, current_user, "prix_modifier"):
                raise HTTPException(
                    status_code=403,
                    detail="Vous n'avez pas le droit de modifier le prix de vente",
                )
            if item.unit_price < 0:
                raise HTTPException(status_code=400, detail="Prix invalide")
            unit_price = float(item.unit_price)
            base_price = unit_price
            pack_price = unit_price * (spec.units_per_packaging or 1)
        line_discount = 0.0
        if (item.discount or 0) > 0:
            # A line discount is a price change: same right required.
            if not has_permission(db, current_user, "prix_modifier"):
                raise HTTPException(
                    status_code=403,
                    detail="Vous n'avez pas le droit de modifier le prix de vente",
                )
            line_discount = min(float(item.discount), unit_price * item.quantity)
        subtotal = unit_price * item.quantity - line_discount
        total += subtotal
        scanned_label = None
        if item.scanned_code:
            scanned, _, alias = scanned_product(db, item.scanned_code)
            if scanned.id != product.id:
                raise HTTPException(400, "Le code scanné ne correspond pas à cet article")
            scanned_label = alias.label if alias else None
        sale.items.append(
            SaleItem(
                scanned_code=item.scanned_code.strip() if item.scanned_code else None,
                scanned_label=scanned_label,
                packaging_id=item.packaging_id,
                price_tier=tier,
                catalog_unit_price=catalog_unit_price,
                unit_cost=product.purchase_price or 0,
                **snapshot(spec),
                sold_unit="mixte" if packs and pieces else (spec.packaging_unit if packs else spec.base_unit),
                packaging_quantity=packs, piece_quantity=pieces, base_quantity=quantity,
                base_unit_price=base_price, packaging_sale_price=pack_price,
                product_id=product.id,
                product_name=product.name,
                quantity=item.quantity,
                unit_price=unit_price,
                discount=line_discount,
                subtotal=subtotal,
            )
        )
        if payload.status != "Annulée":
            before, after = stock.adjust(db, product, -item.quantity, check_total=True)
            db.add(
                StockMovement(
                    depot_id=depot_id,
                    product_id=product.id,
                    product_name=product.name,
                    kind="vente",
                    quantity=-item.quantity,
                    stock_before=before,
                    stock_after=after,
                    reason=sale.reference,
                    created_by_id=current_user.id,
                )
            )
            _consume_lots_fefo(db, product, item.quantity, depot_id)
            if product.quantity <= product.min_stock:
                low_stock.append(product)

    sale.total = max(total - sale.discount, 0.0)
    total = sale.total
    if payload.payments is not None:
        legs = [
            (p.method.strip(), float(p.amount))
            for p in payload.payments
            if (p.method or "").strip() and float(p.amount) > 0
        ]
        if not legs:
            raise HTTPException(
                status_code=400, detail="Paiement mixte : aucun montant valide"
            )
        if abs(sum(amount for _, amount in legs) - total) > 0.01:
            raise HTTPException(
                status_code=400,
                detail="Paiement mixte : la somme des montants doit égaler "
                "le total du ticket",
            )
        methods = {method for method, _ in legs}
        sale.payment_method = (
            legs[0][0] if len(methods) == 1 else "Mixte"
        )
        for method, amount in legs:
            sale.payments.append(SalePayment(method=method, amount=amount))
    db.add(sale)
    db.flush()
    _check_credit_limit(db, sale)
    _open_receivable(db, sale, current_user)

    if current_user.role != "admin":
        db.add(
            Notification(
                kind="vente",
                title=f"Nouvelle vente — {sale.reference}",
                message=(
                    f"{current_user.name} a enregistré une vente de "
                    f"{total:,.0f} FCFA ({payload.payment_method})".replace(
                        ",", " "
                    )
                ),
                link="/ventes",
                sale_id=sale.id,
            )
        )
    for product in low_stock:
        db.add(
            Notification(
                kind="stock",
                title=f"Stock faible — {product.name}",
                message=(
                    f"Il reste {product.quantity} unité(s) "
                    f"(seuil : {product.min_stock})"
                ),
                link="/produits",
            )
        )

    db.commit()
    db.refresh(sale)
    _backup_after_sale(db)
    remote_sales.schedule()
    return sale


def _credit_amount(sale: Sale) -> float:
    """Amount of a sale that stays unpaid (credit legs or credit method)."""
    if sale.status == "Annulée":
        return 0
    if sale.payments:
        return sum(
            leg.amount for leg in sale.payments if "crédit" in leg.method.lower()
        )
    if "crédit" in (sale.payment_method or "").lower():
        return sale.total
    return 0


def _check_credit_limit(db: Session, sale: Sale) -> None:
    """Refuses a credit sale that would exceed the customer's credit limit."""
    if not sale.customer_id:
        return
    limit = sale.customer.credit_limit if sale.customer else 0
    if not limit or limit <= 0:
        return
    new_credit = _credit_amount(sale)
    if new_credit <= 0:
        return
    open_debts = (
        db.query(Debt)
        .filter(Debt.kind == "creance", Debt.customer_id == sale.customer_id)
        .all()
    )
    outstanding = sum(d.remaining for d in open_debts)
    if outstanding + new_credit > limit + 0.009:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Plafond de crédit dépassé pour {sale.customer.name} : "
                f"encours {outstanding:,.0f} FCFA + {new_credit:,.0f} FCFA "
                f"> {limit:,.0f} FCFA".replace(",", " ")
            ),
        )


def _open_receivable(db: Session, sale: Sale, current_user: User) -> None:
    """A sale settled later stays visible in Dettes & créances until paid."""
    if sale.status == "Annulée":
        return
    if sale.payments:
        # Mixed tender: only the credit legs become a receivable.
        credit = sum(
            leg.amount for leg in sale.payments if "crédit" in leg.method.lower()
        )
        if credit <= 0:
            return
        amount = credit
    else:
        if "crédit" not in (sale.payment_method or "").lower():
            return
        amount = sale.total
    db.add(
        Debt(
            kind="creance",
            party=sale.customer.name if sale.customer else "Client de passage",
            customer_id=sale.customer_id,
            sale_id=sale.id,
            reference=sale.reference,
            amount=amount,
            note="Vente à crédit",
            created_by_id=current_user.id,
        )
    )


def _backup_after_sale(db: Session) -> None:
    """A failed copy must never cancel a sale already recorded."""
    try:
        backup.after_sale(db)
    except Exception:  # noqa: BLE001 - unreachable USB key, full disk...
        db.rollback()


@router.post("/{sale_id}/print", response_model=SaleOut)
def register_print(
    sale_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ventes")),
):
    """Count receipt prints so reprints can be flagged as duplicates."""
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    sale.print_count = (sale.print_count or 0) + 1
    db.commit()
    db.refresh(sale)
    return sale_output(sale, db, user)


@router.put("/{sale_id}", response_model=SaleOut)
def update_sale(
    sale_id: int,
    payload: SaleUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("ventes_supprimer")),
):
    """Update editable receipt metadata (customer, payment, note, footer).

    Does not touch the sale items or stock.
    """
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    data = payload.model_dump(exclude_unset=True)
    if "customer_id" in data:
        sale.customer_id = data["customer_id"]
    if "payment_method" in data and data["payment_method"] is not None:
        sale.payment_method = data["payment_method"]
    if "note" in data and data["note"] is not None:
        sale.note = data["note"]
    if "receipt_footer" in data and data["receipt_footer"] is not None:
        sale.receipt_footer = data["receipt_footer"]
    db.commit()
    db.refresh(sale)
    return sale_output(sale, db, user)


@router.delete("/{sale_id}", status_code=204)
def delete_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("ventes_supprimer")),
):
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    # restock if the sale had decremented stock
    if sale.status != "Annulée":
        for item in sale.items:
            if item.product_id:
                product = db.query(Product).get(item.product_id)
                if product:
                    remaining = item.quantity - item.returned_quantity
                    before, after = stock.adjust(db, product, remaining)
                    db.add(
                        StockMovement(
                            depot_id=stock.resolve(db),
                            product_id=product.id,
                            product_name=product.name,
                            kind="ajustement",
                            quantity=remaining,
                            stock_before=before,
                            stock_after=after,
                            reason=f"Annulation {sale.reference}",
                            created_by_id=current_user.id,
                        )
                    )
    db.query(Notification).filter(Notification.sale_id == sale.id).delete()
    db.delete(sale)
    db.commit()
