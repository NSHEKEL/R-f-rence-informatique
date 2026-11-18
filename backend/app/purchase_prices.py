from fastapi import HTTPException
from sqlalchemy import null

from .models import PriceHistory, Product, ProductPackaging
from .permissions import has_permission


PRODUCT_PRICES = ("purchase_price", "sale_price", "wholesale_price", "semi_wholesale_price",
    "packaging_sale_price", "wholesale_packaging_price", "supplier_purchase_price")
PACKAGING_PRICES = ("purchase_price", "price_detail", "price_semi_gros", "price_gros")
REQUIRED_PRICES = {"purchase_price", "sale_price", "wholesale_price"}


def review(db, purchase):
    result = []
    for product_id in dict.fromkeys(item.product_id for item in purchase.items if item.product_id):
        product = db.get(Product, product_id)
        if product:
            result.append({"id": product.id, "name": product.name,
                "packaging_unit": product.packaging_unit,
                "prices": {field: getattr(product, field) for field in PRODUCT_PRICES},
                "packagings": [{"id": pack.id, "name": pack.name,
                    "prices": {field: getattr(pack, field) for field in PACKAGING_PRICES}}
                    for pack in product.packagings if pack.active]})
    return result


def apply_changes(db, purchase, changes, received_ids, user):
    seen = set()
    for change in changes:
        db.flush()
        key = (change.product_id, change.packaging_id, change.field)
        if key in seen:
            raise HTTPException(400, "Prix présent plusieurs fois dans la révision")
        seen.add(key)
        if change.product_id not in received_ids:
            raise HTTPException(400, "Les prix doivent concerner un article reçu maintenant")
        product = db.get(Product, change.product_id)
        if change.packaging_id is None:
            target = db.query(Product).filter_by(id=change.product_id).populate_existing().with_for_update().first()
            fields = PRODUCT_PRICES
            if change.field in REQUIRED_PRICES and change.new_value is None:
                raise HTTPException(400, "Ce prix ne peut pas être vide")
        else:
            target = db.query(ProductPackaging).filter_by(id=change.packaging_id).populate_existing().with_for_update().first()
            fields = PACKAGING_PRICES
            if not target or target.product_id != change.product_id or not target.active:
                raise HTTPException(400, "Conditionnement introuvable ou inactif")
        if not target or change.field not in fields:
            raise HTTPException(400, "Champ de prix invalide")
        old = getattr(target, change.field)
        if old != change.old_value:
            raise HTTPException(409, "Le catalogue a changé : rouvrez la révision des prix")
        if old == change.new_value:
            continue
        if not has_permission(db, user, "tarifs_modifier"):
            raise HTTPException(403, "Le droit de modifier les tarifs est requis")
        field = change.field if change.packaging_id is None else f"packaging:{target.id}:{change.field}"
        db.add(PriceHistory(product_id=product.id, field=field, old_value=old if old is not None else null(),
            new_value=change.new_value if change.new_value is not None else null(), changed_by_id=user.id, purchase_reference=purchase.reference))
        setattr(target, change.field, change.new_value)
