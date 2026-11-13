from fastapi import HTTPException
from sqlalchemy import func, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import AppMigration, Product, ProductBarcode, ProductPackaging


def check_code(db, code, product_id=None):
    value = (code or "").strip().lower()
    if not value:
        return
    insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
    marker = "product_code_write_lock_v1"
    db.execute(insert(AppMigration).values(name=marker).on_conflict_do_nothing(index_elements=["name"]))
    db.execute(update(AppMigration).where(AppMigration.name == marker).values(name=marker))
    products = db.query(Product.id).filter((func.lower(Product.barcode) == value) | (func.lower(Product.sku) == value) | (func.lower(Product.qr_code) == value)).all()
    packs = db.query(ProductPackaging.product_id).filter(func.lower(ProductPackaging.barcode) == value).all()
    codes = db.query(ProductBarcode.product_id).filter(func.lower(ProductBarcode.code) == value).all()
    if any(row[0] != product_id for row in (*products, *packs, *codes)):
        raise HTTPException(400, "Code déjà utilisé par un autre article ou conditionnement")


def scanned_product(db, code):
    value = code.strip().lower()
    alias = db.query(ProductBarcode).filter(func.lower(ProductBarcode.code) == value, ProductBarcode.active.is_(True)).first()
    pack = db.query(ProductPackaging).filter(func.lower(ProductPackaging.barcode) == value, ProductPackaging.active.is_(True)).first()
    product = db.get(Product, pack.product_id if pack else alias.product_id) if pack or alias else db.query(Product).filter(
        (func.lower(Product.barcode) == value) | (func.lower(Product.sku) == value) | (func.lower(Product.qr_code) == value)).first()
    if not product:
        raise HTTPException(404, "Article introuvable")
    return product, pack, alias
