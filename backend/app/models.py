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
    role = Column(String, default="admin")  # admin, vendeur, gestionnaire
    photo = Column(Text, default="")  # data URL, optional
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class CompanySettings(Base):
    __tablename__ = "company_settings"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, default="EasyGest", nullable=False)
    slogan = Column(String, default="")
    logo = Column(Text, default="")  # data URL, optional
    address = Column(String, default="")
    phone = Column(String, default="")
    email = Column(String, default="")
    website = Column(String, default="")
    tax_id = Column(String, default="")  # NCC / RCCM
    currency = Column(String, default="FCFA")
    # VAT shown on receipts; prices are already tax inclusive.
    vat_rate = Column(Float, default=0.0, nullable=False)
    about = Column(Text, default="")  # free text shown on the "À propos" page
    receipt_header = Column(Text, default="")
    receipt_footer = Column(Text, default="Merci de votre confiance !")
    receipt_format = Column(String, default="A4")  # A4, 80mm
    printer_name = Column(String, default="")  # printer shown in the print help
    auto_print_cash = Column(Boolean, default=True, nullable=False)
    # Electronic cash drawer: it is wired to the receipt printer (or to a
    # serial port) and opens when it receives its kick code.
    drawer_enabled = Column(Boolean, default=False, nullable=False)
    drawer_port = Column(String, default="")  # COM1, LPT1, \\\\PC\\CAISSE...
    drawer_code = Column(String, default="27,112,0,25,250")  # ESC p 0 25 250
    drawer_open_after_sale = Column(Boolean, default=True, nullable=False)
    # Receipt and label printer settings, kept as JSON: they are a long list of
    # display switches that only the printing code reads.
    printing_config = Column(Text, default="")
    # Outgoing mail used by the "forgot password" flow (optional).
    smtp_host = Column(String, default="")
    smtp_port = Column(Integer, default=587)
    smtp_user = Column(String, default="")
    smtp_password = Column(String, default="")
    smtp_from = Column(String, default="")
    smtp_tls = Column(Boolean, default=True, nullable=False)
    # Copy of the database dropped on a USB key or a synced cloud folder.
    backup_dir = Column(String, default="")
    backup_auto = Column(Boolean, default=True, nullable=False)
    backup_keep = Column(Integer, default=30, nullable=False)
    # Mirror the database into that folder after every sale.
    backup_on_sale = Column(Boolean, default=False, nullable=False)
    last_backup_at = Column(DateTime, nullable=True)
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
    logo = Column(Text, default="")  # data URL, falls back to the company logo
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
    # Cash handed over by the customer, used to print the change given back.
    paid_amount = Column(Float, default=0, nullable=False)
    # Discount granted at the counter, already deducted from the total.
    discount = Column(Float, default=0, nullable=False)
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


