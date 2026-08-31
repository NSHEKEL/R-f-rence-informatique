from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Notification,
    Product,
    Sale,
    SaleReturn,
    SaleReturnItem,
    StockMovement,
    User,
)
from ..permissions import require_permission
from ..schemas import ReturnCreate, ReturnOut
from ..sequences import next_reference

router = APIRouter(prefix="/api/returns", tags=["returns"])


def _generate_reference(db: Session) -> str:
    return next_reference(
        db, SaleReturn.reference, f"AVR-{datetime.now(timezone.utc).year}-"
    )


@router.get("", response_model=list[ReturnOut])
def list_returns(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("retours")),
):
    return db.query(SaleReturn).order_by(SaleReturn.date.desc()).all()


@router.post("", response_model=ReturnOut, status_code=201)
def create_return(
    payload: ReturnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("retours")),
):
    """Credit note for goods given back, based on the original ticket."""
    reference = payload.sale_reference.strip()
    sale = db.query(Sale).filter(Sale.reference == reference).first()
    if not sale:
        raise HTTPException(
            status_code=404, detail=f"Ticket {reference} introuvable"
        )
    lines = [line for line in payload.lines if line.quantity > 0]
    if not lines:
        raise HTTPException(status_code=400, detail="Aucun article à retourner")

    credit = SaleReturn(
        reference=_generate_reference(db),
        sale_id=sale.id,
        reason=payload.reason,
        created_by_id=current_user.id,
        total=0,
    )
    total = 0.0
    for line in lines:
        item = next(
            (i for i in sale.items if i.product_id == line.product_id), None
        )
        if not item:
            raise HTTPException(
                status_code=400,
                detail=f"L'article {line.product_id} n'est pas sur ce ticket",
            )
        remaining = item.quantity - item.returned_quantity
        if line.quantity > remaining:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{item.product_name} : {remaining} unité(s) retournable(s) "
                    f"seulement"
                ),
            )
        subtotal = item.unit_price * line.quantity
        total += subtotal
        credit.items.append(
            SaleReturnItem(
                product_id=item.product_id,
                product_name=item.product_name,
                quantity=line.quantity,
                unit_price=item.unit_price,
                subtotal=subtotal,
            )
        )
        product = (
            db.query(Product).get(item.product_id) if item.product_id else None
        )
        if product:
            before = product.quantity
            product.quantity = before + line.quantity
            db.add(
                StockMovement(
                    product_id=product.id,
                    product_name=product.name,
                    kind="retour",
                    quantity=line.quantity,
                    stock_before=before,
                    stock_after=product.quantity,
                    reason=f"Retour {sale.reference}",
                    created_by_id=current_user.id,
                )
            )

    credit.total = total
    db.add(credit)
    db.flush()
    db.add(
        Notification(
            kind="retour",
            title=f"Avoir {credit.reference} — ticket {sale.reference}",
            message=(
                f"{current_user.name} a enregistré un retour de "
                f"{total:,.0f} FCFA".replace(",", " ")
            ),
            link="/retours",
            sale_id=sale.id,
        )
    )
    db.commit()
    db.refresh(credit)
    return credit
