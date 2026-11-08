from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    photo: str = ""
    is_active: bool = True
    notification_kinds: str = ""


class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: str = "vendeur"
    photo: str = ""


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    photo: Optional[str] = None
    is_active: Optional[bool] = None
    notification_kinds: Optional[list[str]] = None


class UserPhoto(BaseModel):
    photo: str = ""


# ---------- Company settings ----------
class CompanySettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    slogan: str = ""
    logo: str = ""
    address: str = ""
    phone: str = ""
    phone2: str = ""
    email: str = ""
    website: str = ""
    tax_id: str = ""
    country: str = ""
    rccm: str = ""
    ncc: str = ""
    capital_social: str = ""
    regime_fiscal: str = ""
    currency: str = "FCFA"
    vat_rate: float = 0.0
    about: str = ""
    city: str = ""
    receipt_header: str = ""
    receipt_footer: str = ""
    receipt_format: str = "A4"
    printer_name: str = ""
    document_layouts: str = ""
    auto_print_cash: bool = True
    drawer_enabled: bool = False
    drawer_port: str = ""
    drawer_code: str = "27,112,0,25,250"
    drawer_open_after_sale: bool = True
    expiry_critical_days: int = 7
    expiry_alert_days: int = 30
    expiry_watch_days: int = 60
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
    backup_auto_enabled: bool = False
    backup_frequency: Literal["daily", "weekly", "monthly"] = "daily"
    backup_time: str = "20:00"
    backup_weekday: int = 0
    backup_monthday: int = 1
    last_backup_status: str = ""
    last_backup_error: str = ""
    drive_enabled: bool = False
    drive_folder_name: str = "EasyGest Sauvegardes"
    drive_folder_id: str = ""
    drive_keep: int = 30
    drive_last_upload_at: Optional[datetime] = None
    drive_last_status: str = ""
    drive_last_error: str = ""
    drive_last_file_id: str = ""
    drive_account_email: str = ""
    network_restrict_workstations: bool = False
    support_whatsapp: str = ""
    support_email: str = ""


class CompanySettingsUpdate(BaseModel):
    name: Optional[str] = None
    slogan: Optional[str] = None
    logo: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    phone2: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    tax_id: Optional[str] = None
    country: Optional[str] = None
    rccm: Optional[str] = None
    ncc: Optional[str] = None
    capital_social: Optional[str] = None
    regime_fiscal: Optional[str] = None
    currency: Optional[str] = None
    vat_rate: Optional[float] = None
    city: Optional[str] = None
    document_layouts: Optional[str] = None
    support_whatsapp: Optional[str] = None
    support_email: Optional[str] = None
    # "about" is intentionally absent: the page is read-only.
    receipt_header: Optional[str] = None
    receipt_footer: Optional[str] = None
    receipt_format: Optional[str] = None
    printer_name: Optional[str] = None
    auto_print_cash: Optional[bool] = None
    drawer_enabled: Optional[bool] = None
    drawer_port: Optional[str] = None
    drawer_code: Optional[str] = None
    drawer_open_after_sale: Optional[bool] = None
    expiry_critical_days: Optional[int] = None
    expiry_alert_days: Optional[int] = None
    expiry_watch_days: Optional[int] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from: Optional[str] = None
    smtp_tls: Optional[bool] = None
    backup_dir: Optional[str] = None
    backup_auto: Optional[bool] = None
    backup_keep: Optional[int] = Field(default=None, ge=1)
    backup_on_sale: Optional[bool] = None
    backup_auto_enabled: Optional[bool] = None
    backup_frequency: Optional[Literal["daily", "weekly", "monthly"]] = None
    backup_time: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    backup_weekday: Optional[int] = Field(default=None, ge=0, le=6)
    backup_monthday: Optional[int] = Field(default=None, ge=1, le=28)
    drive_enabled: Optional[bool] = None
    network_restrict_workstations: Optional[bool] = None
    drive_folder_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    drive_keep: Optional[int] = Field(default=None, ge=1, le=1000)
    support_whatsapp: Optional[str] = None
    support_email: Optional[str] = None

    @field_validator("backup_auto_enabled", "backup_frequency", "backup_time", "backup_weekday", "backup_monthday", "backup_keep", "drive_enabled", "drive_folder_name", "drive_keep", "network_restrict_workstations")
    @classmethod
    def backup_not_null(cls, value):
        if value is None:
            raise ValueError("Les paramètres de sauvegarde ne peuvent pas être nuls")
        if isinstance(value, str) and not value.strip():
            raise ValueError("Le nom du dossier ne peut pas être vide")
        return value


