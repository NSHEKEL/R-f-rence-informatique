import json
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import AwareDatetime, BaseModel, Field, model_validator
from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Category, Depot, DepotStock, InventoryCount, InventorySession, Product, StockMovement, User
from ..permissions import has_permission, require_permission
from ..sequences import next_reference
from .. import stock
from ..catalogue_import import read_catalogue

router = APIRouter(prefix="/sessions", tags=["inventory"])
OPEN = ("draft", "in_progress")


class SessionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scope_type: Literal["general", "category", "rayon", "emplacement", "selection", "depot"] = "general"
    scope: dict = Field(default_factory=dict)
    blind: bool = False
    note: str = Field(default="", max_length=4000)


class CountInput(BaseModel):
    client_updated_at: AwareDatetime | None = None
    client_id: str = Field(default="", max_length=100)
    counts: dict[str, Annotated[int, Field(strict=True, ge=0, le=2147483647)] | None] | None = Field(default=None, max_length=1000)
    physical_qty: int | None = Field(default=None, ge=0, le=2147483647, strict=True)
    packaging_quantity: int | None = Field(default=None, ge=0, le=1000000, strict=True)
    piece_quantity: int = Field(default=0, ge=0, le=2147483647, strict=True)
    packaging_id: int | None = None
    note: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def client_stamp(self):
        if bool(self.client_updated_at) != bool(self.client_id):
            raise ValueError("Identifiant client et horodatage requis ensemble")
        return self


class ScanInput(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    focus_only: bool = False


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
        "category": product.category.name if product.category else "", "supplier": product.supplier.name if product.supplier else "",
        "rayon": product.rayon, "emplacement": product.emplacement, "base_unit": product.base_unit or "pièce",
        "packaging_unit": product.packaging_unit or "", "units_per_packaging": product.units_per_packaging or 1,
        "barcodes": [p.code for p in product.barcodes if p.active],
        "packagings": [{"id": p.id, "name": p.name, "factor": p.factor, "barcode": p.barcode} for p in product.packagings if p.active]})


def _depot(session):
    return json.loads(session.scope_json).get("depot_id") if session.scope_type == "depot" else None


def _quantity(db, session, product):
    return stock.quantity(db, product.id, _depot(session)) if session.scope_type == "depot" else product.quantity


def _start(db, session):
    if session.status != "draft":
        return
    rows = _counts(db, session.id)
    products = {product.id: product for product in db.query(Product).filter(Product.id.in_([row.product_id for row in rows])).order_by(Product.id).with_for_update().all()}
    for row in rows:
        product = products.get(row.product_id)
        if product is None:
            raise HTTPException(409, "Un article de cette session n'existe plus")
        row.theoretical_qty = _quantity(db, session, product)
        row.unit_cost = product.purchase_price or 0
        row.product_snapshot = _snapshot(product)
    session.status = "in_progress"
    db.flush()


def _header(session):
    return {key: getattr(session, key) for key in ("id", "reference", "name", "scope_type", "blind", "status", "created_by_id", "created_by_name", "created_at", "validated_by_id", "validated_by_name", "validated_at", "note")} | {"scope": json.loads(session.scope_json)}


def _units(snapshot):
    units = [{"key": "base", "name": snapshot["base_unit"], "factor": 1}]
    if snapshot.get("packaging_unit"):
        units.append({"key": "primary", "name": snapshot["packaging_unit"], "factor": snapshot["units_per_packaging"]})
    units.extend({"key": str(pack["id"]), "name": pack["name"], "factor": pack["factor"]} for pack in snapshot["packagings"])
    return units


def _set_count(row, payload, user):
    timestamp = payload.client_updated_at.astimezone(timezone.utc) if payload.client_updated_at else datetime.now(timezone.utc)
    previous = row.client_updated_at
    if previous is not None and payload.client_updated_at is not None:
        previous = previous.replace(tzinfo=timezone.utc) if previous.tzinfo is None else previous.astimezone(timezone.utc)
        if (timestamp, payload.client_id) <= (previous, row.client_id or ""):
            return
    snapshot = json.loads(row.product_snapshot)
    physical = payload.physical_qty
    if payload.counts is not None:
        units = {unit["key"]: unit for unit in _units(snapshot)}
        if payload.physical_qty is not None or payload.packaging_quantity is not None or set(payload.counts) - units.keys():
            raise HTTPException(400, "Conditionnement inconnu ou modes de comptage incompatibles")
        physical = sum(value * units[key]["factor"] for key, value in payload.counts.items() if value is not None) if any(value is not None for value in payload.counts.values()) else None
        breakdown = payload.counts
    else:
        if payload.packaging_quantity is not None:
            key = str(payload.packaging_id) if payload.packaging_id is not None else "primary"
            unit = next((unit for unit in _units(snapshot) if unit["key"] == key), None)
            if unit is None and payload.packaging_id is None:
                unit = {"factor": snapshot["units_per_packaging"]}
            if unit is None:
                raise HTTPException(400, "Conditionnement invalide")
            physical = payload.packaging_quantity * unit["factor"] + payload.piece_quantity
            breakdown = {key: payload.packaging_quantity, "base": payload.piece_quantity} if snapshot["packaging_unit"] or payload.packaging_id is not None else {"base": physical}
        else:
            breakdown = {"base": physical}
    if physical is not None and physical > 2147483647:
        raise HTTPException(400, "Quantité trop grande")
    row.physical_qty = physical
    row.counts_json = json.dumps(breakdown)
    row.client_updated_at = timestamp
    row.client_id = payload.client_id or "server"
    row.note = payload.note
    row.counted_by_id = user.id if physical is not None else None
    row.counted_at = timestamp if physical is not None else None


