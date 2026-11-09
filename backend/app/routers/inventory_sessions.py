import json
from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, InventoryCount, InventorySession, Product, StockMovement, User
from ..permissions import has_permission, require_permission
from ..sequences import next_reference

router = APIRouter(prefix="/sessions", tags=["inventory"])
OPEN = ("draft", "in_progress")


class SessionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scope_type: Literal["general", "category", "rayon", "emplacement", "selection"] = "general"
    scope: dict = Field(default_factory=dict)
    blind: bool = False
    note: str = Field(default="", max_length=4000)


class CountInput(BaseModel):
    physical_qty: int | None = Field(default=None, ge=0, le=2147483647, strict=True)
    packaging_quantity: int | None = Field(default=None, ge=0, le=1000000, strict=True)
    piece_quantity: int = Field(default=0, ge=0, le=2147483647, strict=True)
    packaging_id: int | None = None
    note: str = Field(default="", max_length=4000)


class ScanInput(BaseModel):
    code: str = Field(min_length=1, max_length=200)


def _session(db, session_id):
    result = db.get(InventorySession, session_id)
    if result is None:
        raise HTTPException(404, "Session introuvable")
    return result


def _editable(db, session_id):
    locked = db.execute(update(InventorySession).where(InventorySession.id == session_id, InventorySession.status.in_(OPEN)).values(status=InventorySession.status)).rowcount
    if not locked:
        _session(db, session_id)
        raise HTTPException(409, "Session clôturée : modification impossible")
    return db.get(InventorySession, session_id, populate_existing=True)


def _counts(db, session_id):
    return db.query(InventoryCount).filter_by(session_id=session_id).order_by(InventoryCount.id).all()


def _snapshot(product):
    return json.dumps({"name": product.name, "sku": product.sku, "barcode": product.barcode, "qr_code": product.qr_code,
        "rayon": product.rayon, "emplacement": product.emplacement, "base_unit": product.base_unit or "pièce",
        "packaging_unit": product.packaging_unit or "", "units_per_packaging": product.units_per_packaging or 1,
        "packagings": [{"id": p.id, "name": p.name, "factor": p.factor, "barcode": p.barcode} for p in product.packagings if p.active]})


def _start(db, session):
    if session.status != "draft":
        return
    rows = _counts(db, session.id)
    products = {product.id: product for product in db.query(Product).filter(Product.id.in_([row.product_id for row in rows])).order_by(Product.id).with_for_update().all()}
    for row in rows:
        product = products.get(row.product_id)
        if product is None:
            raise HTTPException(409, "Un article de cette session n'existe plus")
        row.theoretical_qty = product.quantity
        row.unit_cost = product.purchase_price or 0
        row.product_snapshot = _snapshot(product)
    session.status = "in_progress"
    db.flush()


def _header(session):
    return {key: getattr(session, key) for key in ("id", "reference", "name", "scope_type", "blind", "status", "created_by_id", "created_by_name", "created_at", "validated_by_id", "validated_by_name", "validated_at", "note")} | {"scope": json.loads(session.scope_json)}


