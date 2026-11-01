import csv
import io
import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Category,
    PriceHistory,
    Product,
    Sale,
    SaleItem,
    StockLot,
    User,
)
from ..permissions import require_permission
from ..schemas import (
    PriceHistoryOut,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    StockLotCreate,
    StockLotOut,
)
from .cash import require_open_till

router = APIRouter(prefix="/api/products", tags=["products"])

# EAN-13 prefix reserved for in-store codes, so generated codes never clash
# with codes printed by manufacturers.
INTERNAL_PREFIX = "200"


def _ean13_checksum(twelve: str) -> str:
    total = sum(
        int(digit) * (3 if index % 2 else 1)
        for index, digit in enumerate(twelve)
    )
    return str((10 - total % 10) % 10)


def _generate_barcode(db: Session) -> str:
    for _ in range(20):
        body = INTERNAL_PREFIX + "".join(
            str(random.randint(0, 9)) for _ in range(9)
        )
        code = body + _ean13_checksum(body)
        if not db.query(Product).filter(Product.barcode == code).first():
            return code
    raise HTTPException(
        status_code=500, detail="Impossible de générer un code-barres"
    )


def _check_barcode(db: Session, payload, product_id: int | None) -> None:
    code = (payload.barcode or "").strip()
    if not code:
        return
    if not code.isdigit():
        raise HTTPException(
            status_code=400, detail="Le code-barres doit contenir des chiffres"
        )
    existing = db.query(Product).filter(Product.barcode == code).first()
    if existing and existing.id != product_id:
        raise HTTPException(
            status_code=400,
            detail=f"Ce code-barres est déjà utilisé par {existing.name}",
        )


@router.get("/barcode/next")
def next_barcode(
    db: Session = Depends(get_db), _: User = Depends(require_permission("produits"))
):
    """A free EAN-13 for an article that has no printed barcode."""
    return {"barcode": _generate_barcode(db)}


