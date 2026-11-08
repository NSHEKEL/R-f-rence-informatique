from fastapi import HTTPException


def prices(product, tier="detail"):
    piece = product.sale_price or 0
    carton = product.packaging_sale_price
    factor = product.units_per_packaging or 1
    if carton is None:
        carton = factor * piece
    if tier == "gros":
        wholesale = (product.wholesale_price or 0) > 0
        if wholesale:
            piece = product.wholesale_price
        if product.wholesale_packaging_price is not None:
            carton = product.wholesale_packaging_price
        elif wholesale:
            carton = factor * piece
    return piece, carton


def snapshot(product):
    return {
        "base_unit": product.base_unit or "pièce",
        "packaging_unit": product.packaging_unit or "",
        "units_per_packaging": product.units_per_packaging or 1,
    }


def base_quantity(line, product, legacy_field="quantity"):
    packs = getattr(line, "packaging_quantity", None)
    pieces = getattr(line, "piece_quantity", None)
    if packs is None and pieces is None:
        return getattr(line, legacy_field)
    if packs and not product.packaging_unit:
        raise HTTPException(status_code=400, detail="Ce produit ne possède pas de conditionnement")
    quantity = (packs or 0) * (product.units_per_packaging or 1) + (pieces or 0)
    if quantity > 2147483647:
        raise HTTPException(status_code=400, detail="Quantité trop élevée")
    return quantity


def quantity_label(quantity, base_unit, packaging_unit, factor):
    label = f"{quantity} {base_unit or 'pièce'}"
    if not packaging_unit or not factor:
        return label
    packs, pieces = divmod(abs(quantity), factor)
    equivalence = f"{'−' if quantity < 0 else ''}{packs} {packaging_unit}"
    if pieces:
        equivalence += f" {'−' if quantity < 0 else '+'} {pieces} {base_unit}"
    return f"{label} = {equivalence}"
