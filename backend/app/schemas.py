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
    logo: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    website: str = ""
    tax_id: str = ""
    currency: str = "FCFA"
    vat_rate: float = 0.0
    about: str = ""
    receipt_header: str = ""
    receipt_footer: str = ""
    receipt_format: str = "A4"
    printer_name: str = ""
    auto_print_cash: bool = True
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True
    smtp_configured: bool = False
    backup_dir: str = ""
    backup_auto: bool = True
    backup_keep: int = 30
    backup_on_sale: bool = False
    last_backup_at: Optional[datetime] = None


class CompanySettingsUpdate(BaseModel):
    name: Optional[str] = None
    slogan: Optional[str] = None
    logo: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    tax_id: Optional[str] = None
    currency: Optional[str] = None
    vat_rate: Optional[float] = None
    # "about" is intentionally absent: the page is read-only.
    receipt_header: Optional[str] = None
    receipt_footer: Optional[str] = None
    receipt_format: Optional[str] = None
    printer_name: Optional[str] = None
    auto_print_cash: Optional[bool] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_tls: Optional[bool] = None
    backup_dir: Optional[str] = None
    backup_auto: Optional[bool] = None
    backup_keep: Optional[int] = None
    backup_on_sale: Optional[bool] = None


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
    wholesale_price: float = 0
    quantity: int = 0
    min_stock: int = 5
    qr_code: str = ""
    barcode: str = ""
    image: str = ""


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
    # Filled by the "jamais vendu / plus vendus" filters.
    sold_quantity: int = 0
    last_sold_at: Optional[datetime] = None


# ---------- Sales ----------
class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    payment_method: str = "Espèces"
    status: str = "Payée"
    note: str = ""
    price_mode: str = "detail"  # detail, gros
    items: List[SaleItemCreate]
    # Idempotency key set by tills recording offline; replaying the same key
    # returns the existing ticket instead of duplicating it.
    client_id: Optional[str] = None


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
    returned_quantity: int = 0


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
    price_mode: str = "detail"
    created_by: Optional[UserOut] = None
    items: List[SaleItemOut] = []
    print_count: int = 0
    returned_total: float = 0


# ---------- Returns (avoirs) ----------
class ReturnLine(BaseModel):
    product_id: int
    quantity: int


class ReturnCreate(BaseModel):
    sale_reference: str
    reason: str = ""
    lines: List[ReturnLine]


class ReturnItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class ReturnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    sale_id: int
    sale_reference: str = ""
    date: datetime
    total: float
    reason: str = ""
    created_by: Optional[UserOut] = None
    items: List[ReturnItemOut] = []


# ---------- Proforma ----------
class ProformaItemCreate(BaseModel):
    product_id: Optional[int] = None
    product_name: str = ""
    quantity: int = 1
    unit_price: float = 0


class ProformaCreate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: str = ""
    valid_until: Optional[datetime] = None
    note: str = ""
    items: List[ProformaItemCreate]


class ProformaItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class ProformaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    customer_id: Optional[int]
    customer: Optional[CustomerOut] = None
    customer_name: str = ""
    date: datetime
    valid_until: Optional[datetime] = None
    total: float
    note: str = ""
    created_by: Optional[UserOut] = None
    items: List[ProformaItemOut] = []


# ---------- Password reset ----------
class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class ForgotPasswordResult(BaseModel):
    sent: bool
    message: str


# ---------- Reports ----------
class ReportRow(BaseModel):
    label: str
    quantity: float = 0
    amount: float = 0


class SalesReport(BaseModel):
    period_start: datetime
    period_end: datetime
    sales_count: int
    revenue: float
    returns_total: float
    net_revenue: float
    average_ticket: float
    by_day: List[ReportRow]
    by_payment: List[ReportRow]
    by_seller: List[ReportRow]
    by_category: List[ReportRow]
    by_product: List[ReportRow]


# ---------- Dashboard ----------
class MonthlyRevenue(BaseModel):
    month: str
    revenue: float


class TopProduct(BaseModel):
    name: str
    quantity: int
    revenue: float


class TopSeller(BaseModel):
    name: str
    sales_count: int
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
    top_sellers: List[TopSeller] = []
    low_stock_products: List[ProductOut]
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None


