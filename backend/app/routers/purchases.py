"""Supply orders (approvisionnement): buying goods from suppliers.

A supply order changes nothing until the goods arrive: receiving it — fully or
partially — increases the stock, records the movements and, on request,
refreshes the purchase price used by the margin reports.
"""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..database import get_db
from ..catalogue import require_active
from ..purchase_prices import apply_changes, remove_purchase_changes, review
from .. import stock
from ..models import (
    Debt,
    Notification,
    PriceHistory,
    Product,
    ProductPackaging,
    Purchase,
    PurchaseItem,
    StockMovement,
    StockLot,
    SecurityLog,
    Supplier,
    User,
)
from ..permissions import has_permission, require_permission
from ..receivables import open_purchase_payable
from ..purchase_links import mentions_purchase, same_supplier
from ..accounting_ledger import derive
from ..schemas import (
    PurchaseCreate,
    CataloguePriceChange,
    PurchaseOut,
    PurchaseReceive,
    PurchaseSummary,
    PurchaseUpdate,
)
from ..sequences import next_reference
from ..units import base_quantity, snapshot, selected_packaging

router = APIRouter(prefix="/api/purchases", tags=["purchases"])

OPEN_STATUSES = ("En attente", "Reçu partiellement")


def _reference(db: Session) -> str:
    return next_reference(
        db, Purchase.reference, f"APP-{datetime.now(timezone.utc).year}-"
    )


def _get(db: Session, purchase_id: int) -> Purchase:
    purchase = db.query(Purchase).get(purchase_id)
    if not purchase:
        raise HTTPException(
            status_code=404, detail="Approvisionnement introuvable"
        )
    return purchase


def _fill_items(db: Session, purchase: Purchase, payload) -> None:
    purchase.items.clear()
    total = 0.0
    for item in payload.items:
        product = db.query(Product).get(item.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Produit {item.product_id} introuvable"
            )
        require_active(product)
        spec = selected_packaging(db, product, item.packaging_id)
        quantity = base_quantity(item, spec)
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        cost = (
            item.unit_cost
            if item.unit_cost is not None and item.unit_cost > 0
            else (product.purchase_price or 0)
        )
        if item.packaging_unit_cost is not None:
            if not spec.packaging_unit:
                raise HTTPException(status_code=400, detail="Conditionnement absent")
            cost = item.packaging_unit_cost / spec.units_per_packaging
        elif item.unit_cost is None and getattr(spec, "packaging_purchase_price", None) is not None:
            cost = spec.packaging_purchase_price / spec.units_per_packaging
        subtotal = cost * quantity
        total += subtotal
        purchase.items.append(
            PurchaseItem(
                packaging_id=item.packaging_id,
                **snapshot(spec),
                product_id=product.id,
                product_name=product.name,
                quantity=quantity,
                unit_cost=cost,
                subtotal=subtotal,
            )
        )
    purchase.total = total


@router.get("", response_model=list[PurchaseOut])
def list_purchases(
    status: str | None = None,
    supplier_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("approvisionnements")),
):
    query = db.query(Purchase)
    if status:
        query = query.filter(Purchase.status == status)
    if supplier_id:
        query = query.filter(Purchase.supplier_id == supplier_id)
    return query.order_by(Purchase.date.desc()).all()


@router.get("/summary", response_model=PurchaseSummary)
def summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("approvisionnements")),
):
    purchases = db.query(Purchase).filter(Purchase.status != "Annulé").all()
    return PurchaseSummary(
        count=len(purchases),
        pending=sum(1 for p in purchases if p.status in OPEN_STATUSES),
        total=sum(p.total or 0 for p in purchases),
        unpaid=sum(p.balance for p in purchases),
    )


@router.get("/{purchase_id}", response_model=PurchaseOut)
def get_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("approvisionnements")),
):
    return _get(db, purchase_id)


