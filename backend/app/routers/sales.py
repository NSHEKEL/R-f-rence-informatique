from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_admin, require_cashier
from ..database import get_db
from ..models import (
    Notification,
    Product,
    Sale,
    SaleItem,
    StockMovement,
    User,
)
from ..schemas import SaleCreate, SaleOut, SaleUpdate
from ..sequences import next_reference
from .cash import current_session

router = APIRouter(prefix="/api/sales", tags=["sales"])


MAX_REFERENCE_ATTEMPTS = 5


def _generate_reference(db: Session) -> str:
    return next_reference(
        db, Sale.reference, f"VNT-{datetime.now(timezone.utc).year}-"
    )


@router.get("", response_model=list[SaleOut])
def list_sales(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.query(Sale).order_by(Sale.date.desc()).all()


@router.get("/by-reference/{reference}", response_model=SaleOut)
def get_sale_by_reference(
    reference: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Ticket lookup used by the returns screen."""
    sale = db.query(Sale).filter(Sale.reference == reference.strip()).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    return sale


@router.get("/{sale_id}", response_model=SaleOut)
def get_sale(
    sale_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    return sale


@router.post("", response_model=SaleOut, status_code=201)
def create_sale(
    payload: SaleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_cashier),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="Ajoutez au moins un article")

    if payload.client_id:
        # Replay of a ticket recorded offline: return the stored one.
        existing = (
            db.query(Sale).filter(Sale.client_id == payload.client_id).first()
        )
        if existing:
            return existing

    # Several workstations may checkout at the same time: retry when two of
    # them pick the same reference.
    for attempt in range(MAX_REFERENCE_ATTEMPTS):
        try:
            return _persist_sale(db, payload, current_user)
        except IntegrityError:
            db.rollback()
            if attempt == MAX_REFERENCE_ATTEMPTS - 1:
                raise HTTPException(
                    status_code=409,
                    detail="Caisse occupée, veuillez réessayer",
                )
    raise HTTPException(status_code=409, detail="Caisse occupée, veuillez réessayer")


def _persist_sale(db: Session, payload: SaleCreate, current_user: User) -> Sale:
    session = current_session(db, current_user)
    if session is None:
        raise HTTPException(
            status_code=400,
            detail="Ouvrez votre caisse avant d'enregistrer une vente",
        )
    sale = Sale(
        reference=_generate_reference(db),
        client_id=payload.client_id,
        customer_id=payload.customer_id,
        status=payload.status,
        payment_method=payload.payment_method,
        note=payload.note,
        price_mode="gros" if payload.price_mode == "gros" else "detail",
        created_by_id=current_user.id,
        cash_session_id=session.id,
        total=0,
    )
    total = 0.0
    low_stock: list[Product] = []
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
        unit_price = product.sale_price
        if sale.price_mode == "gros" and (product.wholesale_price or 0) > 0:
            unit_price = product.wholesale_price
        subtotal = unit_price * item.quantity
        total += subtotal
        sale.items.append(
            SaleItem(
                product_id=product.id,
                product_name=product.name,
                quantity=item.quantity,
                unit_price=unit_price,
                subtotal=subtotal,
            )
        )
        if payload.status != "Annulée":
            # Conditional update: keeps stock correct when two tills sell the
            # same product simultaneously.
            result = db.execute(
                update(Product)
                .where(
                    Product.id == product.id,
                    Product.quantity >= item.quantity,
                )
                .values(quantity=Product.quantity - item.quantity)
            )
            if result.rowcount == 0:
                db.rollback()
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuffisant pour {product.name}",
                )
            db.refresh(product)
            before = product.quantity + item.quantity
            db.add(
                StockMovement(
                    product_id=product.id,
                    product_name=product.name,
                    kind="vente",
                    quantity=-item.quantity,
                    stock_before=before,
                    stock_after=product.quantity,
                    reason=sale.reference,
                    created_by_id=current_user.id,
                )
            )
            if product.quantity <= product.min_stock:
                low_stock.append(product)

    sale.total = total
    db.add(sale)
    db.flush()

    if current_user.role != "admin":
        db.add(
            Notification(
                kind="vente",
                title=f"Nouvelle vente — {sale.reference}",
                message=(
                    f"{current_user.name} a enregistré une vente de "
                    f"{total:,.0f} FCFA ({payload.payment_method})".replace(
                        ",", " "
                    )
                ),
                link="/ventes",
                sale_id=sale.id,
            )
        )
    for product in low_stock:
        db.add(
            Notification(
                kind="stock",
                title=f"Stock faible — {product.name}",
                message=(
                    f"Il reste {product.quantity} unité(s) "
                    f"(seuil : {product.min_stock})"
                ),
                link="/produits",
            )
        )

    db.commit()
    db.refresh(sale)
    return sale


@router.post("/{sale_id}/print", response_model=SaleOut)
def register_print(
    sale_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Count receipt prints so reprints can be flagged as duplicates."""
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    sale.print_count = (sale.print_count or 0) + 1
    db.commit()
    db.refresh(sale)
    return sale


@router.put("/{sale_id}", response_model=SaleOut)
def update_sale(
    sale_id: int,
    payload: SaleUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Update editable receipt metadata (customer, payment, note, footer).

    Does not touch the sale items or stock.
    """
    sale = db.query(Sale).get(sale_id)
    if not sale:
        raise HTTPException(status_code=404, detail="Vente introuvable")
    data = payload.model_dump(exclude_unset=True)
    if "customer_id" in data:
        sale.customer_id = data["customer_id"]
    if "payment_method" in data and data["payment_method"] is not None:
        sale.payment_method = data["payment_method"]
    if "note" in data and data["note"] is not None:
        sale.note = data["note"]
    if "receipt_footer" in data and data["receipt_footer"] is not None:
        sale.receipt_footer = data["receipt_footer"]
    db.commit()
    db.refresh(sale)
    return sale


@router.delete("/{sale_id}", status_code=204)
def delete_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
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
                    before = product.quantity
                    product.quantity += item.quantity
                    db.add(
                        StockMovement(
                            product_id=product.id,
                            product_name=product.name,
                            kind="ajustement",
                            quantity=item.quantity,
                            stock_before=before,
                            stock_after=product.quantity,
                            reason=f"Annulation {sale.reference}",
                            created_by_id=current_user.id,
                        )
                    )
    db.query(Notification).filter(Notification.sale_id == sale.id).delete()
    db.delete(sale)
    db.commit()
