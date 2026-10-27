from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Notification, Product, StockMovement, User
from ..permissions import require_permission
from ..schemas import InventoryApply, StockMovementOut

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/movements", response_model=list[StockMovementOut])
def list_movements(
    limit: int = 100,
    product_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("inventaire")),
):
    query = db.query(StockMovement)
    if product_id is not None:
        query = query.filter(StockMovement.product_id == product_id)
    return query.order_by(StockMovement.date.desc()).limit(limit).all()


@router.post("/apply", response_model=list[StockMovementOut])
def apply_inventory(
    payload: InventoryApply,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("inventaire_appliquer")),
):
    """Align stock with a physical count, recording every adjustment."""
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Aucune ligne à appliquer")

    movements: list[StockMovement] = []
    for line in payload.lines:
        product = db.query(Product).get(line.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Produit {line.product_id} introuvable"
            )
        if line.counted_quantity < 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        before = product.quantity
        delta = line.counted_quantity - before
        if delta == 0:
            continue
        product.quantity = line.counted_quantity
        movement = StockMovement(
            product_id=product.id,
            product_name=product.name,
            kind="inventaire",
            quantity=delta,
            stock_before=before,
            stock_after=line.counted_quantity,
            reason=payload.note or "Inventaire physique",
            created_by_id=current_user.id,
        )
        db.add(movement)
        movements.append(movement)

    if movements:
        db.add(
            Notification(
                kind="stock",
                title="Inventaire appliqué",
                message=(
                    f"{current_user.name} a ajusté {len(movements)} "
                    f"produit(s) après inventaire"
                ),
                link="/inventaire",
            )
        )
    db.commit()
    for movement in movements:
        db.refresh(movement)
    return movements