# ---------- Sync ----------
class SyncVersion(BaseModel):
    version: int
    entities: str = ""


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
    business_day: str = ""
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
    returns_total: float = 0
    revenue_by_payment: List[AccountingCategory]
    expenses_by_category: List[AccountingCategory]
    daily_revenue: List[AccountingCategory]


# ---------- Remote update ----------
class UpdateStatus(BaseModel):
    current_version: str
    latest_version: str = ""
    available: bool = False
    packaged: bool = False
    notes: str = ""
    published_at: str = ""
    error: str = ""


class UpdateInstallResult(BaseModel):
    started: bool = True
    version: str


# ---------- Orders and deliveries ----------
class OrderItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_price: Optional[float] = None


class OrderCreate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: str = ""
    expected_date: Optional[datetime] = None
    deposit: float = 0
    price_mode: str = "detail"
    delivery_address: str = ""
    note: str = ""
    items: List[OrderItemCreate] = []


class OrderUpdate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    expected_date: Optional[datetime] = None
    deposit: Optional[float] = None
    price_mode: Optional[str] = None
    delivery_address: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = None
    items: Optional[List[OrderItemCreate]] = None


class OrderItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int] = None
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class DeliveryCreate(BaseModel):
    address: str = ""
    carrier: str = ""
    recipient: str = ""
    note: str = ""
    paid: bool = True
    payment_method: str = "Espèces"


class DeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    order_id: int
    order_reference: str = ""
    sale_id: Optional[int] = None
    date: datetime
    address: str = ""
    carrier: str = ""
    recipient: str = ""
    note: str = ""
    created_by: Optional[UserOut] = None


class OrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    customer_id: Optional[int] = None
    customer_name: str = ""
    date: datetime
    expected_date: Optional[datetime] = None
    status: str
    total: float
    deposit: float = 0
    balance: float = 0
    price_mode: str = "detail"
    delivery_address: str = ""
    note: str = ""
    items: List[OrderItemOut] = []
    deliveries: List[DeliveryOut] = []
    created_by: Optional[UserOut] = None


# ---------- Undo / redo ----------
class ActionLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    at: datetime
    user: Optional[UserOut] = None


class HistoryState(BaseModel):
    undo: Optional[ActionLogOut] = None
    redo: Optional[ActionLogOut] = None


# ---------- Backups ----------
class BackupFile(BaseModel):
    name: str
    size: int
    created_at: datetime


class BackupResult(BaseModel):
    name: str
    size: int


# ---------- Access rights ----------
class PermissionDefinition(BaseModel):
    key: str
    label: str
    section: str


class PermissionMatrix(BaseModel):
    definitions: list[PermissionDefinition]
    roles: list[str]
    matrix: dict[str, dict[str, bool]]


class PermissionUpdate(BaseModel):
    matrix: dict[str, dict[str, bool]]


class UserPermissions(BaseModel):
    role: str
    allowed: list[str]


# ---------- Supply orders (approvisionnement) ----------
class PurchaseItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit_cost: Optional[float] = None


class PurchaseCreate(BaseModel):
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    expected_date: Optional[datetime] = None
    paid: float = 0
    invoice_number: str = ""
    note: str = ""
    items: List[PurchaseItemCreate] = []


class PurchaseUpdate(BaseModel):
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    expected_date: Optional[datetime] = None
    paid: Optional[float] = None
    invoice_number: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = None
    items: Optional[List[PurchaseItemCreate]] = None


class PurchaseReceiveItem(BaseModel):
    item_id: int
    quantity: int


class PurchaseReceive(BaseModel):
    """Quantities actually delivered; empty means "everything ordered"."""

    items: List[PurchaseReceiveItem] = []
    update_cost: bool = True  # refresh the product purchase price
    note: str = ""


class PurchaseItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int] = None
    product_name: str
    quantity: int
    received_quantity: int = 0
    unit_cost: float
    subtotal: float


class PurchaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    supplier_id: Optional[int] = None
    supplier_name: str = ""
    date: datetime
    expected_date: Optional[datetime] = None
    received_at: Optional[datetime] = None
    status: str
    total: float
    paid: float = 0
    balance: float = 0
    invoice_number: str = ""
    note: str = ""
    items: List[PurchaseItemOut] = []
    created_by: Optional[UserOut] = None


class PurchaseSummary(BaseModel):
    """Figures shown on top of the supply page."""

    count: int = 0
    pending: int = 0
    total: float = 0
    unpaid: float = 0
