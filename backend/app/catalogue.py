from fastapi import HTTPException


def require_active(product):
    if product is None:
        raise HTTPException(400, "Article introuvable")
    if not product.active:
        raise HTTPException(400, f"L'article « {product.name} » est désactivé : réactivez-le avant une nouvelle opération")