class SecurityLog(Base):
    """Who did what on the accounts; passwords are never written here."""

    __tablename__ = "security_log"

    id = Column(Integer, primary_key=True, index=True)
    at = Column(DateTime, default=utcnow, index=True)
    event = Column(String, default="", index=True)
    identifier = Column(String, default="")
    detail = Column(Text, default="")
    station = Column(String, default="")
    success = Column(Boolean, default=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    user = relationship("User")


class RecoveryKey(Base):
    """Hashed key letting an administrator regain access to a locked shop."""

    __tablename__ = "recovery_keys"

    id = Column(Integer, primary_key=True, index=True)
    key_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    used_at = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


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


class Order(Base):
    """Customer order: goods promised now, handed over on delivery."""

    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    customer_name = Column(String, default="")
    date = Column(DateTime, default=utcnow)
    expected_date = Column(DateTime, nullable=True)
    # En attente, Confirmée, Livrée, Annulée
    status = Column(String, default="En attente", index=True)
    total = Column(Float, default=0)
    discount = Column(Float, default=0)  # granted on the whole document
    deposit = Column(Float, default=0)  # advance already paid
    price_mode = Column(String, default="detail")
    delivery_address = Column(String, default="")
    payment_terms = Column(String, default="")
    delivery_terms = Column(String, default="")
    note = Column(Text, default="")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    customer = relationship("Customer")
    created_by = relationship("User")
    items = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan"
    )
    deliveries = relationship(
        "Delivery", back_populates="order", cascade="all, delete-orphan"
    )
    # The receivable opened on delivery, read-only: it carries the settlements
    # booked in Dettes & créances for this order.
    receivables = relationship(
        "Debt",
        primaryjoin=(
            "and_(foreign(Debt.reference) == Order.reference,"
            " Debt.kind == 'creance')"
        ),
        viewonly=True,
    )

    @property
    def paid(self) -> float:
        """Money really received: the deposit plus the settlements booked."""
        settled = sum(debt.paid for debt in self.receivables)
        return round((self.deposit or 0) + settled, 2)

    @property
    def balance(self) -> float:
        """What the customer still owes; a delivery never pays anything."""
        return max(round((self.total or 0) - self.paid, 2), 0)

    @property
    def delivery_status(self) -> str:
        """Where the goods are, regardless of the money."""
        if self.status == "Annulée":
            return "Annulé"
        delivered = sum((item.delivered_quantity or 0) for item in self.items)
        ordered = sum(item.quantity for item in self.items)
        if delivered <= 0:
            return "En attente"
        return "Livré" if delivered >= ordered else "Partiellement livré"

    @property
    def payment_status(self) -> str:
        """Where the money is, regardless of the goods."""
        if self.status == "Annulée":
            return "Annulé"
        paid = self.paid
        if paid <= 0.009:
            return "Non payé"
        if self.balance <= 0.009:
            return "Payé"
        return "Partiellement payé"


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    reference = Column(String, default="")
    unit = Column(String, default="u")
    quantity = Column(Integer, default=1)
    # Quantity handed over by the validated delivery notes of this order.
    delivered_quantity = Column(Integer, default=0, nullable=False)
    unit_price = Column(Float, default=0)
    discount = Column(Float, default=0)
    subtotal = Column(Float, default=0)

    order = relationship("Order", back_populates="items")
    product = relationship("Product")

    @property
    def remaining_quantity(self) -> int:
        return max(self.quantity - (self.delivered_quantity or 0), 0)


class Delivery(Base):
    """Delivery note issued when an order leaves the shop."""

    __tablename__ = "deliveries"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    # A delivery note may stand alone, without any order behind it.
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    customer_name = Column(String, default="")
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    date = Column(DateTime, default=utcnow)
    # Brouillon, Validé, Annulé
    status = Column(String, default="Validé", index=True)
    validated_at = Column(DateTime, nullable=True)
    address = Column(String, default="")
    carrier = Column(String, default="")  # person or company delivering
    recipient = Column(String, default="")  # who signed for the goods
    note = Column(Text, default="")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    order = relationship("Order", back_populates="deliveries")
    customer = relationship("Customer")
    sale = relationship("Sale")
    created_by = relationship("User")
    items = relationship(
        "DeliveryItem", back_populates="delivery", cascade="all, delete-orphan"
    )

    @property
    def order_reference(self) -> str:
        return self.order.reference if self.order else ""


