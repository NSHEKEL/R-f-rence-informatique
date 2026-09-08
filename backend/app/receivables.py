"""Balances left on delivered orders and received supplies.

Once the goods have changed hands the amount still due is no longer edited on
the order itself: it becomes an entry of Dettes & créances, settled payment
after payment, so nothing of the history can be rewritten afterwards.
"""

from sqlalchemy.orm import Session

from .models import Debt, Order, Purchase, User


def _exists(db: Session, kind: str, reference: str) -> bool:
    return (
        db.query(Debt)
        .filter(Debt.kind == kind, Debt.reference == reference)
        .first()
        is not None
    )


def open_order_receivable(db: Session, order: Order, current_user: User) -> None:
    """What the customer still owes on a delivered order."""
    balance = order.balance
    if balance <= 0 or _exists(db, "creance", order.reference):
        return
    db.add(
        Debt(
            kind="creance",
            party=order.customer_name or "Client de passage",
            customer_id=order.customer_id,
            reference=order.reference,
            amount=balance,
            due_date=order.expected_date,
            note=f"Reste à payer sur la commande {order.reference}",
            created_by_id=current_user.id,
        )
    )


def open_purchase_payable(
    db: Session, purchase: Purchase, current_user: User
) -> None:
    """What the shop still owes its supplier on a received supply."""
    balance = purchase.balance
    if balance <= 0 or _exists(db, "dette", purchase.reference):
        return
    db.add(
        Debt(
            kind="dette",
            party=purchase.supplier_name or "Fournisseur",
            supplier_id=purchase.supplier_id,
            reference=purchase.reference,
            amount=balance,
            due_date=purchase.expected_date,
            note=f"Reste à payer sur l'approvisionnement {purchase.reference}",
            created_by_id=current_user.id,
        )
    )
