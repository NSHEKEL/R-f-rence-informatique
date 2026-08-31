"""Sales reports: revenue broken down by day, payment, seller and article."""

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, Sale, SaleReturn, User
from ..permissions import require_permission
from ..schemas import ReportRow, SalesReport

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _parse_range(start: str | None, end: str | None) -> tuple[datetime, datetime]:
    today = datetime.now(timezone.utc).date()
    try:
        start_date = (
            datetime.fromisoformat(start).date()
            if start
            else today - timedelta(days=29)
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


def _rows(
    amounts: dict[str, float], quantities: dict[str, float] | None = None
) -> list[ReportRow]:
    return [
        ReportRow(
            label=label,
            amount=amount,
            quantity=(quantities or {}).get(label, 0),
        )
        for label, amount in sorted(
            amounts.items(), key=lambda pair: pair[1], reverse=True
        )
    ]


@router.get("/sales", response_model=SalesReport)
def sales_report(
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission("rapports")),
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
    categories = {
        p.id: (p.category.name if p.category else "Sans catégorie")
        for p in db.query(Product).all()
    }

    revenue = 0.0
    by_day: dict[str, float] = defaultdict(float)
    by_payment: dict[str, float] = defaultdict(float)
    by_seller: dict[str, float] = defaultdict(float)
    seller_tickets: dict[str, float] = defaultdict(float)
    by_category: dict[str, float] = defaultdict(float)
    category_qty: dict[str, float] = defaultdict(float)
    by_product: dict[str, float] = defaultdict(float)
    product_qty: dict[str, float] = defaultdict(float)

    for sale in sales:
        revenue += sale.total
        by_day[sale.date.strftime("%d/%m")] += sale.total
        by_payment[sale.payment_method] += sale.total
        seller = sale.created_by.name if sale.created_by else "Inconnu"
        by_seller[seller] += sale.total
        seller_tickets[seller] += 1
        for item in sale.items:
            category = categories.get(item.product_id, "Sans catégorie")
            by_category[category] += item.subtotal
            category_qty[category] += item.quantity
            by_product[item.product_name] += item.subtotal
            product_qty[item.product_name] += item.quantity

    returns_total = sum(
        credit.total
        for credit in db.query(SaleReturn)
        .filter(
            SaleReturn.date >= period_start, SaleReturn.date <= period_end
        )
        .all()
    )

    days: list[ReportRow] = []
    cursor = period_start.date()
    while cursor <= period_end.date() and len(days) < 92:
        key = cursor.strftime("%d/%m")
        days.append(ReportRow(label=key, amount=by_day.get(key, 0)))
        cursor += timedelta(days=1)

    return SalesReport(
        period_start=period_start,
        period_end=period_end,
        sales_count=len(sales),
        revenue=revenue,
        returns_total=returns_total,
        net_revenue=revenue - returns_total,
        average_ticket=revenue / len(sales) if sales else 0,
        by_day=days,
        by_payment=_rows(by_payment),
        by_seller=_rows(by_seller, seller_tickets),
        by_category=_rows(by_category, category_qty),
        by_product=_rows(by_product, product_qty)[:20],
    )