def _report(db, session, user, product_id=None):
    visible = not session.blind or has_permission(db, user, "inventaire_voir_theorique")
    rows = []
    stats = {"counted": 0, "not_counted": 0}
    if visible:
        stats.update(conforme=0, manquant=0, excedent=0, variance_value=0, theoretical_value=0, physical_value=0, stock_after_value=0)
    counts = db.query(InventoryCount).filter_by(session_id=session.id)
    if product_id is not None:
        counts = counts.filter_by(product_id=product_id)
    counts = counts.order_by(InventoryCount.id).all()
    ids = [count.product_id for count in counts]
    quantities = dict(db.query(DepotStock.product_id, DepotStock.quantity).filter(DepotStock.depot_id == _depot(session), DepotStock.product_id.in_(ids)).all()) if _depot(session) else dict(db.query(Product.id, Product.quantity).filter(Product.id.in_(ids)).all())
    for count in counts:
        row = json.loads(count.product_snapshot) | {"product_id": count.product_id, "physical_qty": count.physical_qty, "counts": json.loads(count.counts_json or "{}") or {"base": count.physical_qty}, "client_updated_at": count.client_updated_at.replace(tzinfo=timezone.utc) if count.client_updated_at else None, "client_id": count.client_id, "counted_by_id": count.counted_by_id, "counted_at": count.counted_at.replace(tzinfo=timezone.utc) if count.counted_at else None, "note": count.note}
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
            projected = quantities.get(count.product_id, 0 if _depot(session) else count.theoretical_qty) + (delta or 0)
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
    query = db.query(Product).filter(Product.active.is_(True))
    scope = payload.scope
    if payload.scope_type == "depot":
        value = scope.get("depot_id")
        if type(value) is not int or value < 1:
            raise HTTPException(400, "Dépôt requis")
        depot_id = stock.resolve(db, value)
        scope = {"depot_id": depot_id, "depot_name": db.get(Depot, depot_id).name}
        if payload.scope.get("category_id") is not None:
            category_id = payload.scope["category_id"]
            if type(category_id) is not int or category_id < 1:
                raise HTTPException(400, "Catégorie invalide")
            scope["category_id"] = category_id
            query = query.filter(Product.category_id == category_id)
        if payload.scope.get("rayon"):
            rayon = payload.scope["rayon"]
            if not isinstance(rayon, str):
                raise HTTPException(400, "Rayon invalide")
            scope["rayon"] = rayon.strip()
            query = query.filter(Product.rayon == rayon.strip())
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
        db.add(InventoryCount(session_id=session.id, product_id=product.id, theoretical_qty=_quantity(db, session, product), unit_cost=product.purchase_price or 0, product_snapshot=_snapshot(product)))
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
def count(session_id: int, product_id: int, payload: CountInput, line_only: bool = False, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    session = _editable(db, session_id)
    _start(db, session)
    row = db.query(InventoryCount).filter_by(session_id=session_id, product_id=product_id).first()
    if row is None:
        raise HTTPException(404, "Article hors périmètre")
    _set_count(row, payload, user)
    db.commit()
    return _report(db, session, user, product_id if line_only else None)


@router.post("/{session_id}/scan")
def scan(session_id: int, payload: ScanInput, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    session = _editable(db, session_id)
    _start(db, session)
    code = payload.code.strip().casefold()
    for row in _counts(db, session_id):
        snapshot = json.loads(row.product_snapshot)
        factor = 1 if code in [str(snapshot.get(key) or "").casefold() for key in ("sku", "barcode", "qr_code")] or code in [value.casefold() for value in snapshot.get("barcodes", [])] else None
        packaging = next((p for p in snapshot["packagings"] if p["barcode"] and p["barcode"].casefold() == code), None)
        if packaging:
            factor = packaging["factor"]
        if factor is not None and code:
            if payload.focus_only:
                result = _report(db, session, user)
                result["scan_match"] = {"product_id": row.product_id, "key": str(packaging["id"]) if packaging else "base", "already_counted": row.physical_qty is not None}
                db.commit()
                return result
            row.physical_qty = (row.physical_qty or 0) + factor
            if row.physical_qty > 2147483647:
                raise HTTPException(400, "Quantité trop grande")
            row.counted_by_id = user.id
            row.counts_json = json.dumps({"base": row.physical_qty})
            row.counted_at = datetime.now(timezone.utc)
            row.client_updated_at = row.counted_at
            row.client_id = "server"
            db.commit()
            return _report(db, session, user)
    raise HTTPException(404, "Code inconnu ou hors périmètre")


@router.get("/{session_id}/grid-export")
def export_grid(session_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    session = _session(db, session_id)
    report = _report(db, session, user)
    groups = max((len(_units(row)) - 1 for row in report["rows"]), default=0)
    headers = ["Référence", "Désignation", "Catégorie", "Stock théorique"]
    for index in range(1, groups + 1):
        headers.extend([f"Conditionnement {index}", f"Facteur {index}", f"Quantité {index}"])
    headers.append("Unité")
    rows = []
    for row in report["rows"]:
        values = [row["sku"], row["name"], row.get("category", ""), row.get("theoretical_qty", "")]
        packs = _units(row)[1:]
        for index in range(groups):
            pack = packs[index] if index < len(packs) else None
            values.extend([pack["name"], pack["factor"], row["counts"].get(pack["key"]) if row["counts"].get(pack["key"]) is not None else ""] if pack else ["", "", ""])
        values.append(row["counts"].get("base") if row["counts"].get("base") is not None else "")
        rows.append(values)
    return {"headers": headers, "rows": rows}


@router.post("/{session_id}/grid-import")
async def import_grid(session_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_permission("inventaire"))):
    try:
        headers, incoming = read_catalogue(await file.read(20 * 1024 * 1024 + 1), file.filename or "")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if "Référence" not in headers or "Unité" not in headers:
        raise HTTPException(400, "Colonnes Référence et Unité requises ; utilisez l'export de la grille")
    session = _editable(db, session_id)
    _start(db, session)
    rows = {json.loads(row.product_snapshot)["sku"].casefold(): row for row in _counts(db, session_id)}
    updated, errors, seen = 0, [], set()
    for number, cells in enumerate(incoming, 2):
        sku = (cells.get("Référence") or "").strip()
        if not sku and not any(cells.values()):
            continue
        row = rows.get(sku.casefold())
        try:
            if row is None:
                raise ValueError(f"Référence inconnue ou hors périmètre : {sku}")
            if sku.casefold() in seen:
                raise ValueError(f"Référence répétée : {sku}")
            seen.add(sku.casefold())
            units = _units(json.loads(row.product_snapshot))
            counts = {unit["key"]: None for unit in units}
            def quantity(value):
                text = str(value or "").strip()
                if not text:
                    return None
                if not text.isdecimal() or int(text) > 2147483647:
                    raise ValueError("Quantité entière positive ou nulle requise")
                return int(text)
            counts["base"] = quantity(cells.get("Unité"))
            used = set()
            for header in headers:
                if not header.startswith("Conditionnement "):
                    continue
                index = header.removeprefix("Conditionnement ")
                name = str(cells.get(header) or "").strip()
                factor = str(cells.get(f"Facteur {index}") or "").strip()
                value = cells.get(f"Quantité {index}")
                if not name and not factor and not str(value or "").strip():
                    continue
                candidates = [unit for unit in units[1:] if unit["name"].casefold() == name.casefold() and (not factor or unit["factor"] == float(factor.replace(",", "."))) and unit["key"] not in used]
                preferred = units[int(index)] if index.isdecimal() and int(index) < len(units) else None
                unit = preferred if preferred in candidates else next(iter(candidates), None)
                if unit is None or unit["key"] in used:
                    raise ValueError(f"Conditionnement inconnu, répété ou facteur modifié : {name} ×{factor}")
                used.add(unit["key"])
                counts[unit["key"]] = quantity(value)
            _set_count(row, CountInput(counts=counts, note=row.note), user)
            updated += 1
        except (ValueError, HTTPException) as exc:
            errors.append({"line": number, "sku": sku, "message": str(exc.detail) if isinstance(exc, HTTPException) else str(exc)})
    db.commit()
    return {"updated": updated, "errors": errors, "report": _report(db, session, user)}


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
            product = db.get(Product, row.product_id)
            if product is None:
                raise HTTPException(409, "Stock insuffisant ou article introuvable : validation annulée")
            try:
                before, after = stock.adjust(db, product, delta, _depot(session), allow_negative=session.scope_type != "depot", check_total=True)
            except HTTPException as exc:
                raise HTTPException(409, exc.detail) from exc
            row.stock_after = _quantity(db, session, product)
            snapshot = json.loads(row.product_snapshot)
            db.add(StockMovement(depot_id=stock.resolve(db, _depot(session)), product_id=row.product_id, product_name=snapshot["name"], kind="inventaire", quantity=delta, stock_before=before, stock_after=after,
                reason=f"Inventaire {session.reference}" + (" — " + " + ".join(f"{value} {unit['name']} ×{unit['factor']}" for unit in _units(snapshot) if (value := json.loads(row.counts_json or '{}').get(unit['key'])) is not None) + (f" — {row.note}" if row.note else "") if json.loads(row.counts_json or '{}') else ""), created_by_id=user.id))
        for row in _counts(db, session_id):
            if row.physical_qty is None:
                product = db.get(Product, row.product_id)
                row.stock_after = _quantity(db, session, product) if product else row.theoretical_qty
        session.status = "validated"
        session.validated_by_id = user.id
        session.validated_by_name = user.name
        session.validated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return _report(db, session, user)
