from collections import defaultdict
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Expense, Product, Sale, SaleReturn, User
from ..permissions import require_permission
from ..schemas import (
    AccountingCategory,
    AccountingSummary,
    ExpenseCreate,
    ExpenseOut,
)

router = APIRouter(prefix="/api/accounting", tags=["accounting"])


def _parse_range(start: str | None, end: str | None) -> tuple[datetime, datetime]:
    today = datetime.now(timezone.utc).date()
    try:
        start_date = (
            datetime.fromisoformat(start).date()
            if start
            else today.replace(day=1)
        )
        end_date = datetime.fromisoformat(end).date() if end else today
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates invalides")
    if end_date < start_date:
        raise HTTPException(
            status_code=400, detail="La date de fin précède la date de début"
        )
    return (
        datetime.combine(start_date, time.min),
        datetime.combine(end_date, time.max),
    )


@router.get("/summary", response_model=AccountingSummary)
def summary(
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("comptabilite")),
):
    period_start, period_end = _parse_range(start, end)

    sales = (
        db.query(Sale)
        .filter(
            Sale.date >= period_start,
            Sale.date <= period_end,
            Sale.status != "Annulée",
        )
        .all()
    )
    purchase_prices = {
        p.id: p.purchase_price for p in db.query(Product).all()
    }

    revenue = 0.0
    cost = 0.0
    by_payment: dict[str, float] = defaultdict(float)
    by_day: dict[str, float] = defaultdict(float)
    for sale in sales:
        revenue += sale.total
        by_payment[sale.payment_method] += sale.total
        by_day[sale.date.strftime("%d/%m")] += sale.total
        for item in sale.items:
            cost += purchase_prices.get(item.product_id, 0) * item.quantity

    # Credit notes reduce both the revenue and the cost of goods sold.
    credits = (
        db.query(SaleReturn)
        .filter(SaleReturn.date >= period_start, SaleReturn.date <= period_end)
        .all()
    )
    returns_total = sum(c.total for c in credits)
    for credit in credits:
        revenue -= credit.total
        by_payment["Retours"] -= credit.total
        by_day[credit.date.strftime("%d/%m")] -= credit.total
        for item in credit.items:
            cost -= purchase_prices.get(item.product_id, 0) * item.quantity

    expenses = (
        db.query(Expense)
        .filter(Expense.date >= period_start, Expense.date <= period_end)
        .all()
    )
    expenses_total = sum(e.amount for e in expenses)
    by_category: dict[str, float] = defaultdict(float)
    for expense in expenses:
        by_category[expense.category or "Divers"] += expense.amount

    days: list[AccountingCategory] = []
    cursor = period_start.date()
    while cursor <= period_end.date() and len(days) < 62:
        key = cursor.strftime("%d/%m")
        days.append(AccountingCategory(name=key, amount=by_day.get(key, 0)))
        cursor += timedelta(days=1)

    gross_margin = revenue - cost
    return AccountingSummary(
        period_start=period_start,
        period_end=period_end,
        revenue=revenue,
        cost_of_goods=cost,
        gross_margin=gross_margin,
        expenses_total=expenses_total,
        net_profit=gross_margin - expenses_total,
        sales_count=len(sales),
        returns_total=returns_total,
        revenue_by_payment=[
            AccountingCategory(name=k, amount=v) for k, v in by_payment.items()
        ],
        expenses_by_category=[
            AccountingCategory(name=k, amount=v) for k, v in by_category.items()
        ],
        daily_revenue=days,
    )


@router.get("/expenses", response_model=list[ExpenseOut])
def list_expenses(
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("comptabilite")),
):
    return db.query(Expense).order_by(Expense.date.desc()).limit(limit).all()


@router.post("/expenses", response_model=ExpenseOut, status_code=201)
def create_expense(
    payload: ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("comptabilite")),
):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Montant invalide")
    expense = Expense(
        label=payload.label,
        category=payload.category or "Divers",
        amount=payload.amount,
        date=payload.date or datetime.now(timezone.utc),
        note=payload.note,
        created_by_id=current_user.id,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/expenses/{expense_id}", status_code=204)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("comptabilite")),
):
    expense = db.query(Expense).get(expense_id)
    if not expense:
        raise HTTPException(status_code=404, detail="Dépense introuvable")
    db.delete(expense)
    db.commit()