class DeliveryItem(Base):
    """One line of a delivery note: what was ordered and what really left."""

    __tablename__ = "delivery_items"

    id = Column(Integer, primary_key=True, index=True)
    delivery_id = Column(Integer, ForeignKey("deliveries.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    reference = Column(String, default="")
    unit = Column(String, default="u")
    ordered_quantity = Column(Integer, default=0)
    previously_delivered = Column(Integer, default=0)
    quantity = Column(Integer, default=0)  # handed over by this note
    unit_price = Column(Float, default=0)
    subtotal = Column(Float, default=0)
    observation = Column(String, default="")

    delivery = relationship("Delivery", back_populates="items")
    product = relationship("Product")


class ActionLog(Base):
    """Undo/redo history of the administrator's edits.

    ``entries`` is a JSON list of row snapshots ({table, pk, before, after});
    undoing writes ``before`` back, redoing writes ``after`` again.
    """

    __tablename__ = "action_log"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, default="")
    entries = Column(Text, default="[]")
    at = Column(DateTime, default=utcnow)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # False once undone; a redo sets it back to True.
    is_applied = Column(Boolean, default=True, nullable=False)

    user = relationship("User")


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


class Purchase(Base):
    """Supply order sent to a supplier: goods bought to refill the stock."""

    __tablename__ = "purchases"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    supplier_name = Column(String, default="")
    date = Column(DateTime, default=utcnow)
    expected_date = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    # En attente, Reçu partiellement, Reçu, Annulé
    status = Column(String, default="En attente", index=True)
    total = Column(Float, default=0)
    paid = Column(Float, default=0)  # already settled with the supplier
    invoice_number = Column(String, default="")  # supplier invoice
    note = Column(Text, default="")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    supplier = relationship("Supplier")
    created_by = relationship("User")
    items = relationship(
        "PurchaseItem", back_populates="purchase", cascade="all, delete-orphan"
    )

    @property
    def balance(self) -> float:
        return max(self.total - (self.paid or 0), 0)


class PurchaseItem(Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    quantity = Column(Integer, default=1)  # ordered
    received_quantity = Column(Integer, default=0)  # already in stock
    unit_cost = Column(Float, default=0)  # purchase price
    subtotal = Column(Float, default=0)

    purchase = relationship("Purchase", back_populates="items")
    product = relationship("Product")


class LicenseState(Base):
    """Licence this installation received from the central server.

    Only a cache: every field comes from a statement signed by the server, so
    editing this row does not grant anything (the signature stops matching).
    """

    __tablename__ = "license_state"

    id = Column(Integer, primary_key=True, index=True)
    installation_uid = Column(String, default="", nullable=False)
    central_url = Column(String, default="")
    # Proof of identity handed out at registration.
    token = Column(String, default="")
    # Key of the central server, pinned when the installation registered.
    public_key = Column(Text, default="")
    # Signed statement replayed while offline.
    license_token = Column(Text, default="")
    client_name = Column(String, default="")
    license_key = Column(String, default="")
    plan_code = Column(String, default="")
    plan_name = Column(String, default="")
    status = Column(String, default="")
    features = Column(Text, default="")  # comma separated feature codes
    starts_at = Column(DateTime, nullable=True)
    ends_at = Column(DateTime, nullable=True)
    grace_days = Column(Integer, default=7)
    offline_days = Column(Integer, default=7)
    last_sync = Column(DateTime, nullable=True)
    last_error = Column(String, default="")
    # What the owner's last instructions already changed here, so a local
    # password change is not undone at every synchronisation.
    directives_state = Column(Text, default="")
    registered_at = Column(DateTime, default=utcnow)


class Debt(Base):
    """Money still owed: by a customer (créance) or to a supplier (dette).

    A credit sale opens one automatically; a purchase paid later can be
    written down by hand. What is left to pay is the amount minus the
    payments, so the history of the settlements is never lost.
    """

    __tablename__ = "debts"

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String, default="creance", index=True)  # creance, dette
    party = Column(String, default="")  # customer or supplier, as written
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=True)
    reference = Column(String, default="")
    amount = Column(Float, default=0)
    due_date = Column(DateTime, nullable=True)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    customer = relationship("Customer")
    supplier = relationship("Supplier")
    sale = relationship("Sale")
    created_by = relationship("User")
    payments = relationship(
        "DebtPayment", back_populates="debt", cascade="all, delete-orphan"
    )

    @property
    def paid(self) -> float:
        """Only the settlements still standing; a cancelled one pays nothing."""
        return round(
            sum(p.amount for p in self.payments if not p.cancelled), 2
        )

    @property
    def remaining(self) -> float:
        return round(self.amount - self.paid, 2)

    @property
    def settled(self) -> bool:
        return self.remaining <= 0.009

    @property
    def overdue(self) -> bool:
        if self.settled or self.due_date is None:
            return False
        due = self.due_date
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return due < utcnow()

    @property
    def days_late(self) -> int:
        """Days past the due date, zero while the term is not reached."""
        if not self.overdue or self.due_date is None:
            return 0
        due = self.due_date
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return (utcnow() - due).days

    @property
    def status(self) -> str:
        """Single source of truth for the four states shown everywhere."""
        if self.settled:
            return "Payé"
        if self.overdue:
            return "En retard"
        return "Partiellement payé" if self.paid > 0.009 else "Non payé"


class DebtPayment(Base):
    """A settlement, total or partial, of a debt or of a receivable."""

    __tablename__ = "debt_payments"

    id = Column(Integer, primary_key=True, index=True)
    debt_id = Column(Integer, ForeignKey("debts.id"), nullable=False)
    amount = Column(Float, default=0)
    date = Column(DateTime, default=utcnow)
    method = Column(String, default="Espèces")
    note = Column(Text, default="")
    reference = Column(String, default="")
    receipt_reference = Column(String, default="", index=True)
    cancelled = Column(Boolean, default=False)
    cancel_reason = Column(Text, default="")
    cancelled_at = Column(DateTime, nullable=True)
    cancelled_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    debt = relationship("Debt", back_populates="payments")
    created_by = relationship("User", foreign_keys=[created_by_id])
    cancelled_by = relationship("User", foreign_keys=[cancelled_by_id])


