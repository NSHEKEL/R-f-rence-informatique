from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Depot, Notification, Product, StockMovement, User
from ..permissions import require_permission
from ..schemas import InventoryApply, StockMovementOut
from ..units import base_quantity
from .. import stock
from .inventory_sessions import router as sessions_router

router = APIRouter(prefix="/api/inventory", tags=["inventory"])
router.include_router(sessions_router)


def movement_query(
    product_id: int | None = None, kind: str = "", user_id: int | None = None, search: str = "",
    depot_id: int | None = None, direction: Literal["", "entree", "sortie"] = "",
    period: Literal["all", "today", "7d", "month", "previous", "custom"] = "all",
    date_from: date | None = None, date_to: date | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(StockMovement)
    if search.strip():
        query = query.filter(StockMovement.product_name.ilike(f"%{search.strip()}%"))
    for column, value in ((StockMovement.product_id, product_id), (StockMovement.kind, kind or None),
                          (StockMovement.created_by_id, user_id), (StockMovement.depot_id, depot_id)):
        if value is not None:
            query = query.filter(column == value)
    if direction:
        query = query.filter(StockMovement.quantity > 0 if direction == "entree" else StockMovement.quantity < 0)
    today = datetime.now().date()
    start, end = date_from, date_to
    if period == "today":
        start = end = today
    elif period == "7d":
        start, end = today - timedelta(days=6), today
    elif period == "month":
        start, end = today.replace(day=1), today
    elif period == "previous":
        end = today.replace(day=1) - timedelta(days=1)
        start = end.replace(day=1)
    if period == "custom" and not (start or end):
        raise HTTPException(400, "Choisissez au moins une date")
    if start and end and start > end:
        raise HTTPException(400, "Période inversée")
    if start:
        query = query.filter(StockMovement.date >= datetime.combine(start, time.min))
    if end:
        query = query.filter(StockMovement.date <= datetime.combine(end, time.max))
    return query


@router.get("/movements/page")
def movement_page(
    page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
    sort: Literal["recent", "oldest"] = "recent", query=Depends(movement_query),
    _: User = Depends(require_permission("inventaire")),
):
    total = query.count()
    columns = (StockMovement.date, StockMovement.id)
    rows = query.order_by(*(column.desc() if sort == "recent" else column.asc() for column in columns)).offset((page - 1) * page_size).limit(page_size).all()
    return {"items": [StockMovementOut.model_validate(row).model_dump() for row in rows],
            "total": total, "page": page, "page_size": page_size}


@router.get("/movements/filters")
def movement_options(db: Session = Depends(get_db), _: User = Depends(require_permission("inventaire"))):
    return {"products": [{"id": row.product_id, "name": row.name} for row in db.query(StockMovement.product_id, func.max(StockMovement.product_name).label("name")).filter(StockMovement.product_id.isnot(None)).group_by(StockMovement.product_id).order_by("name")],
            "kinds": [row[0] for row in db.query(StockMovement.kind).filter(StockMovement.kind.isnot(None)).distinct().order_by(StockMovement.kind)],
            "users": [{"id": row.id, "name": row.name} for row in db.query(User.id, User.name).join(StockMovement, StockMovement.created_by_id == User.id).distinct().order_by(User.name)],
            "depots": [{"id": row.id, "name": row.name} for row in db.query(Depot).order_by(Depot.name)]}


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
        line = line.model_copy(update={"counted_quantity": base_quantity(line, product, "counted_quantity")})
        if line.counted_quantity < 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        before, after = stock.set_total(db, product, line.counted_quantity)
        delta = after - before
        if delta == 0:
            continue
        movement = StockMovement(
            depot_id=stock.resolve(db),
            product_id=product.id,
            product_name=product.name,
            kind="inventaire",
            quantity=delta,
            stock_before=before,
            stock_after=after,
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