@router.get("/by-code/{code}", response_model=ProductOut)
def get_product_by_code(
    code: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_open_till),
):
    """Scanner lookup: barcode, QR code or SKU."""
    value = code.strip()
    product = (
        db.query(Product)
        .filter(
            (Product.barcode == value)
            | (Product.qr_code == value)
            | (Product.sku == value)
        )
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Article introuvable")
    return product


def _sales_stats(db: Session) -> dict[int, tuple[int, object]]:
    """Units sold and last sale date per product, cancelled tickets aside."""
    rows = (
        db.query(
            SaleItem.product_id,
            func.sum(SaleItem.quantity).label("sold"),
            func.max(Sale.date).label("last_sold"),
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(Sale.status != "Annulée", SaleItem.product_id.isnot(None))
        .group_by(SaleItem.product_id)
        .all()
    )
    return {row.product_id: (int(row.sold or 0), row.last_sold) for row in rows}


@router.get("", response_model=list[ProductOut])
def list_products(
    sold: str = "",
    db: Session = Depends(get_db),
    _: User = Depends(require_open_till),
):
    """Catalogue, optionally filtered on sales history.

    ``sold=jamais`` keeps the articles never sold, ``sold=top`` the ones sold
    the most (best first); anything else returns the whole catalogue.
    """
    stats = _sales_stats(db)
    products = db.query(Product).order_by(Product.name).all()
    for product in products:
        quantity, last = stats.get(product.id, (0, None))
        product.sold_quantity = quantity
        product.last_sold_at = last
    if sold == "jamais":
        return [p for p in products if p.sold_quantity == 0]
    if sold == "top":
        return sorted(
            (p for p in products if p.sold_quantity > 0),
            key=lambda p: p.sold_quantity,
            reverse=True,
        )
    return products


@router.get("/best-sellers", response_model=list[ProductOut])
def best_sellers(
    limit: int = 12,
    db: Session = Depends(get_db),
    _: User = Depends(require_open_till),
):
    """Articles the shop sells the most, shown first on the till screen."""
    ranked = (
        db.query(
            SaleItem.product_id,
            func.sum(SaleItem.quantity).label("sold"),
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .filter(Sale.status != "Annulée", SaleItem.product_id.isnot(None))
        .group_by(SaleItem.product_id)
        .order_by(func.sum(SaleItem.quantity).desc())
        .limit(limit)
        .all()
    )
    order = {row.product_id: index for index, row in enumerate(ranked)}
    if not order:
        return []
    products = (
        db.query(Product).filter(Product.id.in_(list(order))).all()
    )
    return sorted(products, key=lambda p: order[p.id])


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_open_till),
):
    product = db.query(Product).get(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    return product


# Column aliases accepted in an import file (case-insensitive, accents ok).
_CSV_ALIASES = {
    "name": {"nom", "name", "designation", "désignation", "libelle", "libellé"},
    "sku": {"sku", "reference", "référence", "ref", "code", "code_article"},
    "description": {"description", "desc"},
    "category": {"categorie", "catégorie", "category"},
    "purchase_price": {"prix_achat", "purchase_price", "achat", "cout", "coût"},
    "sale_price": {"prix_vente", "sale_price", "prix", "vente", "price"},
    "wholesale_price": {
        "prix_gros",
        "wholesale_price",
        "gros",
        "prix_de_gros",
        "prixen gros",
    },
    "quantity": {"quantite", "quantité", "quantity", "stock", "qte"},
    "min_stock": {"min_stock", "seuil", "stock_min", "stock_minimum", "alerte"},
    "barcode": {"barcode", "code_barres", "code-barres", "ean", "ean13"},
}


def _norm_header(header: str) -> str:
    return header.strip().lower().replace(" ", "_")


def _map_row(row: dict) -> dict[str, str]:
    """Renames the file's columns to the catalogue's field names."""
    mapped: dict[str, str] = {}
    for raw, value in row.items():
        if raw is None:
            continue
        key = _norm_header(raw)
        for field, aliases in _CSV_ALIASES.items():
            if key in aliases or key == field:
                if field not in mapped:
                    mapped[field] = (value or "").strip()
                break
    return mapped


def _to_float(value: str, default: float = 0) -> float:
    value = value.replace(" ", "").replace(",", ".").replace("FCFA", "").strip()
    try:
        return float(value) if value else default
    except ValueError:
        return default


def _to_int(value: str, default: int = 0) -> int:
    return int(round(_to_float(value, float(default))))


@router.post("/import")
def import_products(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("produits_gerer")),
):
    """Bulk catalogue load: upserts rows by SKU, never deletes anything.

    The first line must hold headers; `,` and `;` separators are both read,
    as are Excel's UTF-8 files. A row already in the catalogue (same SKU) is
    updated, the others are created — an entry is never removed by an import.
    """
    raw = file.file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    try:
        sample = text[:4096]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="Fichier vide ou illisible")

    # Fields the file actually carries: an update never wipes a column the
    # file does not mention.
    headers = {_norm_header(h) for h in reader.fieldnames if h}
    present = {
        field
        for field, aliases in _CSV_ALIASES.items()
        if aliases & headers or field in headers
    }

    created, updated, errors = 0, 0, []
    categories = {c.name.lower(): c for c in db.query(Category).all()}
    seen_barcodes = {p.barcode for p in db.query(Product).all() if p.barcode}

    for number, row in enumerate(reader, start=2):
        fields = _map_row(row)
        name = fields.get("name", "")
        sku = fields.get("sku", "")
        if not name and not sku:
            continue  # blank line
        if not sku:
            sku = f"IMP-{number:05d}"
        if not name:
            name = sku
        barcode = fields.get("barcode", "")
        if barcode:
            if not barcode.isdigit():
                errors.append(
                    {"line": number, "message": f"Code-barres non numérique : {barcode}"}
                )
                continue
            if barcode in seen_barcodes:
                errors.append(
                    {"line": number, "message": f"Code-barres déjà utilisé : {barcode}"}
                )
                continue
        category_id = None
        category_name = fields.get("category", "")
        if category_name:
            cat = categories.get(category_name.lower())
            if cat is None:
                cat = Category(name=category_name)
                db.add(cat)
                db.flush()
                categories[category_name.lower()] = cat
            category_id = cat.id
        values = {"name": name}
        if "description" in present:
            values["description"] = fields.get("description", "")
        if "category" in present:
            values["category_id"] = category_id
        if "purchase_price" in present:
            values["purchase_price"] = _to_float(fields.get("purchase_price", ""))
        if "sale_price" in present:
            values["sale_price"] = _to_float(fields.get("sale_price", ""))
        if "wholesale_price" in present:
            values["wholesale_price"] = _to_float(
                fields.get("wholesale_price", "")
            )
        if "quantity" in present:
            values["quantity"] = _to_int(fields.get("quantity", ""))
        if "min_stock" in present:
            values["min_stock"] = _to_int(fields.get("min_stock", ""), 5)
        if barcode:
            values["barcode"] = barcode
            seen_barcodes.add(barcode)
        existing = db.query(Product).filter(Product.sku == sku).first()
        try:
            if existing:
                for key, value in values.items():
                    if key in _PRICE_FIELDS and getattr(existing, key) != value:
                        db.add(
                            PriceHistory(
                                product_id=existing.id,
                                field=key,
                                old_value=getattr(existing, key),
                                new_value=value,
                            )
                        )
                    setattr(existing, key, value)
                updated += 1
            else:
                # A new article needs every numeric field to exist.
                values.setdefault("description", "")
                values.setdefault("category_id", None)
                values.setdefault("purchase_price", 0)
                values.setdefault("sale_price", 0)
                values.setdefault("wholesale_price", 0)
                values.setdefault("quantity", 0)
                values.setdefault("min_stock", 5)
                db.add(Product(sku=sku, **values))
                created += 1
            # Each row lands on its own: a bad row later never undoes it.
            db.commit()
        except Exception as exc:  # a bad row must not drop the whole file
            db.rollback()
            categories = {c.name.lower(): c for c in db.query(Category).all()}
            errors.append({"line": number, "message": str(exc)[:120]})
    return {"created": created, "updated": updated, "errors": errors}


