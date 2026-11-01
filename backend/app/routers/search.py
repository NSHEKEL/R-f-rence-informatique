"""Global search across the modules the caller may actually open.

Each section is only searched and returned when the user's role grants the
matching page right — a seller without the suppliers page never sees them.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Customer, Product, Sale, Supplier, User
from ..permissions import has_permission

router = APIRouter(prefix="/api/search", tags=["search"])

LIMIT = 5


def _like(column, needle: str):
    return column.ilike(f"%{needle}%")


@router.get("")
def global_search(
    q: str = Query(..., min_length=2, max_length=80),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    needle = q.strip()
    result: dict[str, list[dict]] = {}

    if has_permission(db, current_user, "produits"):
        products = (
            db.query(Product)
            .filter(
                or_(
                    _like(Product.name, needle),
                    _like(Product.sku, needle),
                    _like(Product.barcode, needle),
                )
            )
            .order_by(Product.name)
            .limit(LIMIT)
            .all()
        )
        result["products"] = [
            {
                "id": p.id,
                "name": p.name,
                "sku": p.sku,
                "quantity": p.quantity,
            }
            for p in products
        ]

    if has_permission(db, current_user, "clients"):
        customers = (
            db.query(Customer)
            .filter(
                or_(
                    _like(Customer.name, needle),
                    _like(Customer.phone, needle),
                )
            )
            .order_by(Customer.name)
            .limit(LIMIT)
            .all()
        )
        result["customers"] = [
            {"id": c.id, "name": c.name, "phone": c.phone}
            for c in customers
        ]

    if has_permission(db, current_user, "fournisseurs"):
        suppliers = (
            db.query(Supplier)
            .filter(
                or_(
                    _like(Supplier.name, needle),
                    _like(Supplier.phone, needle),
                )
            )
            .order_by(Supplier.name)
            .limit(LIMIT)
            .all()
        )
        result["suppliers"] = [
            {"id": s.id, "name": s.name, "phone": s.phone}
            for s in suppliers
        ]

    if has_permission(db, current_user, "ventes"):
        sales = (
            db.query(Sale)
            .filter(_like(Sale.reference, needle))
            .order_by(Sale.date.desc())
            .limit(LIMIT)
            .all()
        )
        result["sales"] = [
            {
                "id": s.id,
                "reference": s.reference,
                "total": s.total,
                "status": s.status,
            }
            for s in sales
        ]

    return result
