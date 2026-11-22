from fastapi import HTTPException
from decimal import Decimal, ROUND_HALF_UP
from types import SimpleNamespace

from .models import ProductPackaging


def selected_packaging(db, product, packaging_id):
    if packaging_id is None:
        return product
    packaging = db.get(ProductPackaging, packaging_id)
    if not packaging or packaging.product_id != product.id or not packaging.active:
        raise HTTPException(status_code=400, detail="Conditionnement introuvable ou inactif")
    return SimpleNamespace(
        base_unit=product.base_unit, packaging_unit=packaging.name,
        units_per_packaging=packaging.factor, sale_price=product.sale_price,
        wholesale_price=product.wholesale_price,
        semi_wholesale_price=product.semi_wholesale_price,
        semi_wholesale_min_qty=product.semi_wholesale_min_qty,
        wholesale_min_qty=product.wholesale_min_qty,
        packaging_sale_price=packaging.price_detail,
        wholesale_packaging_price=packaging.price_gros,
        semi_packaging_price=packaging.price_semi_gros,
        packaging_purchase_price=packaging.purchase_price,
    )


def resolve_tier(product, tier, quantity):
    if tier != "auto":
        return tier
    for key, resolved in (("wholesale_min_qty", "gros"), ("semi_wholesale_min_qty", "semi_gros")):
        threshold = getattr(product, key, None)
        if threshold is not None and quantity >= threshold:
            return resolved
    return "detail"


def quote_line(product, spec, item, price_mode):
    quantity = item.quantity
    tier = resolve_tier(product, item.price_tier or price_mode, quantity)
    base_price, pack_price = prices(spec, tier)
    packs = item.packaging_quantity or 0
    pieces = item.piece_quantity if item.piece_quantity is not None else (0 if item.packaging_quantity is not None else quantity)
    unit_price = (packs * pack_price + pieces * base_price) / quantity
    if item.packaging_divisor is not None:
        factor = spec.units_per_packaging or 1
        divisor = item.packaging_divisor
        if not spec.packaging_unit or factor % divisor or packs or quantity % (factor // divisor):
            raise HTTPException(400, "Division impossible : les parts doivent contenir un nombre entier d'unités de base, sans carton entier sur la même ligne")
        part_total = float((Decimal(str(pack_price)) / divisor).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        unit_price = part_total / (factor // divisor)
        base_price = unit_price
        pack_price = unit_price * factor
    if quantity != int(quantity) and item.packaging_divisor is None:
        gross = Decimal(str(packs)) * Decimal(str(pack_price)) + Decimal(str(pieces)) * Decimal(str(base_price))
        charged = float(gross.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        ratio = charged / float(gross) if gross else 1
        base_price *= ratio
        pack_price *= ratio
        unit_price = charged / quantity
    return tier, base_price, pack_price, packs, pieces, unit_price


def cached_packaging(product, packaging_id):
    spec = SimpleNamespace(**{"base_unit": "pièce", "packaging_unit": "", "units_per_packaging": 1,
        "packaging_sale_price": None, "wholesale_packaging_price": None, "semi_packaging_price": None,
        "wholesale_price": 0, "semi_wholesale_price": None, **product})
    if packaging_id is None:
        return spec
    packaging = next((row for row in product.get("packagings", []) if row["id"] == packaging_id and row.get("active", True)), None)
    if packaging is None:
        raise HTTPException(409, "Conditionnement absent du catalogue signé")
    spec.packaging_unit = packaging["name"]
    spec.units_per_packaging = packaging["factor"]
    spec.packaging_sale_price = packaging.get("price_detail")
    spec.wholesale_packaging_price = packaging.get("price_gros")
    spec.semi_packaging_price = packaging.get("price_semi_gros")
    spec.packaging_purchase_price = packaging.get("purchase_price")
    return spec


def prices(product, tier="detail"):
    piece = product.sale_price or 0
    carton = product.packaging_sale_price
    factor = product.units_per_packaging or 1
    if carton is None:
        carton = factor * piece
    if tier == "semi_gros":
        semi = getattr(product, "semi_wholesale_price", None)
        piece = piece if semi is None else semi
        carton = getattr(product, "semi_packaging_price", None)
        if carton is None:
            carton = factor * piece
    elif tier == "gros":
        wholesale = (product.wholesale_price or 0) > 0
        if wholesale:
            piece = product.wholesale_price
        if product.wholesale_packaging_price is not None:
            carton = product.wholesale_packaging_price
        elif wholesale or hasattr(product, "semi_packaging_price"):
            carton = factor * piece
    return piece, carton


def snapshot(product):
    return {
        "base_unit": product.base_unit if product.base_unit is not None else "pièce",
        "packaging_unit": product.packaging_unit or "",
        "units_per_packaging": product.units_per_packaging or 1,
    }


def base_quantity(line, product, legacy_field="quantity"):
    packs = getattr(line, "packaging_quantity", None)
    pieces = getattr(line, "piece_quantity", None)
    if packs is None and pieces is None:
        quantity = getattr(line, legacy_field)
        if abs(quantity) > 2147483647:
            raise HTTPException(status_code=400, detail="Quantité trop élevée")
        return round(quantity, 6)
    if packs and not product.packaging_unit:
        raise HTTPException(status_code=400, detail="Ce produit ne possède pas de conditionnement")
    quantity = (packs or 0) * (product.units_per_packaging or 1) + (pieces or 0)
    if quantity > 2147483647:
        raise HTTPException(status_code=400, detail="Quantité trop élevée")
    return round(quantity, 6)


def quantity_label(quantity, base_unit, packaging_unit, factor):
    def formatted(value):
        return f"{value:.6f}".rstrip("0").rstrip(".").replace(".", ",")
    label = f"{formatted(quantity)} {base_unit or 'pièce'}"
    if not packaging_unit or not factor:
        return label
    packs, pieces = divmod(abs(quantity), factor)
    equivalence = f"{'−' if quantity < 0 else ''}{formatted(packs)} {packaging_unit}"
    if pieces:
        equivalence += f" {'−' if quantity < 0 else '+'} {formatted(pieces)} {base_unit}"
    return f"{label} = {equivalence}"