# ---------- Assistance et support ----------
class SupportRequestIn(BaseModel):
    name: str
    email: str = ""
    subject: str
    category: str = "assistance"
    message: str


class SupportRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str = ""
    subject: str
    category: str = ""
    status: str = ""
    created_at: datetime


class SupportContactOut(BaseModel):
    whatsapp: str = ""
    email: str = ""


# ---------- Printing ----------
class PrinterDevice(BaseModel):
    """A printer installed on this computer, as the spooler describes it."""

    name: str
    port: str = ""
    driver: str = ""
    kind: str = ""
    jobs: int = 0
    is_default: bool = False
    available: bool = True
    status: str = "Disponible"
    supports_color: bool = False


class PrinterList(BaseModel):
    devices: list[PrinterDevice] = Field(default_factory=list)
    # Names only, for the callers written before the status was reported.
    printers: list[str] = Field(default_factory=list)
    default: str = ""


class ReceiptPrinterConfig(BaseModel):
    """Thermal receipt printer: hardware, layout and ticket contents."""

    printer_name: str = ""
    width: str = "80mm"  # 80mm, 58mm, A4
    copies: int = 1
    auto_print: bool = True
    cut_paper: bool = True
    open_drawer: bool = True
    font_family: str = "Arial"
    font_size: int = 11
    line_height: float = 1.35
    align: str = "left"
    margin_mm: float = 3.0
    logo_size_mm: float = 18.0
    logo_align: str = "center"
    show_logo: bool = True
    show_company: bool = True
    show_address: bool = True
    show_phone: bool = True
    show_email: bool = True
    show_website: bool = True
    show_tax_id: bool = True
    show_header: bool = True
    show_footer: bool = True
    show_number: bool = True
    show_datetime: bool = True
    show_seller: bool = True
    show_customer: bool = True
    show_qty: bool = True
    show_unit_price: bool = True
    show_discount: bool = True
    show_vat: bool = True
    show_total_ht: bool = True
    show_total_ttc: bool = True
    show_paid: bool = True
    show_change: bool = True
    show_payment: bool = True
    show_barcode: bool = True
    # QR code at the foot of the ticket: off by default, opt-in per poste.
    show_qr: bool = False
    paper_width_mm: float = Field(default=80, ge=40, le=216)
    bold: bool = False
    show_company_info: bool = True
    text_color: str = Field(default='#000000', pattern=r'^#[0-9a-fA-F]{6}$')
    footer_text: str = ''
    item_layout: Literal['table', 'stacked'] = 'table'
    show_line_total: bool = True


class LabelPrinterConfig(BaseModel):
    """Price labels: a different printer, a different set of settings."""

    printer_name: str = ""
    width_mm: float = 60.0
    height_mm: float = 40.0
    columns: int = 3
    font_size: int = 12
    show_logo: bool = True
    show_shop: bool = True
    show_name: bool = True
    show_price: bool = True
    show_wholesale: bool = False
    show_code: bool = True
    show_barcode: bool = True
    font_family: str = 'Arial'
    code_type: Literal['barcode', 'qr'] = 'barcode'


