from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Customer, Product, Sale, SaleItem, User
from ..schemas import (
    DashboardStats,
    MonthlyRevenue,
    TopProduct,
    TopSeller,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

MONTHS_FR = [
    "Jan", "Fév", "Mar", "Avr", "Mai", "Juin",
    "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
]


def _pct_change(current: float, previous: float) -> float:
    if previous == 0:
        return 100.0 if current > 0 else 0.0
    return round((current - previous) / previous * 100, 1)


def _period(
    start: Optional[datetime], end: Optional[datetime]
) -> tuple[datetime, datetime]:
    """Requested window, defaulting to the current year."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    period_end = datetime.combine(
        (end or now).date(), time.max
    )
    period_start = datetime.combine(
        (start or datetime(now.year, 1, 1)).date(), time.min
    )
    return period_start, period_end


@router.get("", response_model=DashboardStats)
def get_stats(
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    period_start, period_end = _period(start, end)

    products = db.query(Product).all()
    total_products = len(products)
    total_stock_value = sum(p.sale_price * p.quantity for p in products)
    low_stock_products = [p for p in products if p.quantity <= p.min_stock]
    total_customers = db.query(Customer).count()

    def in_period(sale: Sale) -> bool:
        return bool(sale.date and period_start <= sale.date <= period_end)

    all_sales = db.query(Sale).filter(Sale.status != "Annulée").all()
    sales = [s for s in all_sales if in_period(s)]
    total_sales = len(sales)
    total_revenue = sum(s.total for s in sales)

    # Same-length window right before the selected one, for the trend chips.
    span = period_end - period_start
    prev_start = period_start - span - timedelta(seconds=1)
    prev_sales = [
        s
        for s in all_sales
        if s.date and prev_start <= s.date < period_start
    ]
    revenue_change = _pct_change(total_revenue, sum(s.total for s in prev_sales))
    sales_change = _pct_change(total_sales, len(prev_sales))

    monthly = defaultdict(float)
    for s in sales:
        monthly[(s.date.year, s.date.month)] += s.total
    months: list[tuple[int, int]] = []
    cursor = (period_start.year, period_start.month)
    last = (period_end.year, period_end.month)
    while cursor <= last and len(months) < 24:
        months.append(cursor)
        year, month = cursor
        cursor = (year + 1, 1) if month == 12 else (year, month + 1)
    monthly_revenue = [
        MonthlyRevenue(
            month=MONTHS_FR[m - 1] if y == period_end.year else f"{MONTHS_FR[m - 1]} {y}",
            revenue=round(monthly.get((y, m), 0), 2),
        )
        for y, m in months
    ]

    sale_ids = {s.id for s in sales}
    agg = defaultdict(lambda: {"quantity": 0, "revenue": 0.0})
    items = (
        db.query(SaleItem)
        .join(Sale, SaleItem.sale_id == Sale.id)
        .filter(Sale.status != "Annulée")
        .all()
    )
    for it in items:
        if it.sale_id not in sale_ids:
            continue
        agg[it.product_name]["quantity"] += it.quantity
        agg[it.product_name]["revenue"] += it.subtotal
    top_products = sorted(
        (
            TopProduct(name=name, quantity=v["quantity"], revenue=round(v["revenue"], 2))
            for name, v in agg.items()
        ),
        key=lambda t: t.revenue,
        reverse=True,
    )[:5]

    # Ranking of the sellers/cashiers over the same period.
    sellers = defaultdict(lambda: {"count": 0, "revenue": 0.0})
    for s in sales:
        name = s.created_by.name if s.created_by else "Non attribué"
        sellers[name]["count"] += 1
        sellers[name]["revenue"] += s.total
    top_sellers = sorted(
        (
            TopSeller(
                name=name,
                sales_count=v["count"],
                revenue=round(v["revenue"], 2),
            )
            for name, v in sellers.items()
        ),
        key=lambda t: t.revenue,
        reverse=True,
    )[:5]

    recent_sales = sorted(sales, key=lambda s: s.date, reverse=True)[:5]

    return DashboardStats(
        total_products=total_products,
        total_stock_value=round(total_stock_value, 2),
        low_stock_count=len(low_stock_products),
        total_customers=total_customers,
        total_sales=total_sales,
        total_revenue=round(total_revenue, 2),
        revenue_change=revenue_change,
        sales_change=sales_change,
        monthly_revenue=monthly_revenue,
        recent_sales=recent_sales,
        top_products=top_products,
        top_sellers=top_sellers,
        low_stock_products=low_stock_products,
        period_start=period_start,
        period_end=period_end,
    )