@router.post("", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("produits_gerer")),
):
    """The catalogue is the administrator's: the stock manager only reads it."""
    if db.query(Product).filter(Product.sku == payload.sku).first():
        raise HTTPException(status_code=400, detail="Cette référence (SKU) existe déjà")
    _check_barcode(db, payload, None)
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


_PRICE_FIELDS = ("sale_price", "purchase_price", "wholesale_price")


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("produits_gerer")),
):
    product = db.query(Product).get(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    existing = db.query(Product).filter(Product.sku == payload.sku).first()
    if existing and existing.id != product_id:
        raise HTTPException(status_code=400, detail="Cette référence (SKU) existe déjà")
    _check_barcode(db, payload, product_id)
    for key, value in payload.model_dump().items():
        if key in _PRICE_FIELDS and getattr(product, key) != value:
            db.add(
                PriceHistory(
                    product_id=product.id,
                    field=key,
                    old_value=getattr(product, key),
                    new_value=value,
                    changed_by_id=current_user.id,
                )
            )
        setattr(product, key, value)
    db.commit()
    db.refresh(product)
    return product


@router.get("/{product_id}/price-history", response_model=list[PriceHistoryOut])
def price_history(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("produits")),
):
    """Every price change recorded on the article, newest first."""
    if not db.query(Product).get(product_id):
        raise HTTPException(status_code=404, detail="Produit introuvable")
    return (
        db.query(PriceHistory)
        .filter(PriceHistory.product_id == product_id)
        .order_by(PriceHistory.changed_at.desc())
        .all()
    )


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("produits_gerer")),
):
    product = db.query(Product).get(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    db.delete(product)
    db.commit()


# ---------- Stock lots & expiry ----------

def _lot_out(lot: StockLot) -> StockLotOut:
    row = StockLotOut.model_validate(lot)
    row.product_name = lot.product.name if lot.product else ""
    if lot.expiry_date:
        row.days_left = (lot.expiry_date.date() - datetime.now().date()).days
    return row


@router.get("/lots/alertes", response_model=list[StockLotOut])
def lot_alerts(
    days: int = 30,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("produits")),
):
    """Lots expiring within `days` (or already expired), soonest first."""
    horizon = datetime.now().date() + timedelta(days=max(days, 0))
    lots = (
        db.query(StockLot)
        .filter(StockLot.quantity > 0, StockLot.expiry_date.isnot(None))
        .order_by(StockLot.expiry_date.asc())
        .all()
    )
    return [
        _lot_out(lot)
        for lot in lots
        if lot.expiry_date and lot.expiry_date.date() <= horizon
    ]


@router.get("/{product_id}/lots", response_model=list[StockLotOut])
def product_lots(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("produits")),
):
    if not db.query(Product).get(product_id):
        raise HTTPException(status_code=404, detail="Produit introuvable")
    lots = (
        db.query(StockLot)
        .filter(StockLot.product_id == product_id)
        .order_by(StockLot.expiry_date.asc(), StockLot.id.asc())
        .all()
    )
    return [_lot_out(lot) for lot in lots]


@router.post("/{product_id}/lots", response_model=StockLotOut, status_code=201)
def create_lot(
    product_id: int,
    payload: StockLotCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stocks")),
):
    """Earmark part of the on-hand stock under a lot number + expiry date."""
    product = db.query(Product).get(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantité invalide")
    tagged = (
        db.query(func.coalesce(func.sum(StockLot.quantity), 0))
        .filter(StockLot.product_id == product_id)
        .scalar()
    )
    untagged = product.quantity - int(tagged)
    if payload.quantity > untagged:
        raise HTTPException(
            status_code=400,
            detail=f"Stock sans lot insuffisant : {untagged} disponible(s)",
        )
    lot = StockLot(
        product_id=product_id,
        lot_number=payload.lot_number.strip(),
        expiry_date=payload.expiry_date,
        quantity=payload.quantity,
        created_by_id=current_user.id,
    )
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return _lot_out(lot)


@router.delete("/lots/{lot_id}", status_code=204)
def release_lot(
    lot_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("stocks")),
):
    """Remove the lot tag: its quantity returns to the untagged stock."""
    lot = db.query(StockLot).get(lot_id)
    if not lot:
        raise HTTPException(status_code=404, detail="Lot introuvable")
    db.delete(lot)
    db.commit()