@router.post("", response_model=PurchaseOut, status_code=201)
def create_purchase(
    payload: PurchaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("approvisionnements_gerer")),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins un article")
    supplier_name = payload.supplier_name.strip()
    if payload.supplier_id:
        supplier = db.query(Supplier).get(payload.supplier_id)
        if not supplier:
            raise HTTPException(status_code=404, detail="Fournisseur introuvable")
        supplier_name = supplier.name
    if not supplier_name:
        raise HTTPException(status_code=400, detail="Indiquez le fournisseur")

    purchase = Purchase(
        payment_method=payload.payment_method,
        bank_account_id=payload.bank_account_id,
        reference=_reference(db),
        supplier_id=payload.supplier_id,
        supplier_name=supplier_name,
        expected_date=payload.expected_date,
        paid=payload.paid,
        invoice_number=payload.invoice_number,
        note=payload.note,
        created_by_id=current_user.id,
    )
    _fill_items(db, purchase, payload)
    db.add(purchase)
    db.commit()
    db.refresh(purchase)
    return purchase


@router.put("/{purchase_id}", response_model=PurchaseOut)
def update_purchase(
    purchase_id: int,
    payload: PurchaseUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("approvisionnements_gerer")),
):
    purchase = _get(db, purchase_id)
    data = payload.model_dump(exclude_unset=True)
    financial_change = payload.items is not None or any(
        field in data and data[field] is not None and data[field] != getattr(purchase, field)
        for field in ("supplier_id", "supplier_name", "paid", "status")
    )
    if financial_change and db.query(Debt.id).filter_by(purchase_id=purchase.id).first():
        raise HTTPException(409, "Achat lié à une dette : fournisseur, montant et origine conservés ; utilisez la réception pour recevoir le stock")
    if (
        purchase.status == "Reçu"
        and data.get("paid") is not None
        and float(data["paid"]) != float(purchase.paid or 0)
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Approvisionnement reçu : le reste à payer se règle "
                "dans Dettes & créances"
            ),
        )
    if payload.items is not None and purchase.status != "En attente":
        raise HTTPException(
            status_code=400,
            detail="Les articles d'un approvisionnement reçu ne changent plus",
        )
    for field in (
        "supplier_id",
        "supplier_name",
        "expected_date",
        "paid",
        "invoice_number",
        "note",
        "status",
    ):
        if field in data and data[field] is not None:
            setattr(purchase, field, data[field])
    if payload.items is not None:
        _fill_items(db, purchase, payload)
    db.commit()
    db.refresh(purchase)
    return purchase


