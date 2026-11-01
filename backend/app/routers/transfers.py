from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Product,
    StockMovement,
    StockTransfer,
    StockTransferItem,
    User,
)
from ..permissions import require_permission
from ..schemas import StockTransferCreate, StockTransferOut
from ..sequences import next_reference

router = APIRouter(prefix="/api/transfers", tags=["transfers"])

DIRECTIONS = ("sortie", "entree")


def _reference(db: Session) -> str:
    return next_reference(
        db,
        StockTransfer.reference,
        f"TFR-{datetime.now(timezone.utc).year}-",
    )


@router.get("", response_model=list[StockTransferOut])
def list_transfers(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("stocks")),
):
    return (
        db.query(StockTransfer)
        .order_by(StockTransfer.created_at.desc())
        .limit(200)
        .all()
    )


@router.post("", response_model=StockTransferOut, status_code=201)
def create_transfer(
    payload: StockTransferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stocks")),
):
    """Record an inter-store transfer and move the stock in one shot.

    'sortie' removes stock (guard: never below zero, same conditional update
    as the till); 'entree' adds it. Both write 'transfert' movements so the
    history explains the change.
    """
    if payload.direction not in DIRECTIONS:
        raise HTTPException(status_code=400, detail="Direction invalide")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Aucune ligne")
    store = payload.store_name.strip()
    if not store:
        raise HTTPException(status_code=400, detail="Magasin requis")

    leaving = payload.direction == "sortie"
    transfer = StockTransfer(
        reference=_reference(db),
        direction=payload.direction,
        store_name=store,
        note=payload.note.strip(),
        created_by_id=current_user.id,
    )
    arrow = "→" if leaving else "←"
    for line in payload.items:
        if line.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        product = db.query(Product).get(line.product_id)
        if not product:
            raise HTTPException(
                status_code=404,
                detail=f"Produit {line.product_id} introuvable",
            )
        before = product.quantity
        if leaving:
            result = db.execute(
                update(Product)
                .where(
                    Product.id == product.id,
                    Product.quantity >= line.quantity,
                )
                .values(quantity=Product.quantity - line.quantity)
            )
            if result.rowcount == 0:
                db.rollback()
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuffisant pour {product.name}",
                )
            db.refresh(product)
        else:
            product.quantity += line.quantity
        db.add(
            StockMovement(
                product_id=product.id,
                product_name=product.name,
                kind="transfert",
                quantity=-line.quantity if leaving else line.quantity,
                stock_before=before,
                stock_after=product.quantity,
                reason=f"Transfert {arrow} {store} ({transfer.reference})",
                created_by_id=current_user.id,
            )
        )
        transfer.items.append(
            StockTransferItem(
                product_id=product.id,
                product_name=product.name,
                quantity=line.quantity,
            )
        )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    return transfer