def _report(db, session, user):
    visible = not session.blind or has_permission(db, user, "inventaire_voir_theorique")
    rows = []
    stats = {"counted": 0, "not_counted": 0}
    if visible:
        stats.update(conforme=0, manquant=0, excedent=0, variance_value=0, theoretical_value=0, physical_value=0, stock_after_value=0)
    for count in _counts(db, session.id):
        row = json.loads(count.product_snapshot) | {"product_id": count.product_id, "physical_qty": count.physical_qty, "counted_by_id": count.counted_by_id, "counted_at": count.counted_at, "note": count.note}
        counted = count.physical_qty is not None
        stats["counted" if counted else "not_counted"] += 1
        row["status"] = "compté" if counted else "non compté"
        if visible:
            delta = count.physical_qty - count.theoretical_qty if counted else None
            status = "non compté" if not counted else "conforme" if delta == 0 else "manquant" if delta < 0 else "excedent"
            row.update(theoretical_qty=count.theoretical_qty, unit_cost=count.unit_cost, variance=delta, theoretical_value=count.theoretical_qty * count.unit_cost,
                physical_value=count.physical_qty * count.unit_cost if counted else None, variance_value=delta * count.unit_cost if counted else None, status=status)
            if counted:
                stats[status] += 1
                stats["variance_value"] += row["variance_value"]
                stats["physical_value"] += row["physical_value"]
            stats["theoretical_value"] += row["theoretical_value"]
            product = db.get(Product, count.product_id)
            projected = (product.quantity if product else count.theoretical_qty) + (delta or 0)
            row["stock_after_qty"] = count.stock_after if count.stock_after is not None else projected
            stats["stock_after_value"] += row["stock_after_qty"] * count.unit_cost
        rows.append(row)
    return _header(session) | {"theoretical_visible": visible, "rows": rows, "stats": stats}


