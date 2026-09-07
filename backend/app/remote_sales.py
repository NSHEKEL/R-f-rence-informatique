"""Push a read-only copy of the shop to the central server.

It lets the owner of a shop consult his sales from his phone, wherever he is,
without exposing the shop computer on the internet: the shop is the one that
calls out, and the phone reads the copy through the central API.

Nothing is ever read back from the central copy into the shop database.
"""

import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from . import licensing
from .database import SessionLocal
from .models import Sale, User

# Window of sales kept on the central server for the phone.
MIRROR_DAYS = 120
MIRROR_LIMIT = 500

# Short pause before publishing a fresh sale: several receipts printed in a row
# then travel in a single call.
PUSH_DELAY_SECONDS = 2.0

_pending = threading.Lock()
_scheduled = False


def _sales(db: Session) -> list[dict]:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        days=MIRROR_DAYS
    )
    rows = (
        db.query(Sale)
        .filter(Sale.date >= since)
        .order_by(Sale.date.desc())
        .limit(MIRROR_LIMIT)
        .all()
    )
    copies = []
    for sale in rows:
        seller = sale.created_by
        copies.append(
            {
                "reference": sale.reference,
                "date": sale.date.isoformat() if sale.date else None,
                "total": sale.total or 0,
                "status": sale.status or "",
                "payment_method": sale.payment_method or "",
                "customer": sale.customer.name if sale.customer else "",
                "seller": seller.name if seller else "",
                "seller_email": seller.email if seller else "",
                "items": [
                    {
                        "name": item.product_name,
                        "quantity": item.quantity,
                        "unit_price": item.unit_price,
                        "subtotal": item.subtotal,
                    }
                    for item in sale.items
                ],
            }
        )
    return copies


def _users(db: Session) -> list[dict]:
    return [
        {
            "email": user.email,
            "name": user.name,
            "role": user.role or "",
            "hashed_password": user.hashed_password,
            "is_active": bool(user.is_active),
        }
        for user in db.query(User).all()
    ]


def push(db: Session) -> dict:
    """Send accounts and recent sales; returns the shop's phone code."""
    row = licensing.state(db)
    if row is None or not row.token:
        raise licensing.CentralError("Cette installation n'est pas enregistrée.")
    base = (row.central_url or licensing.central_url()).rstrip("/")
    if not base:
        raise licensing.CentralError("Adresse du serveur central manquante")
    return licensing._post(  # noqa: SLF001 - same module family
        f"{base}/api/central/public/mirror",
        {
            "installation_uid": row.installation_uid,
            "token": row.token,
            "users": _users(db),
            "sales": _sales(db),
        },
    )


def push_quietly(db: Session) -> None:
    """Background copy: a network outage must never disturb the counter."""
    try:
        push(db)
    except Exception as exc:  # noqa: BLE001 - best effort only
        print(f"Copie distante impossible : {exc}")


def _publish_soon() -> None:
    global _scheduled

    time.sleep(PUSH_DELAY_SECONDS)
    with _pending:
        _scheduled = False
    db = SessionLocal()
    try:
        if licensing.effective(db).allows("synchronisation"):
            push_quietly(db)
    except Exception as exc:  # noqa: BLE001 - best effort only
        print(f"Copie distante impossible : {exc}")
    finally:
        db.close()


def schedule() -> None:
    """Publish just after a sale, so the phone shows it within seconds.

    Waiting for the periodic loop meant up to ten minutes; the copy now leaves
    on its own thread and a network outage never delays the counter.
    """
    global _scheduled

    with _pending:
        if _scheduled:
            return
        _scheduled = True
    threading.Thread(target=_publish_soon, daemon=True).start()