class DocumentConfig(BaseModel):
    """A4/A5 commercial documents: purchase orders and delivery notes."""

    format: str = "A4"  # A4, A5
    # Printer assigned to commercial documents on this workstation.
    printer_name: str = ""
    # Optional dedicated queues; empty falls back on printer_name.
    delivery_printer_name: str = ""
    quote_printer_name: str = ""
    reports_printer_name: str = ""
    settlement_printer_name: str = ""
    # True: the document goes straight to the assigned printer without the
    # preview; False: the user reviews the preview first.
    direct_print: bool = True
    order_prefix: str = "BC"
    delivery_prefix: str = "BL"
    show_logo: bool = True
    show_address: bool = True
    show_phone: bool = True
    show_whatsapp: bool = True
    show_email: bool = True
    show_website: bool = True
    show_vat: bool = True
    show_discount: bool = True
    show_prices_on_delivery: bool = False
    show_customer_signature: bool = True
    show_company_signature: bool = True
    font_family: str = 'Arial'
    font_size: int = Field(default=12, ge=8, le=24)
    text_color: str = Field(default='#0f172a', pattern=r'^#[0-9a-fA-F]{6}$')
    accent_color: str = Field(default='#0f172a', pattern=r'^#[0-9a-fA-F]{6}$')
    logo_size_mm: float = Field(default=22, ge=5, le=60)
    header_text: str = ''
    footer_text: str = ''
    info_position: Literal['left', 'center', 'right'] = 'left'
    show_company: bool = True
    show_customer: bool = True
    show_reference: bool = True
    show_date: bool = True
    show_qty: bool = True
    show_unit_price: bool = True
    show_total: bool = True


class PrintingConfig(BaseModel):
    receipt: ReceiptPrinterConfig = Field(default_factory=ReceiptPrinterConfig)
    label: LabelPrinterConfig = Field(default_factory=LabelPrinterConfig)
    documents: DocumentConfig = Field(default_factory=DocumentConfig)


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
    logo: str = ""


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
    # Ceiling on unpaid receivables; 0 means no limit.
    credit_limit: float = 0


class CustomerCreate(CustomerBase):
    pass