class Employee(Base):
    """A worker of the shop, paid every month through the payroll module."""

    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    matricule = Column(String, unique=True, index=True, nullable=False)
    last_name = Column(String, nullable=False)
    first_name = Column(String, default="")
    gender = Column(String, default="")  # M, F
    birth_date = Column(DateTime, nullable=True)
    phone = Column(String, default="")
    address = Column(String, default="")
    job = Column(String, default="")
    department = Column(String, default="")
    hired_at = Column(DateTime, nullable=True)
    contract = Column(String, default="CDI")  # configurable list
    status = Column(String, default="En poste")
    base_salary = Column(Float, default=0, nullable=False)
    payment_method = Column(String, default="Espèces")
    bank = Column(String, default="")
    account_number = Column(String, default="")
    social_number = Column(String, default="")  # CNPS
    email = Column(String, default="")
    note = Column(Text, default="")
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    payslips = relationship("Payslip", back_populates="employee")

    @property
    def full_name(self) -> str:
        return f"{self.last_name} {self.first_name}".strip()


class PayrollElement(Base):
    """A pay line the administrator configures: a gain or a deduction.

    Nothing legal is written in the code: the rate, the ceiling and the base
    are set from Paie → Paramètres, and a rule that changed keeps its old
    payslips untouched because every payslip stores its own computed lines.
    """

    __tablename__ = "payroll_elements"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    kind = Column(String, default="gain", index=True)  # gain, retenue
    mode = Column(String, default="fixe")  # fixe, pourcentage
    value = Column(Float, default=0, nullable=False)  # amount or percentage
    base = Column(String, default="base")  # base, brut, manuel
    ceiling = Column(Float, default=0, nullable=False)  # 0 = no ceiling
    # Applied to every worker unless the payslip drops the line.
    automatic = Column(Boolean, default=True, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    starts_on = Column(DateTime, nullable=True)
    ends_on = Column(DateTime, nullable=True)
    position = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=utcnow)


class Payslip(Base):
    """Payroll of one worker for one month, with its own frozen lines."""

    __tablename__ = "payslips"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    year = Column(Integer, default=0, nullable=False, index=True)
    month = Column(Integer, default=0, nullable=False, index=True)
    base_salary = Column(Float, default=0, nullable=False)
    gross = Column(Float, default=0, nullable=False)
    deductions = Column(Float, default=0, nullable=False)
    net = Column(Float, default=0, nullable=False)
    # Brouillon, Validée, Payée, Annulée
    status = Column(String, default="Brouillon", index=True)
    worked_days = Column(Float, default=0, nullable=False)
    absence_days = Column(Float, default=0, nullable=False)
    overtime_hours = Column(Float, default=0, nullable=False)
    overtime_rate = Column(Float, default=0, nullable=False)
    validated_at = Column(DateTime, nullable=True)
    paid_at = Column(DateTime, nullable=True)
    payment_method = Column(String, default="")
    cancel_reason = Column(Text, default="")
    note = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    employee = relationship("Employee", back_populates="payslips")
    created_by = relationship("User")
    lines = relationship(
        "PayslipLine",
        back_populates="payslip",
        cascade="all, delete-orphan",
        order_by="PayslipLine.position",
    )

    @property
    def period(self) -> str:
        return f"{self.month:02d}/{self.year}"


class PayslipLine(Base):
    """One gain or deduction printed on a payslip, with how it was computed."""

    __tablename__ = "payslip_lines"

    id = Column(Integer, primary_key=True, index=True)
    payslip_id = Column(Integer, ForeignKey("payslips.id"), nullable=False)
    element_id = Column(Integer, ForeignKey("payroll_elements.id"), nullable=True)
    kind = Column(String, default="gain")  # gain, retenue
    label = Column(String, default="")
    quantity = Column(Float, default=0, nullable=False)
    rate = Column(Float, default=0, nullable=False)
    base = Column(Float, default=0, nullable=False)
    amount = Column(Float, default=0, nullable=False)
    position = Column(Integer, default=0, nullable=False)

    payslip = relationship("Payslip", back_populates="lines")


class RolePermission(Base):
    """Right granted by the administrator to a role (seller, stock manager)."""

    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, index=True, nullable=False)
    permission = Column(String, index=True, nullable=False)
    allowed = Column(Boolean, default=False, nullable=False)
