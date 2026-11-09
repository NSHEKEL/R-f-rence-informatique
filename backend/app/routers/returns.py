from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import remote_sales
from ..database import get_db
from .. import stock
from ..models import (
    Notification,
    Product,
    Sale,
    SaleReturn,
    SaleReturnItem,
    StockMovement,
    User,
)
from ..permissions import has_permission, require_permission
from ..schemas import ReturnCreate, ReturnOut
from ..sequences import next_reference
from .cash import lock_current_session
from ..units import base_quantity, snapshot
from ..profits import line_revenue, line_returns

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
    lines = [line for line in payload.lines if line.quantity > 0 or (line.packaging_quantity or 0) > 0 or (line.piece_quantity or 0) > 0]
    if not lines:
        raise HTTPException(status_code=400, detail="Aucun article à retourner")

    if payload.refund_method == "Espèces" and not has_permission(db, current_user, "caisse_operations"):
        raise HTTPException(status_code=403, detail="Accès refusé : sortie de caisse")
    session = lock_current_session(db, current_user)
    if payload.refund_method == "Espèces" and session is None:
        raise HTTPException(status_code=400, detail="Ouvrez votre caisse avant un remboursement en espèces")
    credit = SaleReturn(
        cash_session_id=session.id if session else None,
        refund_method=payload.refund_method,
        reference=_generate_reference(db),
        sale_id=sale.id,
        reason=payload.reason,
        created_by_id=current_user.id,
        total=0,
    )
    total = 0.0
    seen = set()
    for line in lines:
        candidates = [i for i in sale.items if i.product_id == line.product_id and (line.sale_item_id is None or i.id == line.sale_item_id)]
        if len(candidates) > 1:
            raise HTTPException(status_code=400, detail="Précisez la ligne du ticket à retourner")
        item = candidates[0] if candidates else None
        if not item:
            raise HTTPException(
                status_code=400,
                detail=f"L'article {line.product_id} n'est pas sur ce ticket",
            )
        if item.id in seen:
            raise HTTPException(status_code=400, detail="Ligne de retour répétée")
        seen.add(item.id)
        remaining = item.quantity - item.returned_quantity
        quantity = base_quantity(line, item)
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        line = line.model_copy(update={"quantity": quantity})
        if line.quantity > remaining:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"{item.product_name} : {remaining} unité(s) retournable(s) "
                    f"seulement"
                ),
            )
        subtotal = item.unit_price * line.quantity
        if line.packaging_quantity is not None or line.piece_quantity is not None:
            subtotal = (line.packaging_quantity or 0) * (item.packaging_sale_price if item.packaging_sale_price is not None else item.unit_price * (item.units_per_packaging or 1)) + (line.piece_quantity or 0) * (item.base_unit_price if item.base_unit_price is not None else item.unit_price)
        gross = item.unit_price * item.quantity
        net = line_revenue(sale, item)
        subtotal = subtotal * net / gross if gross else 0
        refunded = sum(returned.subtotal for returned in line_returns(sale, item))
        subtotal = min(subtotal, max(0, net - refunded))
        total += subtotal
        credit.items.append(
            SaleReturnItem(
                sale_item_id=item.id,
                unit_cost=item.unit_cost,
                **snapshot(item),
                product_id=item.product_id,
                product_name=item.product_name,
                quantity=line.quantity,
                unit_price=subtotal / quantity,
                subtotal=subtotal,
            )
        )
        product = (
            db.query(Product).get(item.product_id) if item.product_id else None
        )
        if product:
            before, after = stock.adjust(db, product, line.quantity)
            db.add(
                StockMovement(
                    depot_id=stock.resolve(db),
                    **snapshot(item),
                    product_id=product.id,
                    product_name=product.name,
                    kind="retour",
                    quantity=line.quantity,
                    stock_before=before,
                    stock_after=after,
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
    remote_sales.schedule()
    return credit