@router.get("/options")
def options(db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    return {"products": [{"id": product.id, "name": product.name, "sku": product.sku, "category_id": product.category_id, "rayon": product.rayon, "emplacement": product.emplacement} for product in db.query(Product).order_by(Product.name).all()],
        "categories": [{"id": category.id, "name": category.name} for category in db.query(Category).order_by(Category.name).all()]}


@router.get("")
def history(status: str | None = None, scope_type: str | None = None, q: str = "", start: date | None = None, end: date | None = None, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    query = db.query(InventorySession)
    if status:
        query = query.filter(InventorySession.status == status)
    if scope_type:
        query = query.filter(InventorySession.scope_type == scope_type)
    if q:
        query = query.filter(or_(InventorySession.reference.contains(q), InventorySession.name.contains(q)))
    if start:
        query = query.filter(InventorySession.created_at >= datetime.combine(start, datetime.min.time()))
    if end:
        query = query.filter(InventorySession.created_at < datetime.combine(end + timedelta(days=1), datetime.min.time()))
    return [_header(row) for row in query.order_by(InventorySession.id.desc()).limit(200).all()]


@router.post("", status_code=201)
def create(payload: SessionCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    if not payload.name.strip():
        raise HTTPException(400, "Nom requis")
    query = db.query(Product)
    scope = payload.scope
    if payload.scope_type == "category":
        value = scope.get("category_id")
        if type(value) is not int or value < 1:
            raise HTTPException(400, "Catégorie requise")
        query = query.filter(Product.category_id == value)
    elif payload.scope_type in ("rayon", "emplacement"):
        value = scope.get(payload.scope_type)
        if not isinstance(value, str) or not value.strip():
            raise HTTPException(400, "Localisation requise")
        query = query.filter(getattr(Product, payload.scope_type) == value.strip())
    elif payload.scope_type == "selection":
        ids = scope.get("product_ids")
        if not isinstance(ids, list) or not ids or len(ids) > 10000 or any(type(x) is not int or x < 1 for x in ids):
            raise HTTPException(400, "Sélection invalide")
        query = query.filter(Product.id.in_(ids))
    products = query.order_by(Product.id).all()
    if not products or payload.scope_type == "selection" and len(products) != len(set(scope["product_ids"])):
        raise HTTPException(400, "Périmètre vide ou articles introuvables")
    session = InventorySession(reference=next_reference(db, InventorySession.reference, f"INV-{datetime.now(timezone.utc).year}-"), name=payload.name.strip(), scope_type=payload.scope_type,
        scope_json=json.dumps(scope), blind=payload.blind, created_by_id=user.id, created_by_name=user.name, note=payload.note)
    db.add(session)
    db.flush()
    for product in products:
        db.add(InventoryCount(session_id=session.id, product_id=product.id, theoretical_qty=product.quantity, unit_cost=product.purchase_price or 0, product_snapshot=_snapshot(product)))
    db.commit()
    return _report(db, session, user)


@router.get("/{session_id}")
@router.get("/{session_id}/report")
def report(session_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    return _report(db, _session(db, session_id), user)


@router.post("/{session_id}/start")
def start(session_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    session = _editable(db, session_id)
    _start(db, session)
    db.commit()
    return _report(db, session, user)


@router.put("/{session_id}/counts/{product_id}")
def count(session_id: int, product_id: int, payload: CountInput, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    session = _editable(db, session_id)
    _start(db, session)
    row = db.query(InventoryCount).filter_by(session_id=session_id, product_id=product_id).first()
    if row is None:
        raise HTTPException(404, "Article hors périmètre")
    physical = payload.physical_qty
    if payload.packaging_quantity is not None:
        snapshot = json.loads(row.product_snapshot)
        factor = snapshot["units_per_packaging"]
        if payload.packaging_id is not None:
            packaging = next((p for p in snapshot["packagings"] if p["id"] == payload.packaging_id), None)
            if packaging is None:
                raise HTTPException(400, "Conditionnement invalide")
            factor = packaging["factor"]
        physical = payload.packaging_quantity * factor + payload.piece_quantity
        if physical > 2147483647:
            raise HTTPException(400, "Quantité trop grande")
    row.physical_qty = physical
    row.note = payload.note
    row.counted_by_id = user.id
    row.counted_at = datetime.now(timezone.utc)
    db.commit()
    return _report(db, session, user)


@router.post("/{session_id}/scan")
def scan(session_id: int, payload: ScanInput, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    session = _editable(db, session_id)
    _start(db, session)
    code = payload.code.strip().casefold()
    for row in _counts(db, session_id):
        snapshot = json.loads(row.product_snapshot)
        factor = 1 if code in [str(snapshot.get(key) or "").casefold() for key in ("sku", "barcode", "qr_code")] else None
        if factor is None:
            packaging = next((p for p in snapshot["packagings"] if p["barcode"] and p["barcode"].casefold() == code), None)
            if packaging:
                factor = packaging["factor"]
        if factor is not None and code:
            row.physical_qty = (row.physical_qty or 0) + factor
            if row.physical_qty > 2147483647:
                raise HTTPException(400, "Quantité trop grande")
            row.counted_by_id = user.id
            row.counted_at = datetime.now(timezone.utc)
            db.commit()
            return _report(db, session, user)
    raise HTTPException(404, "Code inconnu ou hors périmètre")


@router.post("/{session_id}/cancel")
def cancel(session_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire_valider"))):
    session = _editable(db, session_id)
    session.status = "cancelled"
    db.commit()
    return _report(db, session, user)


@router.post("/{session_id}/validate")
def validate(session_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire_valider"))):
    try:
        session = _editable(db, session_id)
        if session.status != "in_progress":
            raise HTTPException(409, "Démarrez le comptage avant validation")
        counts = [row for row in _counts(db, session_id) if row.physical_qty is not None]
        if not counts:
            raise HTTPException(400, "Aucun article compté")
        for row in counts:
            delta = row.physical_qty - row.theoretical_qty
            after = db.execute(update(Product).where(Product.id == row.product_id, Product.quantity + delta >= 0).values(quantity=Product.quantity + delta).returning(Product.quantity)).scalar_one_or_none()
            if after is None:
                raise HTTPException(409, "Stock insuffisant ou article introuvable : validation annulée")
            row.stock_after = after
            snapshot = json.loads(row.product_snapshot)
            db.add(StockMovement(product_id=row.product_id, product_name=snapshot["name"], kind="inventaire", quantity=delta, stock_before=after - delta, stock_after=after,
                reason=f"Inventaire {session.reference}", created_by_id=user.id))
        for row in _counts(db, session_id):
            if row.physical_qty is None:
                product = db.get(Product, row.product_id)
                row.stock_after = product.quantity if product else row.theoretical_qty
        session.status = "validated"
        session.validated_by_id = user.id
        session.validated_by_name = user.name
        session.validated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _report(db, session, user)