@router.delete("/{purchase_id}", status_code=204)
def delete_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("approvisionnements_gerer")),
):
    purchase = db.query(Purchase).filter_by(id=purchase_id).with_for_update().first()
    if purchase is None:
        raise HTTPException(404, "Approvisionnement introuvable")
    debts = db.query(Debt).filter_by(purchase_id=purchase.id).all()
    orphans = db.query(Debt).filter_by(purchase_id=None, kind="dette").all()
    matching = [debt for debt in orphans if same_supplier(debt, purchase, allow_name=True) and mentions_purchase(debt, purchase)]
    if matching:
        if len(matching) != 1 or debts:
            raise HTTPException(409, "Origine des dettes ambiguë : sélectionnez explicitement l'achat via Rapprocher avant suppression")
        orphan = db.query(Debt).filter_by(id=matching[0].id, purchase_id=None).populate_existing().with_for_update().first()
        origins = [other.id for other in db.query(Purchase).all()
            if orphan is not None and same_supplier(orphan, other, allow_name=True) and mentions_purchase(orphan, other)]
        if (orphan is None or not same_supplier(orphan, purchase, allow_name=True)
                or abs(orphan.amount - purchase.balance) > 0.009 or origins != [purchase.id]):
            raise HTTPException(409, "Origine ou montant de la dette à confirmer via Rapprocher avant suppression")
        debts = [orphan]
    cancelled_without_active_payments = purchase.status == "Annulé" and not any(
        not payment.cancelled for debt in debts for payment in debt.payments
    )
    if purchase.paid or (any(debt.payments for debt in debts) and not cancelled_without_active_payments):
        raise HTTPException(409, "Historique de règlements (actifs ou annulés) conservé : suppression refusée pour cet achat. Conservez l'achat et ses reçus ; annulez les règlements erronés avec motif dans Dettes, puis faites valider la régularisation comptable et de stock par un administrateur. Annuler un paiement ne permet pas d'effacer son achat.")
    entries, missing, _ = derive(db)
    accounting_snapshot = [row for row in entries + missing if row["source_type"] == "purchase" and row["source_id"] == purchase.id]
    source_snapshot = {"purchase": {col.name: getattr(purchase, col.name) for col in Purchase.__table__.columns},
        "items": [{col.name: getattr(item, col.name) for col in PurchaseItem.__table__.columns} for item in purchase.items],
        "debts": [{col.name: getattr(debt, col.name) for col in Debt.__table__.columns} for debt in debts],
        "payments": [{col.name: getattr(payment, col.name) for col in payment.__table__.columns}
            for debt in debts for payment in debt.payments]}
    movements = db.query(StockMovement).filter_by(kind="approvisionnement", reason=f"Approvisionnement {purchase.reference}").all()
    quantities = {}
    for movement in movements:
        key = (movement.product_id, movement.depot_id)
        quantities[key] = quantities.get(key, 0) + movement.quantity
    received = sum(item.received_quantity or 0 for item in purchase.items)
    if sum(quantities.values()) != received:
        raise HTTPException(409, "Historique de réception incomplet : rapprochez les mouvements de cet approvisionnement avant suppression")
    for (product_id, depot_id), quantity in sorted(quantities.items(), key=lambda entry: (entry[0][0] or 0, entry[0][1] or 0)):
        product = db.get(Product, product_id)
        if product is None:
            raise HTTPException(409, "Article reçu introuvable : régularisez le stock avant suppression")
        before, after = stock.adjust(db, product, -quantity, depot_id, allow_negative=False, check_total=True)
        lots = db.query(StockLot).filter(StockLot.product_id == product_id,
            or_(StockLot.depot_id == stock.resolve(db, depot_id), StockLot.depot_id.is_(None))).all()
        if sum(lot.quantity for lot in lots) > after:
            raise HTTPException(409, "Stock déjà consommé ou affecté à des lots : régularisez les quantités non loties avant suppression (aucun lot étranger n'est supprimé)")
        db.add(StockMovement(depot_id=stock.resolve(db, depot_id), product_id=product.id, product_name=product.name,
            kind="annulation approvisionnement", quantity=-quantity, stock_before=before, stock_after=after,
            reason=f"Suppression {purchase.reference}", created_by_id=current_user.id))
    price_history = remove_purchase_changes(db, purchase)
    preserved_debts = []
    for debt in debts:
        if debt.payments:
            preserved_debts.append(debt.id)
            debt.purchase_id = None
            debt.purchase = None
        else:
            db.delete(debt)
    db.add(SecurityLog(event="suppression_approvisionnement", user_id=current_user.id, identifier=current_user.email,
        success=True, detail=json.dumps({"reference": purchase.reference, "id": purchase.id, "total": purchase.total,
            "received_quantity": received, "preserved_debts": preserved_debts,
            "deleted_orphan_debts": [debt.id for debt in debts if debt.purchase_id is None and debt.id not in preserved_debts],
            "reversed_prices": price_history["restored"], "price_history": price_history, "sources": source_snapshot,
            "accounting_snapshot": accounting_snapshot}, ensure_ascii=False, default=str)))
    db.delete(purchase)
    db.commit()


