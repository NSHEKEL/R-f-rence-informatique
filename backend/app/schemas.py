from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    role: str
    is_active: bool = True


class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: str = "vendeur"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None


# ---------- Company settings ----------
class CompanySettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slogan: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    website: str = ""
    tax_id: str = ""
    currency: str = "FCFA"
    receipt_header: str = ""
    receipt_footer: str = ""
    receipt_format: str = "A4"


class CompanySettingsUpdate(BaseModel):
    name: Optional[str] = None
    slogan: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    tax_id: Optional[str] = None
    currency: Optional[str] = None
    receipt_header: Optional[str] = None
    receipt_footer: Optional[str] = None
    receipt_format: Optional[str] = None


# ---------- Category ----------
class CategoryBase(BaseModel):
    name: str
    description: str = ""


class CategoryCreate(CategoryBase):
    pass


class CategoryOut(CategoryBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Supplier ----------
class SupplierBase(BaseModel):
    name: str
    contact: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""


class SupplierCreate(SupplierBase):
    pass


class SupplierOut(SupplierBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Customer ----------
class CustomerBase(BaseModel):
    name: str
    email: str = ""
    phone: str = ""
    address: str = ""


class CustomerCreate(CustomerBase):
    pass


class CustomerOut(CustomerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Product ----------
class ProductBase(BaseModel):
    name: str
    sku: str
    description: str = ""
    category_id: Optional[int] = None
    supplier_id: Optional[int] = None
    purchase_price: float = 0
    sale_price: float = 0
    quantity: int = 0
    min_stock: int = 5


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductBase):
    pass


class ProductOut(ProductBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    category: Optional[CategoryOut] = None
    supplier: Optional[SupplierOut] = None


# ---------- Sales ----------
class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    payment_method: str = "Espèces"
    status: str = "Payée"
    note: str = ""
    items: List[SaleItemCreate]


class SaleUpdate(BaseModel):
    customer_id: Optional[int] = None
    payment_method: Optional[str] = None
    note: Optional[str] = None
    receipt_footer: Optional[str] = None


class SaleItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class SaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    customer_id: Optional[int]
    customer: Optional[CustomerOut] = None
    date: datetime
    total: float
    status: str
    payment_method: str
    note: str = ""
    receipt_footer: str = ""
    created_by: Optional[UserOut] = None
    items: List[SaleItemOut] = []


# ---------- Dashboard ----------
class MonthlyRevenue(BaseModel):
    month: str
    revenue: float


class TopProduct(BaseModel):
    name: str
    quantity: int
    revenue: float


class DashboardStats(BaseModel):
    total_products: int
    total_stock_value: float
    low_stock_count: int
    total_customers: int
    total_sales: int
    total_revenue: float
    revenue_change: float
    sales_change: float
    monthly_revenue: List[MonthlyRevenue]
    recent_sales: List[SaleOut]
    top_products: List[TopProduct]
    low_stock_products: List[ProductOut]


# ---------- Notifications ----------
class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    title: str
    message: str = ""
    link: str = ""
    sale_id: Optional[int] = None
    is_read: bool
    created_at: datetime


# ---------- Cash sessions ----------
class CashSessionOpen(BaseModel):
    opening_balance: float = 0
    note: str = ""


class CashSessionClose(BaseModel):
    closing_balance: float = 0
    note: str = ""


class CashSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    opened_at: datetime
    opened_by: Optional[UserOut] = None
    opening_balance: float
    closed_at: Optional[datetime] = None
    closed_by: Optional[UserOut] = None
    closing_balance: Optional[float] = None
    expected_balance: Optional[float] = None
    difference: Optional[float] = None
    note: str = ""


class CashSessionDetail(CashSessionOut):
    """Open session enriched with live totals."""

    cash_sales: float = 0
    other_sales: float = 0
    sales_count: int = 0
    expected_cash: float = 0


# ---------- Expenses ----------
class ExpenseCreate(BaseModel):
    label: str
    category: str = "Divers"
    amount: float = 0
    date: Optional[datetime] = None
    note: str = ""


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    category: str
    amount: float
    date: datetime
    note: str = ""
    created_by: Optional[UserOut] = None


# ---------- Inventory ----------
class InventoryLine(BaseModel):
    product_id: int
    counted_quantity: int


class InventoryApply(BaseModel):
    lines: List[InventoryLine]
    note: str = ""


class StockMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    kind: str
    quantity: int
    stock_before: int
    stock_after: int
    reason: str = ""
    date: datetime
    created_by: Optional[UserOut] = None


# ---------- Accounting ----------
class AccountingCategory(BaseModel):
    name: str
    amount: float


class AccountingSummary(BaseModel):
    period_start: datetime
    period_end: datetime
    revenue: float
    cost_of_goods: float
    gross_margin: float
    expenses_total: float
    net_profit: float
    sales_count: int
    revenue_by_payment: List[AccountingCategory]
    expenses_by_category: List[AccountingCategory]
    daily_revenue: List[AccountingCategory]
