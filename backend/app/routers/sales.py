from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Product, Sale, SaleItem, User
from ..schemas import SaleCreate, SaleOut

router = APIRouter(prefix="/api/sales", tags=["sales"])


def _generate_reference(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    count = db.query(Sale).count() + 1
    return f"VNT-{year}-{count:04d}"


@router.get("", response_model=list[SaleOut])
def list_sales(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Sale).order_by(Sale.date.desc()).all()


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(
    sale_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    return sale


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(
    payload: SaleCreate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins un article")

    sale = Sale(
        reference=_generate_reference(db),
        customer_id=payload.customer_id,
        status=payload.status,
        payment_method=payload.payment_method,
        total=0,
    )
    total = 0.0
    for item in payload.items:
        product = db.query(Product).get(item.product_id)
        if not product:
            raise HTTPException(
                status_code=404, detail=f"Produit {item.product_id} introuvable"
            )
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        if product.quantity < item.quantity:
            raise HTTPException(
                status_code=400,
                detail=f"Stock insuffisant pour {product.name} "
                f"(disponible : {product.quantity})",
            )
        subtotal = product.sale_price * item.quantity
        total += subtotal
        sale.items.append(
            SaleItem(
                product_id=product.id,
                product_name=product.name,
                quantity=item.quantity,
                unit_price=product.sale_price,
                subtotal=subtotal,
            )
        )
        if payload.status != "Annulée":
            product.quantity -= item.quantity

    sale.total = total
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


@router.delete("/{sale_id}", status_code=204)
def delete_sale(
    sale_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)
):
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    # restock if the sale had decremented stock
    if sale.status != "Annulée":
        for item in sale.items:
            if item.product_id:
                product = db.query(Product).get(item.product_id)
                if product:
                    product.quantity += item.quantity
    db.delete(sale)
    db.commit()