class CustomerOut(CustomerBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


# ---------- Product ----------
class UnitSnapshotOut(BaseModel):
    base_unit: Optional[str] = "pièce"
    packaging_unit: Optional[str] = ""
    units_per_packaging: Optional[int] = 1
    quantity_label: Optional[str] = None


class PackagingQuantities(BaseModel):
    packaging_quantity: Optional[int] = Field(default=None, ge=0)
    piece_quantity: Optional[int] = Field(default=None, ge=0)


class ProductBase(BaseModel):
    base_unit: str = Field(default="pièce", min_length=1, max_length=40)
    packaging_unit: str = Field(default="", max_length=40)
    units_per_packaging: int = Field(default=1, ge=1)
    packaging_sale_price: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    wholesale_packaging_price: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
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
    quantity: Optional[int] = None
    min_stock: Optional[int] = None
    quantity_label: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    category: Optional[CategoryOut] = None
    supplier: Optional[SupplierOut] = None
    # Filled by the "jamais vendu / plus vendus" filters.
    sold_quantity: int = 0
    last_sold_at: Optional[datetime] = None


class PriceHistoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    field: str
    old_value: float
    new_value: float
    changed_at: datetime
    changed_by: Optional["UserOut"] = None


# ---------- Sales ----------
class SaleItemCreate(PackagingQuantities):
    price_tier: Optional[Literal["detail", "gros"]] = None
    expected_units_per_packaging: Optional[int] = Field(default=None, ge=1)
    product_id: int
    quantity: int = 0
    # Price agreed at the counter; ignored unless the seller holds the right
    # to change a price, and never written back to the product sheet.
    unit_price: Optional[float] = None
    # Discount granted on this line only, in currency units (not %).
    discount: float = 0


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    payment_method: str = "Espèces"
    status: str = "Payée"
    note: str = ""
    price_mode: str = "detail"  # detail, gros
    # Cash handed over at the counter, so the ticket can print the change.
    paid_amount: float = 0
    # Discount granted on the whole ticket, deducted from the total.
    discount: float = 0
    # Gift sale: stock moves, revenue excluded, ticket marked OFFERT.
    is_gift: bool = False
    items: List[SaleItemCreate]
    # Idempotency key set by tills recording offline; replaying the same key
    # returns the existing ticket instead of duplicating it.
    client_id: Optional[str] = None
    # Mixed tender: the legs the customer paid with; must add up to the
    # total. When present it overrides payment_method.
    payments: Optional[List["SalePaymentCreate"]] = None


class SaleUpdate(BaseModel):
    customer_id: Optional[int] = None
    payment_method: Optional[str] = None
    note: Optional[str] = None
    receipt_footer: Optional[str] = None


class SalePaymentCreate(BaseModel):
    method: str
    amount: float


class SalePaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    method: str
    amount: float


class SaleItemOut(UnitSnapshotOut):
    price_tier: Optional[str] = "detail"
    catalog_unit_price: Optional[float] = None
    unit_cost: Optional[float] = None
    cost: Optional[float] = None
    revenue: Optional[float] = None
    profit: Optional[float] = None
    margin: Optional[float] = None
    sold_unit: Optional[str] = None
    packaging_quantity: Optional[int] = None
    piece_quantity: Optional[int] = None
    base_quantity: Optional[int] = None
    base_unit_price: Optional[float] = None
    packaging_sale_price: Optional[float] = None
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    quantity: int
    unit_price: float
    discount: float = 0
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
    paid_amount: float = 0
    payments: List[SalePaymentOut] = []
    discount: float = 0
    discount_by_id: Optional[int] = None
    cost: Optional[float] = None
    profit: Optional[float] = None
    margin: Optional[float] = None
    is_gift: bool = False


# ---------- Returns (avoirs) ----------
class ReturnLine(PackagingQuantities):
    sale_item_id: Optional[int] = None
    product_id: int
    quantity: int = 0


class ReturnCreate(BaseModel):
    sale_reference: str
    reason: str = ""
    refund_method: Literal["Avoir", "Espèces"] = "Avoir"
    lines: List[ReturnLine]


class ReturnItemOut(UnitSnapshotOut):
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
    unit: str = "u"
    quantity: int = 1
    unit_price: float = 0
    discount: float = 0


class ProformaCreate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: str = ""
    valid_until: Optional[datetime] = None
    note: str = ""
    # "devis" (commercial offer) or "proforma" (forecast invoice).
    kind: str = "devis"
    status: str = "Brouillon"
    discount: float = 0
    items: List[ProformaItemCreate]


class ProformaUpdate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    valid_until: Optional[datetime] = None
    note: Optional[str] = None
    status: Optional[str] = None
    discount: Optional[float] = None
    items: Optional[List[ProformaItemCreate]] = None


class ProformaConvert(BaseModel):
    """Turn a quote into a proforma, or either of them into an order."""

    target: str = "proforma"
    deposit: float = 0


class ProformaItemOut(UnitSnapshotOut):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    reference: str = ""
    unit: str = "u"
    quantity: int
    unit_price: float
    discount: float = 0
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
    discount: float = 0
    kind: str = "proforma"
    status: str = "Brouillon"
    converted_from_id: Optional[int] = None
    order_id: Optional[int] = None
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


class ChangePasswordRequest(BaseModel):
    current_password: str
    password: str
    confirm: str


class RecoveryRequest(BaseModel):
    """Administrator recovery: a key, the account to reopen, a new password."""

    key: str
    identifier: str = ""
    password: str
    confirm: str


class RecoveryKeyOut(BaseModel):
    """The clear key is returned once, right after it has been generated."""

    key: str
    created_at: datetime


class SecurityLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    at: datetime
    event: str
    identifier: str
    detail: str
    station: str
    success: bool
    user: Optional[UserOut] = None


class DiagnosticItem(BaseModel):
    """One line of the connection diagnostic; never holds a secret."""

    label: str
    status: str = "ok"  # ok, avertissement, erreur
    detail: str = ""


class DiagnosticOut(BaseModel):
    items: list[DiagnosticItem] = []


class AuthRepairResult(BaseModel):
    message: str
    unlocked: int = 0
    tokens_cleared: int = 0


# ---------- Reports ----------
class ReportRow(BaseModel):
    quantity_label: Optional[str] = None
    label: str
    quantity: float = 0
    amount: float = 0


class ProfitRow(BaseModel):
    label: str
    revenue: float
    cost: float
    profit: float
    margin: float


class SalesReport(BaseModel):
    profit_by_product: List[ProfitRow] = []
    profit_by_sale: List[ProfitRow] = []
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
    # Tills closed in the window with a non-zero counted-vs-expected gap.
    cash_gap_count: int = 0
    cash_gap_total: float = 0
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
    opening_balance: Optional[float] = None
    closed_at: Optional[datetime] = None
    closed_by: Optional[UserOut] = None
    closing_balance: Optional[float] = None
    expected_balance: Optional[float] = None
    difference: Optional[float] = None
    note: str = ""


class CashSessionSaleLine(BaseModel):
    """One sale of the session, for the "ventes de la session" list."""

    id: int
    reference: str
    total: float
    paid_amount: float = 0
    payment_method: str = ""
    status: str = ""
    date: Optional[datetime] = None


class CashSessionDetail(CashSessionOut):
    """Open session enriched with live totals."""

    cash_sales: Optional[float] = None
    other_sales: Optional[float] = None
    sales_count: Optional[int] = None
    deposits_total: Optional[float] = None
    expected_cash: Optional[float] = None
    entries_total: Optional[float] = None
    exits_total: Optional[float] = None
    cash_refunds: Optional[float] = None
    cash_settlements: Optional[float] = None
    sales: list[CashSessionSaleLine] = []


class CashMovementCreate(BaseModel):
    type: Literal["in", "out"]
    amount: float = Field(gt=0, allow_inf_nan=False)
    reason: str = Field(min_length=1, max_length=1000)


class CashMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    session_id: int
    type: str
    amount: Optional[float] = None
    reason: str
    user_id: int
    created_at: datetime
    workstation: str = ""


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
class InventoryLine(PackagingQuantities):
    product_id: int
    counted_quantity: int = 0


class InventoryApply(BaseModel):
    lines: List[InventoryLine]
    note: str = ""


class StockLotCreate(BaseModel):
    lot_number: str = ""
    expiry_date: Optional[datetime] = None
    quantity: int


class StockLotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: int
    lot_number: str
    expiry_date: Optional[datetime] = None
    quantity: int
    created_at: datetime
    product_name: str = ""
    days_left: Optional[int] = None


class StockTransferItemCreate(PackagingQuantities):
    product_id: int
    quantity: int = 0


class StockTransferCreate(BaseModel):
    direction: str = "sortie"  # sortie | entree
    store_name: str = ""
    note: str = ""
    items: List[StockTransferItemCreate]


class StockTransferItemOut(UnitSnapshotOut):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int]
    product_name: str
    quantity: int


class StockTransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    direction: str
    store_name: str
    note: str
    created_at: datetime
    created_by: Optional[UserOut] = None
    items: List[StockTransferItemOut] = []


class StockMovementOut(UnitSnapshotOut):
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
    unit: str = "u"
    discount: float = 0


class OrderCreate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: str = ""
    expected_date: Optional[datetime] = None
    deposit: float = 0
    discount: float = 0
    price_mode: str = "detail"
    delivery_address: str = ""
    payment_terms: str = ""
    delivery_terms: str = ""
    status: str = "Brouillon"
    note: str = ""
    items: List[OrderItemCreate] = []


class OrderUpdate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    expected_date: Optional[datetime] = None
    deposit: Optional[float] = None
    discount: Optional[float] = None
    price_mode: Optional[str] = None
    delivery_address: Optional[str] = None
    payment_terms: Optional[str] = None
    delivery_terms: Optional[str] = None
    note: Optional[str] = None
    status: Optional[str] = None
    items: Optional[List[OrderItemCreate]] = None


class OrderItemOut(UnitSnapshotOut):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int] = None
    product_name: str
    reference: str = ""
    unit: str = "u"
    quantity: int
    delivered_quantity: int = 0
    remaining_quantity: int = 0
    unit_price: float
    discount: float = 0
    subtotal: float


class DeliveryCreate(BaseModel):
    address: str = ""
    carrier: str = ""
    recipient: str = ""
    note: str = ""
    paid: bool = True
    payment_method: str = "Espèces"


class DeliveryUpdate(BaseModel):
    address: Optional[str] = None
    carrier: Optional[str] = None
    recipient: Optional[str] = None
    note: Optional[str] = None


class DeliveryItemCreate(BaseModel):
    product_id: int
    quantity: int
    unit: str = "u"
    observation: str = ""
    unit_price: Optional[float] = None


class DeliveryNoteCreate(BaseModel):
    """Delivery note, either standalone or drawn from a purchase order."""

    order_id: Optional[int] = None
    customer_id: Optional[int] = None
    customer_name: str = ""
    address: str = ""
    carrier: str = ""
    recipient: str = ""
    note: str = ""
    items: List[DeliveryItemCreate] = []


class DeliveryNoteUpdate(BaseModel):
    customer_id: Optional[int] = None
    customer_name: Optional[str] = None
    address: Optional[str] = None
    carrier: Optional[str] = None
    recipient: Optional[str] = None
    note: Optional[str] = None
    items: Optional[List[DeliveryItemCreate]] = None


