import urllib.parse
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    Product,
    StockMovement,
    StockTransfer,
    StockTransferItem,
    User,
)
from ..permissions import require_permission
from ..schemas import (
    StockTransferCreate,
    StockTransferItemCreate,
    StockTransferOut,
)
from ..sequences import next_reference

router = APIRouter(prefix="/api/transfers", tags=["transfers"])

DIRECTIONS = ("sortie", "entree")


def _reference(db: Session) -> str:
    return next_reference(
        db,
        StockTransfer.reference,
        f"TFR-{datetime.now(timezone.utc).year}-",
    )


@router.get("", response_model=list[StockTransferOut])
def list_transfers(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("stocks")),
):
    return (
        db.query(StockTransfer)
        .order_by(StockTransfer.created_at.desc())
        .limit(200)
        .all()
    )


@router.post("", response_model=StockTransferOut, status_code=201)
def create_transfer(
    payload: StockTransferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stocks")),
):
    """Record an inter-store transfer and move the stock in one shot.

    'sortie' removes stock (guard: never below zero, same conditional update
    as the till); 'entree' adds it. Both write 'transfert' movements so the
    history explains the change.
    """
    if payload.direction not in DIRECTIONS:
        raise HTTPException(status_code=400, detail="Direction invalide")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Aucune ligne")
    store = payload.store_name.strip()
    if not store:
        raise HTTPException(status_code=400, detail="Magasin requis")

    leaving = payload.direction == "sortie"
    transfer = StockTransfer(
        reference=_reference(db),
        direction=payload.direction,
        store_name=store,
        note=payload.note.strip(),
        created_by_id=current_user.id,
    )
    arrow = "→" if leaving else "←"
    for line in payload.items:
        if line.quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantité invalide")
        product = db.query(Product).get(line.product_id)
        if not product:
            raise HTTPException(
                status_code=404,
                detail=f"Produit {line.product_id} introuvable",
            )
        before = product.quantity
        if leaving:
            result = db.execute(
                update(Product)
                .where(
                    Product.id == product.id,
                    Product.quantity >= line.quantity,
                )
                .values(quantity=Product.quantity - line.quantity)
            )
            if result.rowcount == 0:
                db.rollback()
                raise HTTPException(
                    status_code=400,
                    detail=f"Stock insuffisant pour {product.name}",
                )
            db.refresh(product)
        else:
            product.quantity += line.quantity
        db.add(
            StockMovement(
                product_id=product.id,
                product_name=product.name,
                kind="transfert",
                quantity=-line.quantity if leaving else line.quantity,
                stock_before=before,
                stock_after=product.quantity,
                reason=f"Transfert {arrow} {store} ({transfer.reference})",
                created_by_id=current_user.id,
            )
        )
        transfer.items.append(
            StockTransferItem(
                product_id=product.id,
                product_name=product.name,
                quantity=line.quantity,
            )
        )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    if leaving:
        _relay_to_central(db, transfer)
    return transfer


# ---------- Relais via le serveur central ----------

def _central_base(db: Session) -> tuple[str, str, str]:
    """(base url, installation uid, token) or ("", "", "") when not linked."""
    try:
        from .. import licensing

        row = licensing.state(db)
        if row is None or not row.token:
            return "", "", ""
        base = (row.central_url or licensing.central_url()).rstrip("/")
        return base, row.installation_uid or "", row.token
    except Exception:
        return "", "", ""


def _relay_to_central(db: Session, transfer: StockTransfer) -> None:
    """Best effort: the emission reaches the destination shop through the
    central service. A shop offline keeps working — nothing is lost."""
    base, uid, token = _central_base(db)
    if not base:
        return
    try:
        from .. import licensing

        licensing._post(  # noqa: SLF001 - same module family
            f"{base}/api/central/public/transfers",
            {
                "installation_uid": uid,
                "token": token,
                "reference": transfer.reference,
                "to_shop": transfer.store_name,
                "note": transfer.note,
                "items": [
                    {"product_name": i.product_name, "quantity": i.quantity}
                    for i in transfer.items
                ],
            },
        )
    except Exception as exc:  # noqa: BLE001 - best effort only
        print(f"Relais central du transfert impossible : {exc}")


@router.get("/entrantes")
def incoming(
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("stocks")),
):
    """Shipments the central service holds for this shop."""
    base, uid, token = _central_base(db)
    if not base:
        return []
    from .. import licensing
    from ..models import CompanySettings

    company = db.query(CompanySettings).first()
    shop = (company.name if company else "").strip()
    if not shop:
        return []
    try:
        rows = licensing._get(  # noqa: SLF001
            f"{base}/api/central/public/transfers"
            f"?installation_uid={uid}&token={token}"
            f"&shop={urllib.parse.quote(shop)}"
        )
        return rows if isinstance(rows, list) else []
    except Exception as exc:  # noqa: BLE001
        print(f"Réceptions en attente illisibles : {exc}")
        return []


@router.post("/recevoir", response_model=StockTransferOut, status_code=201)
def receive_pending(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("stocks")),
):
    """Turn a pending shipment into a local 'entree' transfer."""
    central_id = int(payload.get("central_id") or 0)
    if not central_id:
        raise HTTPException(status_code=400, detail="Identifiant manquant")
    base, uid, token = _central_base(db)
    if not base:
        raise HTTPException(status_code=400, detail="Serveur central non lié")
    # Local reception first: the relay on the central is only closed once
    # the goods actually moved into this shop's stock.
    items_payload = payload.get("items") or []
    store = str(payload.get("from_shop") or "—")
    local = StockTransferCreate(
        direction="entree",
        store_name=store,
        note=str(payload.get("note") or ""),
        items=[
            StockTransferItemCreate(
                product_id=int(i["product_id"]), quantity=int(i["quantity"])
            )
            for i in items_payload
            if i.get("product_id") and int(i.get("quantity") or 0) > 0
        ],
    )
    result = create_transfer(local, db=db, current_user=current_user)
    from .. import licensing

    try:
        licensing._post(  # noqa: SLF001
            f"{base}/api/central/public/transfers/{central_id}/received",
            {"installation_uid": uid, "token": token},
        )
    except Exception as exc:  # noqa: BLE001
        # Stock already arrived; the pending relay will just be shown again.
        print(f"Clôture du relais central impossible : {exc}")
    return result
