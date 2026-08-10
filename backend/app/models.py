from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, default="admin")  # admin, vendeur
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class CompanySettings(Base):
    __tablename__ = "company_settings"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, default="Référence Informatique", nullable=False)
    slogan = Column(String, default="")
    logo = Column(Text, default="")  # data URL, optional
    address = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    website = Column(String, default="")
    tax_id = Column(String, default="")  # NCC / RCCM
    currency = Column(String, default="FCFA")
    about = Column(Text, default="")  # free text shown on the "À propos" page
    receipt_header = Column(Text, default="")
    receipt_footer = Column(Text, default="Merci de votre confiance !")
    receipt_format = Column(String, default="A4")  # A4, 80mm
    printer_name = Column(String, default="")  # printer shown in the print help
    auto_print_cash = Column(Boolean, default=True, nullable=False)
    # Outgoing mail used by the "forgot password" flow (optional).
    smtp_host = Column(String, default="")
    smtp_port = Column(Integer, default=587)
    smtp_user = Column(String, default="")
    smtp_password = Column(String, default="")
    smtp_from = Column(String, default="")
    smtp_tls = Column(Boolean, default=True, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    description = Column(String, default="")

    products = relationship("Product", back_populates="category")


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    contact = Column(String, default="")
    email = Column(String, default="")
    phone = Column(String, default="")
    address = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)

    products = relationship("Product", back_populates="supplier")


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, default="")
    phone = Column(String, default="")
    address = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)

    sales = relationship("Sale", back_populates="customer")


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    sku = Column(String, unique=True, index=True, nullable=False)
    description = Column(Text, default="")
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    purchase_price = Column(Float, default=0)
    sale_price = Column(Float, default=0)
    wholesale_price = Column(Float, default=0)  # 0 = no wholesale price
    quantity = Column(Integer, default=0)
    min_stock = Column(Integer, default=5)
    qr_code = Column(String, default="")  # scan code, defaults to the SKU
    barcode = Column(String, default="", index=True)  # printed EAN-13 digits
    image = Column(Text, default="")  # data URL, optional
    created_at = Column(DateTime, default=utcnow)

    category = relationship("Category", back_populates="products")
    supplier = relationship("Supplier", back_populates="products")


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    date = Column(DateTime, default=utcnow)
    total = Column(Float, default=0)
    status = Column(String, default="Payée")  # Payée, En attente, Annulée
    payment_method = Column(String, default="Espèces")
    note = Column(Text, default="")
    receipt_footer = Column(Text, default="")
    price_mode = Column(String, default="detail")  # detail, gros
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cash_session_id = Column(
        Integer, ForeignKey("cash_sessions.id"), nullable=True
    )
    print_count = Column(Integer, default=0, nullable=False)
    # Idempotency key of tickets recorded offline, replayed once back online.
    client_id = Column(String, unique=True, index=True, nullable=True)

    customer = relationship("Customer", back_populates="sales")
    created_by = relationship("User")
    items = relationship(
        "SaleItem", back_populates="sale", cascade="all, delete-orphan"
    )
    returns = relationship(
        "SaleReturn", back_populates="sale", cascade="all, delete-orphan"
    )

    @property
    def returned_total(self) -> float:
        return sum(r.total for r in self.returns)


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    subtotal = Column(Float, default=0)

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product")

    @property
    def returned_quantity(self) -> int:
        """Units of this line already given back through a credit note."""
        if not self.sale:
            return 0
        return sum(
            line.quantity
            for credit in self.sale.returns
            for line in credit.items
            if line.product_id == self.product_id
        )


class SaleReturn(Base):
    """Credit note: goods given back, referencing the original ticket."""

    __tablename__ = "sale_returns"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    date = Column(DateTime, default=utcnow)
    total = Column(Float, default=0)
    reason = Column(Text, default="")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    sale = relationship("Sale", back_populates="returns")
    created_by = relationship("User")
    items = relationship(
        "SaleReturnItem", back_populates="sale_return", cascade="all, delete-orphan"
    )

    @property
    def sale_reference(self) -> str:
        return self.sale.reference if self.sale else ""