class DeliveryValidate(BaseModel):
    paid: bool = True
    payment_method: str = "Espèces"


class DeliveryItemOut(UnitSnapshotOut):
    model_config = ConfigDict(from_attributes=True)
    id: int
    product_id: Optional[int] = None
    product_name: str = ""
    reference: str = ""
    unit: str = "u"
    ordered_quantity: int = 0
    previously_delivered: int = 0
    quantity: int = 0
    unit_price: float = 0
    subtotal: float = 0
    observation: str = ""


class DeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    order_id: Optional[int] = None
    order_reference: str = ""
    customer_id: Optional[int] = None
    customer_name: str = ""
    status: str = "Validé"
    validated_at: Optional[datetime] = None
    sale_id: Optional[int] = None
    date: datetime
    address: str = ""
    carrier: str = ""
    recipient: str = ""
    note: str = ""
    items: List[DeliveryItemOut] = []
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
    discount: float = 0
    deposit: float = 0
    # Money really received, and what is still due after it.
    paid: float = 0
    balance: float = 0
    # Goods and money followed apart: a delivery never settles anything.
    delivery_status: str = "En attente"
    payment_status: str = "Non payé"
    price_mode: str = "detail"
    delivery_address: str = ""
    payment_terms: str = ""
    delivery_terms: str = ""
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
class PurchaseItemCreate(PackagingQuantities):
    packaging_unit_cost: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    product_id: int
    quantity: int = 0
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


class PurchaseReceiveItem(PackagingQuantities):
    item_id: int
    quantity: int = 0


class PurchaseReceive(BaseModel):
    """Quantities actually delivered; empty means "everything ordered"."""

    items: List[PurchaseReceiveItem] = []
    update_cost: bool = True  # refresh the product purchase price
    note: str = ""


class PurchaseItemOut(UnitSnapshotOut):
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


class LicenseFeature(BaseModel):
    """One capability, as shown on "Mon abonnement"."""

    code: str
    name: str
    section: str = ""
    allowed: bool


class LicenseStatus(BaseModel):
    """Licence of this installation, read by the app and by the client."""

    mode: str
    plan_code: str = ""
    plan_name: str = ""
    status: str = ""
    message: str = ""
    blocked: bool = False
    registered: bool = False
    client_name: str = ""
    license_key: str = ""
    ends_at: Optional[datetime] = None
    days_left: Optional[int] = None
    grace_days: int = 0
    last_sync: Optional[datetime] = None
    last_error: str = ""
    central_url: str = ""
    installation_uid: str = ""
    support: dict = {}
    features: List[str] = []
    catalogue: List[LicenseFeature] = []


class LicenseRegister(BaseModel):
    """First configuration: "Choisissez votre formule"."""

    central_url: str = ""
    plan_code: str
    company: str
    manager: str = ""
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    rccm: str = ""
    sector: str = ""
    installation_name: str = ""


class OfferedPlan(BaseModel):
    code: str
    name: str
    description: str = ""
    price: float = 0
    currency: str = "FCFA"
    duration_days: int = 0
    features: List[str] = []


# ---------- Debts and receivables ----------
class DebtPaymentCreate(BaseModel):
    amount: float
    method: str = "Espèces"
    note: str = ""
    reference: str = ""
    date: Optional[datetime] = None


class DebtPaymentCancel(BaseModel):
    reason: str


class DebtPaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    debt_id: int
    amount: float
    method: str
    note: str
    reference: str
    receipt_reference: str
    cancelled: bool
    cancel_reason: str
    cancelled_at: Optional[datetime] = None
    date: datetime
    created_by: Optional[UserOut] = None
    cancelled_by: Optional[UserOut] = None


class SettlementOut(DebtPaymentOut):
    """A settlement seen from the history screen, with its counterpart."""

    kind: str = "creance"
    party: str = ""
    document: str = ""


class DebtCreate(BaseModel):
    kind: str = "creance"  # creance (client) or dette (fournisseur)
    party: str = ""
    customer_id: Optional[int] = None
    supplier_id: Optional[int] = None
    reference: str = ""
    amount: float
    due_date: Optional[datetime] = None
    note: str = ""


class DebtOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    party: str
    customer_id: Optional[int] = None
    supplier_id: Optional[int] = None
    sale_id: Optional[int] = None
    reference: str
    amount: float
    due_date: Optional[datetime] = None
    note: str
    created_at: datetime
    paid: float
    remaining: float
    settled: bool
    overdue: bool
    status: str = "Non payé"
    days_late: int = 0
    customer: Optional[CustomerOut] = None
    supplier: Optional[SupplierOut] = None
    created_by: Optional[UserOut] = None
    payments: List[DebtPaymentOut] = []


class DebtSummary(BaseModel):
    receivable_total: float = 0
    receivable_overdue: float = 0
    receivable_count: int = 0
    payable_total: float = 0
    payable_overdue: float = 0
    payable_count: int = 0
    collected: float = 0
    disbursed: float = 0


class DebtAlert(BaseModel):
    """One sentence shown to the shop about a term coming or missed."""

    level: str = "info"
    message: str = ""


class PartyBalance(BaseModel):
    """Totals of one customer or supplier, for the ranking screens."""

    party: str = ""
    customer_id: Optional[int] = None
    supplier_id: Optional[int] = None
    phone: str = ""
    total: float = 0
    paid: float = 0
    remaining: float = 0
    overdue: float = 0
    days_late: int = 0
    next_due: Optional[datetime] = None


class AgingBucket(BaseModel):
    """One row of the receivables schedule: how much falls in each delay."""

    label: str
    total: float = 0
    count: int = 0
    parties: List[str] = []


# ---------- Paie ----------
class EmployeeBase(BaseModel):
    matricule: str = ""
    last_name: str
    first_name: str = ""
    gender: str = ""
    birth_date: Optional[datetime] = None
    phone: str = ""
    address: str = ""
    job: str = ""
    department: str = ""
    hired_at: Optional[datetime] = None
    contract: str = "CDI"
    status: str = "En poste"
    base_salary: float = 0
    payment_method: str = "Espèces"
    bank: str = ""
    account_number: str = ""
    social_number: str = ""
    email: str = ""
    note: str = ""
    is_active: bool = True


