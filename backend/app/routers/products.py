import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin, require_stock_manager
from ..database import get_db
from ..models import Product, Sale, SaleItem, User
from ..schemas import ProductCreate, ProductOut, ProductUpdate

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
    db: Session = Depends(get_db), _: User = Depends(require_stock_manager)
):
    """A free EAN-13 for an article that has no printed barcode."""
    return {"barcode": _generate_barcode(db)}


@router.get("/by-code/{code}", response_model=ProductOut)
def get_product_by_code(
    code: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
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
    _: User = Depends(get_current_user),
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
    _: User = Depends(get_current_user),
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
    _: User = Depends(get_current_user),
):
    product = db.query(Product).get(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    return product


@router.post("", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_stock_manager),
):
    if db.query(Product).filter(Product.sku == payload.sku).first():
        raise HTTPException(status_code=400, detail="Cette référence (SKU) existe déjà")
    _check_barcode(db, payload, None)
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    product = db.query(Product).get(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    existing = db.query(Product).filter(Product.sku == payload.sku).first()
    if existing and existing.id != product_id:
        raise HTTPException(status_code=400, detail="Cette référence (SKU) existe déjà")
    _check_barcode(db, payload, product_id)
    for key, value in payload.model_dump().items():
        setattr(product, key, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    product = db.query(Product).get(product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Produit introuvable")
    db.delete(product)
    db.commit()