@router.post("/{purchase_id}/receive", response_model=PurchaseOut)
def receive_purchase(
    purchase_id: int,
    payload: PurchaseReceive,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("approvisionnements_gerer")),
):
    """Put the delivered goods in stock, fully or line by line."""
    purchase = _get(db, purchase_id)
    if purchase.status not in OPEN_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Approvisionnement « {purchase.status} » : réception impossible",
        )

    wanted = {entry.item_id: entry for entry in payload.items}
    if len(wanted) != len(payload.items) or set(wanted) - {item.id for item in purchase.items}:
        raise HTTPException(400, "Ligne de réception inconnue ou dupliquée")
    changes = list(payload.price_changes)
    legacy_costs = {}
    update_cost = payload.update_cost and has_permission(db, current_user, "tarifs_modifier")
    received_ids = set()
    moved = 0
    for item in purchase.items:
        remaining = (item.quantity or 0) - (item.received_quantity or 0)
        entry = wanted.get(item.id)
        quantity = base_quantity(entry, item) if entry else (0 if wanted else remaining)
        if quantity <= 0:
            continue
        if quantity > remaining:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{item.product_name} : {quantity} reçus pour "
                    f"{remaining} attendus"
                ),
            )
        product = db.query(Product).get(item.product_id) if item.product_id else None
        if product is None:
            raise HTTPException(
                status_code=400,
                detail=f"L'article « {item.product_name} » n'existe plus",
            )
        depot_id = stock.resolve(db)
        before, after = stock.adjust(db, product, quantity, depot_id)
        received_ids.add(product.id)
        if update_cost and (item.unit_cost or 0) > 0 and not any(change.product_id == product.id and change.packaging_id is None and change.field == "purchase_price" for change in changes):
            legacy_costs[product.id] = CataloguePriceChange(product_id=product.id, field="purchase_price", old_value=product.purchase_price, new_value=item.unit_cost)
        item.received_quantity = (item.received_quantity or 0) + quantity
        moved += quantity
        db.add(
            StockMovement(
                depot_id=depot_id,
                **snapshot(item),
                product_id=product.id,
                product_name=product.name,
                kind="approvisionnement",
                quantity=quantity,
                stock_before=before,
                stock_after=after,
                reason=f"Approvisionnement {purchase.reference}",
                created_by_id=current_user.id,
            )
        )

    if moved == 0:
        raise HTTPException(status_code=400, detail="Aucune quantité à réceptionner")
    apply_changes(db, purchase, changes + list(legacy_costs.values()), received_ids, current_user)

    complete = all(
        (item.received_quantity or 0) >= (item.quantity or 0)
        for item in purchase.items
    )
    purchase.status = "Reçu" if complete else "Reçu partiellement"
    purchase.received_at = datetime.now(timezone.utc)
    if payload.note:
        purchase.note = payload.note
    if complete:
        open_purchase_payable(db, purchase, current_user)
    db.add(
        Notification(
            kind="approvisionnement",
            title=f"Stock reçu — {purchase.reference}",
            message=f"{purchase.supplier_name} — {moved} article(s) en stock",
            link="/approvisionnements",
        )
    )
    db.commit()
    db.refresh(purchase)
    return purchase


@router.get("/{purchase_id}/price-review")
def price_review(purchase_id: int, db: Session = Depends(get_db),
    _: User = Depends(require_permission("approvisionnements_gerer"))):
    return review(db, _get(db, purchase_id))


@router.post("/{purchase_id}/cancel", response_model=PurchaseOut)
def cancel_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("approvisionnements_gerer")),
):
    purchase = _get(db, purchase_id)
    if purchase.status == "Reçu":
        raise HTTPException(
            status_code=400,
            detail="Un approvisionnement entièrement reçu ne s'annule pas",
        )
    debts = db.query(Debt).filter_by(purchase_id=purchase.id).with_for_update().all()
    if debts and (purchase.paid or any(debt.payments for debt in debts)
                  or any(item.received_quantity for item in purchase.items)):
        raise HTTPException(409, "Achat lié avec réception ou historique de règlements : annulation refusée pour conserver l'origine comptable. Conservez l'achat et ses reçus ; régularisation administrateur requise.")
    for debt in debts:
        debt.purchase_id = None
    if debts:
        db.add(SecurityLog(event="annulation_approvisionnement", user_id=user.id, identifier=user.email,
            success=True, detail=json.dumps({"id": purchase.id, "reference": purchase.reference,
                "unlinked_debts": [debt.id for debt in debts]}, ensure_ascii=False)))
    purchase.status = "Annulé"
    db.commit()
    db.refresh(purchase)
    return purchase