class EmployeeOut(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str = ""
    created_at: datetime


class PayrollElementBase(BaseModel):
    name: str
    kind: str = "gain"  # gain, retenue
    mode: str = "fixe"  # fixe, pourcentage
    value: float = 0
    base: str = "base"  # base, brut
    ceiling: float = 0
    automatic: bool = True
    is_active: bool = True
    starts_on: Optional[datetime] = None
    ends_on: Optional[datetime] = None
    position: int = 0


class PayrollElementOut(PayrollElementBase):
    model_config = ConfigDict(from_attributes=True)
    id: int


class PayslipLineIn(BaseModel):
    kind: str = "gain"
    label: str = ""
    quantity: float = 0
    rate: float = 0
    base: float = 0
    amount: float = 0
    element_id: Optional[int] = None


class PayslipLineOut(PayslipLineIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    position: int = 0


class PayslipCreate(BaseModel):
    employee_id: int
    year: int
    month: int
    absence_days: float = 0
    overtime_hours: float = 0
    overtime_rate: float = 0
    payment_method: str = ""
    note: str = ""
    # Exceptional lines typed for this month only.
    extra_lines: List[PayslipLineIn] = []
    # Lines shown on screen, kept as they are when the user corrected them.
    lines: Optional[List[PayslipLineIn]] = None


class PayslipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    employee_id: int
    year: int
    month: int
    period: str = ""
    base_salary: float = 0
    gross: float = 0
    deductions: float = 0
    net: float = 0
    net_in_words: str = ""
    status: str = "Brouillon"
    absence_days: float = 0
    overtime_hours: float = 0
    overtime_rate: float = 0
    validated_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    payment_method: str = ""
    cancel_reason: str = ""
    note: str = ""
    created_at: datetime
    employee: Optional[EmployeeOut] = None
    created_by: Optional[UserOut] = None
    lines: List[PayslipLineOut] = []


class PayslipDraft(BaseModel):
    """Computed payslip shown before anything is written down."""

    employee_id: int
    year: int
    month: int
    base_salary: float = 0
    gross: float = 0
    deductions: float = 0
    net: float = 0
    net_in_words: str = ""
    lines: List[PayslipLineIn] = []


class PayslipCancel(BaseModel):
    reason: str = ""


class PayrollSummaryRow(BaseModel):
    matricule: str = ""
    employee: str = ""
    job: str = ""
    gross: float = 0
    deductions: float = 0
    net: float = 0
    status: str = ""


class PayrollSummary(BaseModel):
    year: int = 0
    month: int = 0
    employees: int = 0
    base_total: float = 0
    gains_total: float = 0
    gross_total: float = 0
    deductions_total: float = 0
    net_total: float = 0
    rows: List[PayrollSummaryRow] = []


# ---------- FNE ----------
class FneSettingsOut(BaseModel):
    """Configuration FNE vue par l'admin : jamais les secrets eux-mêmes."""

    enabled: bool = False
    environment: str = "test"
    api_url: str = ""
    token_url: str = ""
    client_id: str = ""
    credentials_configured: bool = False
    configured: bool = False


class FneSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    environment: Optional[str] = None  # test, production
    api_url: Optional[str] = None
    token_url: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    api_key: Optional[str] = None


class FneInvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sale_id: int
    status: str
    fne_reference: str = ""
    fne_number: str = ""
    fne_token: str = ""
    last_error: str = ""
    attempts: int = 0
    submitted_at: Optional[datetime] = None
    certified_at: Optional[datetime] = None


# ---------- Bank accounts & deposits ----------
class BankAccountIn(BaseModel):
    bank_name: str
    holder: str = ""
    account_number: str = ""
    label: str = ""
    currency: str = "FCFA"
    is_active: bool = True
    note: str = ""


class BankAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    bank_name: str
    holder: str = ""
    account_number: str = ""
    label: str = ""
    currency: str = "FCFA"
    is_active: bool = True
    note: str = ""
    created_at: Optional[datetime] = None
    balance: Optional[float] = None  # validated deposits minus cancelled, after assembly


class BankDepositIn(BaseModel):
    account_id: int
    amount: float
    deposit_date: Optional[datetime] = None
    method: str = "Espèces"
    reference: str = ""
    slip_number: str = ""
    note: str = ""
    attachment: str = ""
    cash_session_id: Optional[int] = None


class BankDepositOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    cash_session_id: Optional[int] = None
    amount: float
    deposit_date: Optional[datetime] = None
    method: str = "Espèces"
    reference: str = ""
    slip_number: str = ""
    note: str = ""
    attachment: str = ""
    status: str = "en attente"
    reconciled: bool = False
    statement_ref: str = ""
    created_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None
    bank_name: str = ""
    account_label: str = ""
    created_by_name: str = ""
    decided_by_name: str = ""


class BankDepositDecision(BaseModel):
    action: str  # valider | rejeter | annuler
    note: str = ""


class BankDepositReconcile(BaseModel):
    reconciled: bool = True
    statement_ref: str = ""


# ---------- Z de caisse ----------
class CashSessionZ(BaseModel):
    """État Z de caisse: definitive recap of a till session."""

    session_id: int
    company: str = ""
    company_address: str = ""
    company_phone: str = ""
    company_logo: str = ""
    cashier: str = ""
    opened_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    business_day: str = ""
    opening_balance: float = 0
    total_sales: float = 0
    sales_count: int = 0
    cancelled_total: float = 0
    cancelled_count: int = 0
    gift_total: float = 0
    payments: dict[str, float] = {}  # per payment method
    refunds_total: float = 0
    refunds: list[dict] = []
    advances_total: float = 0  # acomptes de commandes encaissés
    advances: list[dict] = []
    settlements_total: float = 0  # règlements de créances clients
    settlements: dict[str, float] = {}  # per payment method
    expenses_total: float = 0
    expenses: list[dict] = []
    deposits_total: float = 0
    deposits: list[dict] = []
    expected_cash: float = 0
    cash_sales: float = 0
    other_sales: float = 0
    cash_refunds: float = 0
    cash_settlements: float = 0
    entries_total: float = 0
    exits_total: float = 0
    sales: list[CashSessionSaleLine] = []
    counted_cash: Optional[float] = None
    difference: Optional[float] = None
    note: str = ""
    generated_at: Optional[datetime] = None
