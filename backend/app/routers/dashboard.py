from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Customer, Product, Sale, SaleItem, User
from ..schemas import (
    DashboardStats,
    MonthlyRevenue,
    TopProduct,
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


@router.get("", response_model=DashboardStats)
def get_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    products = db.query(Product).all()
    total_products = len(products)
    total_stock_value = sum(p.sale_price * p.quantity for p in products)
    low_stock_products = [p for p in products if p.quantity <= p.min_stock]
    total_customers = db.query(Customer).count()

    sales = db.query(Sale).filter(Sale.status != "Annulée").all()
    total_sales = len(sales)
    total_revenue = sum(s.total for s in sales)

    now = datetime.now(timezone.utc)
    current_year = now.year

    # monthly revenue for current year
    monthly = defaultdict(float)
    for s in sales:
        if s.date and s.date.year == current_year:
            monthly[s.date.month] += s.total
    monthly_revenue = [
        MonthlyRevenue(month=MONTHS_FR[m - 1], revenue=round(monthly.get(m, 0), 2))
        for m in range(1, 13)
    ]

    # current vs previous month change
    cur_month_rev = monthly.get(now.month, 0)
    prev_month = now.month - 1 or 12
    prev_month_rev = monthly.get(prev_month, 0)
    revenue_change = _pct_change(cur_month_rev, prev_month_rev)

    cur_month_sales = sum(
        1 for s in sales if s.date and s.date.year == current_year and s.date.month == now.month
    )
    prev_month_sales = sum(
        1 for s in sales if s.date and s.date.year == current_year and s.date.month == prev_month
    )
    sales_change = _pct_change(cur_month_sales, prev_month_sales)

    # top products by revenue
    agg = defaultdict(lambda: {"quantity": 0, "revenue": 0.0})
    items = (
        db.query(SaleItem)
        .join(Sale, SaleItem.sale_id == Sale.id)
        .filter(Sale.status != "Annulée")
        .all()
    )
    for it in items:
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

    recent_sales = db.query(Sale).order_by(Sale.date.desc()).limit(5).all()

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
        low_stock_products=low_stock_products,
    )
