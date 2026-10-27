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
    address = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    website = Column(String, default="")
    tax_id = Column(String, default="")  # NCC / RCCM
    currency = Column(String, default="FCFA")
    receipt_header = Column(Text, default="")
    receipt_footer = Column(Text, default="Merci de votre confiance !")
    receipt_format = Column(String, default="A4")  # A4, 80mm
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
    quantity = Column(Integer, default=0)
    min_stock = Column(Integer, default=5)
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
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cash_session_id = Column(
        Integer, ForeignKey("cash_sessions.id"), nullable=True
    )

    customer = relationship("Customer", back_populates="sales")
    created_by = relationship("User")
    items = relationship(
        "SaleItem", back_populates="sale", cascade="all, delete-orphan"
    )


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


class CashSession(Base):
    """A till session: opened with a starting balance, closed with a count."""

    __tablename__ = "cash_sessions"

    id = Column(Integer, primary_key=True, index=True)
    opened_at = Column(DateTime, default=utcnow)
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
