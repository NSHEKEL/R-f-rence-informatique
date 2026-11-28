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


def scan_value(code):
    return code.strip().lower()


def catalogue_code_index(db, product_ids):
    index = {}
    for row in db.query(Product.id, func.lower(Product.barcode), func.lower(Product.sku), func.lower(Product.qr_code)).order_by(Product.id):
        for value in row[1:]:
            if value:
                index.setdefault(value, {"product_id": row.id, "packaging_id": None, "scanned_label": None})
    aliases = {}
    for row in db.query(ProductBarcode.product_id, func.lower(ProductBarcode.code), ProductBarcode.label).filter(ProductBarcode.active.is_(True)).order_by(ProductBarcode.id):
        aliases.setdefault(row[1], {"product_id": row.product_id, "packaging_id": None, "scanned_label": row.label})
    index.update(aliases)
    packs = {}
    for row in db.query(ProductPackaging.product_id, func.lower(ProductPackaging.barcode), ProductPackaging.id).filter(ProductPackaging.active.is_(True)).order_by(ProductPackaging.id):
        if row[1]:
            packs.setdefault(row[1], {"product_id": row.product_id, "packaging_id": row.id, "scanned_label": aliases.get(row[1], {}).get("scanned_label")})
    index.update(packs)
    return {key: value for key, value in index.items() if value["product_id"] in product_ids}


def catalogue_scanned_product(rows, code, index=None):
    value = scan_value(code)
    if index is None:
        index, aliases, packs = {}, {}, {}

        def stored_key(raw):
            raw = raw or ""
            if not value.isascii() or (not raw.isascii() and raw.lower() == value):
                raise ValueError("Actualisez le catalogue pour vérifier ce code avec le serveur")
            return raw.translate(str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"))

        for row in sorted(rows, key=lambda row: row["id"]):
            for field in ("barcode", "sku", "qr_code"):
                key = stored_key(row.get(field))
                if key:
                    index.setdefault(key, {"product_id": row["id"], "packaging_id": None, "scanned_label": None})
        for row in rows:
            for alias in row.get("barcodes", []):
                if alias.get("active", True):
                    aliases.setdefault(stored_key(alias["code"]), []).append((alias.get("id", 0), row["id"], alias.get("label")))
            for pack in row.get("packagings", []):
                if pack.get("active", True) and pack.get("barcode"):
                    packs.setdefault(stored_key(pack["barcode"]), []).append((pack["id"], row["id"]))
        for key, candidates in aliases.items():
            _, product_id, label = min(candidates)
            index[key] = {"product_id": product_id, "packaging_id": None, "scanned_label": label}
        for key, candidates in packs.items():
            packaging_id, product_id = min(candidates)
            index[key] = {"product_id": product_id, "packaging_id": packaging_id, "scanned_label": index.get(key, {}).get("scanned_label") if key in aliases else None}
    match = index.get(value)
    product = next((row for row in rows if match and row["id"] == match["product_id"] and row.get("active", True)), None)
    return {**product, "scanned_code": code.strip(), "scanned_label": match["scanned_label"], "packaging_id": match["packaging_id"]} if product else None


def scanned_product(db, code):
    value = scan_value(code)
    alias = db.query(ProductBarcode).filter(func.lower(ProductBarcode.code) == value, ProductBarcode.active.is_(True)).order_by(ProductBarcode.id).first()
    pack = db.query(ProductPackaging).filter(func.lower(ProductPackaging.barcode) == value, ProductPackaging.active.is_(True)).order_by(ProductPackaging.id).first()
    product = db.get(Product, pack.product_id if pack else alias.product_id) if pack or alias else db.query(Product).filter(
        (func.lower(Product.barcode) == value) | (func.lower(Product.sku) == value) | (func.lower(Product.qr_code) == value)).order_by(Product.id).first()
    if not product or not product.active:
        raise HTTPException(404, "Article introuvable")
    return product, pack, alias
