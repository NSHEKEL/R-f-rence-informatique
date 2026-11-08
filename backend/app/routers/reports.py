"""Sales reports: revenue broken down by day, payment, seller and article."""

from collections import defaultdict
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Product, Sale, SaleReturn, User
from ..permissions import has_permission, require_permission
from ..profits import line_revenue, unit_cost
from ..schemas import ReportRow, SalesReport
from ..units import quantity_label

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
    amounts: dict[str, float], quantities: dict[str, float] | None = None,
    units: dict | None = None,
) -> list[ReportRow]:
    return [
        ReportRow(
            label=label,
            amount=amount,
            quantity=(quantities or {}).get(label, 0),
            quantity_label=(quantity_label(int((quantities or {}).get(label, 0)), *next(iter(units[label]))) if len(units[label]) == 1 else f"{int((quantities or {}).get(label, 0))} unités de base (conditionnements variables)") if units and label in units else None,
        )
        for label, amount in sorted(
            amounts.items(), key=lambda pair: pair[1], reverse=True
        )
    ]


@router.get("/sales", response_model=SalesReport, dependencies=[
    Depends(require_permission("rapports_financiers", "soldes_consulter")),
])
def sales_report(
    start: str | None = None,
    end: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission("rapports")),
):
    period_start, period_end = _parse_range(start, end)

    sales = (
        db.query(Sale)
        .filter(
            Sale.date >= period_start,
            Sale.date <= period_end,
            Sale.status != "Annulée",
            Sale.is_gift.is_(False),
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
    product_units = defaultdict(set)

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
            product_units[item.product_name].add((item.base_unit, item.packaging_unit, item.units_per_packaging))

    credits = (db.query(SaleReturn)
        .filter(
            SaleReturn.date >= period_start, SaleReturn.date <= period_end
        )
        .all()
    )
    returns_total = sum(credit.total for credit in credits)
    profit_by_product = {}
    profit_by_sale = {}
    if has_permission(db, user, "rapports_financiers"):
        purchase_prices = {p.id: p.purchase_price or 0 for p in db.query(Product).all()}

        def add(group, key, label, revenue, cost):
            row = group.setdefault(key, dict(label=label, revenue=0.0, cost=0.0))
            row["revenue"] += revenue
            row["cost"] += cost

        for sale in sales:
            for item in sale.items:
                revenue = line_revenue(sale, item)
                cost = unit_cost(item, purchase_prices) * item.quantity
                add(profit_by_product, item.product_id or item.product_name, item.product_name, revenue, cost)
                add(profit_by_sale, sale.id, sale.reference, revenue, cost)
        for credit in credits:
            for item in credit.items:
                cost = unit_cost(item, purchase_prices) * item.quantity
                add(profit_by_product, item.product_id or item.product_name, item.product_name, -item.subtotal, -cost)
                add(profit_by_sale, credit.sale_id, credit.sale.reference, -item.subtotal, -cost)
        for group in (profit_by_product, profit_by_sale):
            for row in group.values():
                row["profit"] = row["revenue"] - row["cost"]
                row["margin"] = row["profit"] / row["revenue"] * 100 if row["revenue"] else 0.0

    days: list[ReportRow] = []
    cursor = period_start.date()
    while cursor <= period_end.date() and len(days) < 92:
        key = cursor.strftime("%d/%m")
        days.append(ReportRow(label=key, amount=by_day.get(key, 0)))
        cursor += timedelta(days=1)

    return SalesReport(
        profit_by_product=list(profit_by_product.values()),
        profit_by_sale=list(profit_by_sale.values()),
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
        by_product=_rows(by_product, product_qty, product_units)[:20],
    )
