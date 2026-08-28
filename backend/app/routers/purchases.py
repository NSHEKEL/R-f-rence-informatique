"""Supply orders (approvisionnement): buying goods from suppliers.

A supply order changes nothing until the goods arrive: receiving it — fully or
partially — increases the stock, records the movements and, on request,
refreshes the purchase price used by the margin reports.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Notification,
    Product,
    Purchase,
    PurchaseItem,
    StockMovement,
    Supplier,
    User,
)
from ..permissions import require_permission
from ..schemas import (
    PurchaseCreate,
    PurchaseOut,
    PurchaseReceive,
    PurchaseSummary,
    PurchaseUpdate,
)
from ..sequences import next_reference

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
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        cost = (
            item.unit_cost
            if item.unit_cost is not None and item.unit_cost > 0
            else (product.purchase_price or 0)
        )
        subtotal = cost * item.quantity
        total += subtotal
        purchase.items.append(
            PurchaseItem(
                product_id=product.id,
                product_name=product.name,
                quantity=item.quantity,
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
    _: User = Depends(require_permission("approvisionnements_gerer")),
):
    purchase = _get(db, purchase_id)
    if any((item.received_quantity or 0) > 0 for item in purchase.items):
        raise HTTPException(
            status_code=400,
            detail=(
                "Un approvisionnement déjà reçu ne peut pas être supprimé : "
                "annulez-le à la place"
            ),
        )
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

    wanted = {entry.item_id: entry.quantity for entry in payload.items}
    moved = 0
    for item in purchase.items:
        remaining = (item.quantity or 0) - (item.received_quantity or 0)
        quantity = wanted.get(item.id, remaining) if wanted else remaining
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
        before = product.quantity or 0
        product.quantity = before + quantity
        if payload.update_cost and (item.unit_cost or 0) > 0:
            product.purchase_price = item.unit_cost
        item.received_quantity = (item.received_quantity or 0) + quantity
        moved += quantity
        db.add(
            StockMovement(
                product_id=product.id,
                product_name=product.name,
                kind="approvisionnement",
                quantity=quantity,
                stock_before=before,
                stock_after=product.quantity,
                reason=f"Approvisionnement {purchase.reference}",
                created_by_id=current_user.id,
            )
        )

    if moved == 0:
        raise HTTPException(status_code=400, detail="Aucune quantité à réceptionner")

    complete = all(
        (item.received_quantity or 0) >= (item.quantity or 0)
        for item in purchase.items
    )
    purchase.status = "Reçu" if complete else "Reçu partiellement"
    purchase.received_at = datetime.now(timezone.utc)
    if payload.note:
        purchase.note = payload.note
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


@router.post("/{purchase_id}/cancel", response_model=PurchaseOut)
def cancel_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("approvisionnements_gerer")),
):
    purchase = _get(db, purchase_id)
    if purchase.status == "Reçu":
        raise HTTPException(
            status_code=400,
            detail="Un approvisionnement entièrement reçu ne s'annule pas",
        )
    purchase.status = "Annulé"
    db.commit()
    db.refresh(purchase)
    return purchase