class SaleReturnItem(Base):
    __tablename__ = "sale_return_items"

    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("sale_returns.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    subtotal = Column(Float, default=0)

    sale_return = relationship("SaleReturn", back_populates="items")
    product = relationship("Product")


class CashSession(Base):
    """A till session: opened with a starting balance, closed with a count."""

    __tablename__ = "cash_sessions"

    id = Column(Integer, primary_key=True, index=True)
    opened_at = Column(DateTime, default=utcnow)
    # Business day (YYYY-MM-DD): one session per cashier and per day.
    business_day = Column(String, default="", index=True)
    opened_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    opening_balance = Column(Float, default=0)
    closed_at = Column(DateTime, nullable=True)
    closed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    closing_balance = Column(Float, nullable=True)  # cash counted at closing
    expected_balance = Column(Float, nullable=True)  # opening + cash sales
    difference = Column(Float, nullable=True)  # counted - expected
    note = Column(Text, default="")

    opened_by = relationship("User", foreign_keys=[opened_by_id])
    closed_by = relationship("User", foreign_keys=[closed_by_id])
    sales = relationship("Sale", backref="cash_session")


class Expense(Base):
    """Business expense used by the accounting module."""

    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)
    category = Column(String, default="Divers")
    amount = Column(Float, default=0)
    date = Column(DateTime, default=utcnow)
    note = Column(Text, default="")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_by = relationship("User")


class StockMovement(Base):
    """Traceability of every stock change (sale, inventory count, manual)."""

    __tablename__ = "stock_movements"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    kind = Column(String, default="ajustement")  # vente, inventaire, ajustement
    quantity = Column(Integer, default=0)  # signed delta
    stock_before = Column(Integer, default=0)
    stock_after = Column(Integer, default=0)
    reason = Column(String, default="")
    date = Column(DateTime, default=utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    product = relationship("Product")
    created_by = relationship("User")


class Proforma(Base):
    """Quotation: same layout as an invoice, but nothing is sold or stocked."""

    __tablename__ = "proformas"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    customer_name = Column(String, default="")
    date = Column(DateTime, default=utcnow)
    valid_until = Column(DateTime, nullable=True)
    total = Column(Float, default=0)
    note = Column(Text, default="")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    customer = relationship("Customer")
    created_by = relationship("User")
    items = relationship(
        "ProformaItem", back_populates="proforma", cascade="all, delete-orphan"
    )


class ProformaItem(Base):
    __tablename__ = "proforma_items"

    id = Column(Integer, primary_key=True, index=True)
    proforma_id = Column(Integer, ForeignKey("proformas.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    subtotal = Column(Float, default=0)

    proforma = relationship("Proforma", back_populates="items")
    product = relationship("Product")


class PasswordResetToken(Base):
    """Single-use token emailed to a user who forgot their password."""

    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    user = relationship("User")


class Counter(Base):
    """Row-locked sequence, so concurrent tills never pick the same number."""

    __tablename__ = "counters"

    name = Column(String, primary_key=True)
    value = Column(Integer, default=0, nullable=False)


class ChangeLog(Base):
    """Write feed used by the workstations to refresh almost instantly.

    Every flush that touches business data appends a row; clients poll the
    latest id and reload their screen when it moves.
    """

    __tablename__ = "change_log"

    id = Column(Integer, primary_key=True, index=True)
    entities = Column(String, default="")
    at = Column(DateTime, default=utcnow)


class Notification(Base):
    """In-app notification shown to administrators."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String, default="vente")  # vente, stock, caisse
    title = Column(String, nullable=False)
    message = Column(Text, default="")
    link = Column(String, default="")
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=utcnow)
