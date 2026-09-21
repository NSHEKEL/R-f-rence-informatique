"""Balances left on delivered orders and received supplies.

Once the goods have changed hands the amount still due is no longer edited on
the order itself: it becomes an entry of Dettes & créances, settled payment
after payment, so nothing of the history can be rewritten afterwards.
"""

from sqlalchemy.orm import Session

from .models import Debt, DebtPayment, Order, Purchase, User, utcnow
from .sequences import next_reference


def receipt_reference(db: Session) -> str:
    """Payment receipts are numbered RP-YYYY-000001, once and for all."""
    return next_reference(
        db, DebtPayment.receipt_reference, f"RP-{utcnow().year}-", 6
    )


def _find(db: Session, kind: str, reference: str) -> Debt | None:
    return (
        db.query(Debt)
        .filter(Debt.kind == kind, Debt.reference == reference)
        .first()
    )


def _exists(db: Session, kind: str, reference: str) -> bool:
    return _find(db, kind, reference) is not None


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


def settle_order_receivable(
    db: Session,
    order: Order,
    method: str,
    current_user: User,
    amount: float | None = None,
) -> None:
    """Book money handed over at the door as a real settlement.

    Nothing is written on the order itself: the payment lands in Dettes &
    créances like any other, with its receipt and its history. Without an
    amount the whole balance is settled.
    """
    db.flush()
    debt = _find(db, "creance", order.reference)
    if debt is None or debt.remaining <= 0.009:
        return
    due = debt.remaining if amount is None else min(amount, debt.remaining)
    if due <= 0.009:
        return
    debt.payments.append(
        DebtPayment(
            amount=round(due, 2),
            method=method or "Espèces",
            note=f"Règlement à la livraison de la commande {order.reference}",
            receipt_reference=receipt_reference(db),
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
