from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import stock
from ..auth import get_current_user
from ..database import get_db
from ..models import Depot, DepotStock, DepotTransfer, DepotTransferItem, Product, StockLot, StockMovement, User
from ..permissions import has_permission, require_permission
from ..sequences import next_reference

router = APIRouter(prefix="/api/depots", tags=["depots"])


class DepotInput(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=200)
    active: bool = True


class TransferLine(BaseModel):
    product_id: int = Field(ge=1)
    quantity: int = Field(gt=0, le=2147483647, strict=True)


class TransferInput(BaseModel):
    source_depot_id: int = Field(ge=1)
    destination_depot_id: int = Field(ge=1)
    items: list[TransferLine] = Field(min_length=1, max_length=10000)
    note: str = Field(default="", max_length=4000)


def _out(depot):
    return {key: getattr(depot, key) for key in ("id", "code", "name", "is_default", "active", "created_at")}


@router.get("")
def listing(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    stock.resolve(db)
    return [_out(depot) for depot in db.query(Depot).order_by(Depot.is_default.desc(), Depot.name)]


@router.post("", status_code=201)
def create(payload: DepotInput, db: Session = Depends(get_db), _: User = Depends(require_permission("depots_gerer"))):
    if not payload.name.strip():
        raise HTTPException(400, "Nom requis")
    depot = Depot(**(payload.model_dump() | {"code": payload.code.upper(), "name": payload.name.strip()}))
    db.add(depot)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Code de dépôt déjà utilisé")
    return _out(depot)


@router.put("/{depot_id}")
def edit(depot_id: int, payload: DepotInput, db: Session = Depends(get_db), _: User = Depends(require_permission("depots_gerer"))):
    depot = db.get(Depot, stock.resolve(db, depot_id, active=False))
    if not payload.name.strip():
        raise HTTPException(400, "Nom requis")
    if not payload.active and (depot.is_default or db.query(DepotStock.id).filter(DepotStock.depot_id == depot_id, DepotStock.quantity != 0).first()):
        raise HTTPException(400, "Le dépôt principal ou un dépôt contenant du stock ne peut pas être désactivé")
    depot.code, depot.name, depot.active = payload.code.upper(), payload.name.strip(), payload.active
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Code de dépôt déjà utilisé")
    return _out(depot)


@router.get("/consistency")
def consistency(db: Session = Depends(get_db), _: User = Depends(require_permission("depots_gerer"))):
    errors = stock.inconsistencies(db)
    return {"ok": not errors, "errors": errors}


@router.get("/stocks/{product_id}")
def stocks(product_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not (has_permission(db, user, "produits") or has_permission(db, user, "inventaire")):
        raise HTTPException(403, "Consultation du stock refusée")
    if not db.get(Product, product_id):
        raise HTTPException(404, "Article introuvable")
    return [{"depot_id": depot.id, "name": depot.name, "is_default": depot.is_default, "quantity": stock.quantity(db, product_id, depot.id)} for depot in db.query(Depot).order_by(Depot.name)]


@router.get("/options")
def options(db: Session = Depends(get_db), _: User = Depends(require_permission("depots_transferer"))):
    return [{"id": product.id, "name": product.name, "sku": product.sku} for product in db.query(Product).order_by(Product.name)]


def _transfer_out(transfer):
    return {key: getattr(transfer, key) for key in ("id", "reference", "source_depot_id", "destination_depot_id", "created_at", "created_by_id", "note")} | {
        "items": [{key: getattr(item, key) for key in ("product_id", "product_name", "quantity")} for item in transfer.items]}


@router.get("/transfers")
def transfers(db: Session = Depends(get_db), _: User = Depends(require_permission("depots_transferer"))):
    return [_transfer_out(row) for row in db.query(DepotTransfer).order_by(DepotTransfer.id.desc())]


def _move_lots(db, product, amount, source, destination, user, deficit=0):
    default = stock.resolve(db)
    lots = db.query(StockLot).filter(StockLot.product_id == product.id, StockLot.quantity > 0,
        (StockLot.depot_id == source) | (StockLot.depot_id.is_(None) & (source == default))).order_by(StockLot.expiry_date.is_(None), StockLot.expiry_date, StockLot.id).all()
    for lot in lots:
        moved = min(amount, lot.quantity)
        if not moved:
            break
        lot.quantity -= moved
        absorbed = min(deficit, moved)
        deficit -= absorbed
        if moved > absorbed:
            db.add(StockLot(product_id=product.id, depot_id=destination, lot_number=lot.lot_number, expiry_date=lot.expiry_date, quantity=moved - absorbed, created_by_id=user.id))
        amount -= moved


@router.post("/transfers", status_code=201)
def transfer(payload: TransferInput, db: Session = Depends(get_db), user: User = Depends(require_permission("depots_transferer"))):
    try:
        source, destination = stock.resolve(db, payload.source_depot_id), stock.resolve(db, payload.destination_depot_id)
        if source == destination:
            raise HTTPException(400, "Choisissez deux dépôts différents")
        if len({item.product_id for item in payload.items}) != len(payload.items):
            raise HTTPException(400, "Article répété")
        document = DepotTransfer(reference=next_reference(db, DepotTransfer.reference, f"DEP-{datetime.now(timezone.utc).year}-"), source_depot_id=source,
            destination_depot_id=destination, note=payload.note, created_by_id=user.id)
        db.add(document)
        for line in sorted(payload.items, key=lambda item: item.product_id):
            product = db.get(Product, line.product_id)
            if not product:
                raise HTTPException(404, "Article introuvable")
            for depot_id, delta in ((source, -line.quantity), (destination, line.quantity)):
                before, after = stock.adjust(db, product, delta, depot_id, allow_negative=depot_id == destination)
                db.add(StockMovement(depot_id=depot_id, product_id=product.id, product_name=product.name, kind="transfert_depot", quantity=delta,
                    stock_before=before, stock_after=after, reason=document.reference, created_by_id=user.id))
            _move_lots(db, product, line.quantity, source, destination, user, max(0, -before))
            document.items.append(DepotTransferItem(product_id=product.id, product_name=product.name, quantity=line.quantity))
        db.commit()
        return _transfer_out(document)
    except Exception:
        db.rollback()
        raise
