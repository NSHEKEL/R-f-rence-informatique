from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    event,
    select,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Index,
    String,
    Text,
    UniqueConstraint,
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
    # Comma-separated notification kinds the admin lets this user receive;
    # empty means "none" for a non-admin (admins are always subscribed to
    # everything).
    notification_kinds = Column(String, default="")
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
    # Administrative details printed on the commercial documents.
    phone2 = Column(String, default="")
    country = Column(String, default="")
    rccm = Column(String, default="")
    ncc = Column(String, default="")
    capital_social = Column(String, default="")
    regime_fiscal = Column(String, default="")
    currency = Column(String, default="FCFA")
    # VAT shown on receipts; prices are already tax inclusive.
    vat_rate = Column(Float, default=0.0, nullable=False)
    about = Column(Text, default="")  # free text shown on the "À propos" page
    city = Column(String, default="")  # magasin's city (multi-magasins)
    receipt_header = Column(Text, default="")
    receipt_footer = Column(Text, default="Merci de votre confiance !")
    receipt_format = Column(String, default="A4")  # A4, 80mm
    pos_display = Column(Text, default="{}", nullable=True)
    printer_name = Column(String, default="")  # printer shown in the print help
    auto_print_cash = Column(Boolean, default=True, nullable=False)
    # Electronic cash drawer: it is wired to the receipt printer (or to a
    # serial port) and opens when it receives its kick code.
    drawer_enabled = Column(Boolean, default=False, nullable=False)
    drawer_port = Column(String, default="")  # COM1, LPT1, \\\\PC\\CAISSE...
    drawer_code = Column(String, default="27,112,0,25,250")  # ESC p 0 25 250
    drawer_open_after_sale = Column(Boolean, default=True, nullable=False)
    # Expiry watch thresholds, in days: critical (soon), alert, watch.
    expiry_critical_days = Column(Integer, default=7, nullable=False)
    expiry_alert_days = Column(Integer, default=30, nullable=False)
    expiry_watch_days = Column(Integer, default=60, nullable=False)
    # Receipt and label printer settings, kept as JSON: they are a long list of
    # display switches that only the printing code reads.
    printing_config = Column(Text, default="")
    # Per-document-type layout overrides (JSON): logo position, blocks shown.
    document_layouts = Column(Text, default="")
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
    backup_auto_enabled = Column(Boolean, default=False, nullable=False)
    backup_frequency = Column(String, default="daily", nullable=False)
    backup_time = Column(String, default="20:00", nullable=False)
    backup_weekday = Column(Integer, default=0, nullable=False)
    backup_monthday = Column(Integer, default=1, nullable=False)
    last_backup_status = Column(String, default="", nullable=False)
    last_backup_error = Column(Text, default="", nullable=False)
    drive_enabled = Column(Boolean, default=False, nullable=False)
    drive_folder_name = Column(String, default="EasyGest Sauvegardes", nullable=False)
    drive_folder_id = Column(String, default="", nullable=False)
    drive_keep = Column(Integer, default=30, nullable=False)
    drive_last_upload_at = Column(DateTime, nullable=True)
    drive_last_status = Column(String, default="", nullable=False)
    drive_last_error = Column(Text, default="", nullable=False)
    drive_last_file_id = Column(String, default="", nullable=False)
    drive_account_email = Column(String, default="", nullable=False)
    network_restrict_workstations = Column(Boolean, default=False, nullable=False)
    # FNE (Facture Normalisée Électronique, DGI Côte d'Ivoire) : connexion à
    # l'API officielle de l'entreprise. Les secrets ne sont jamais renvoyés par
    # l'API de lecture — seul le drapeau fne_secret_configured le dit.
    fne_enabled = Column(Boolean, default=False, nullable=False)
    fne_environment = Column(String, default="test")  # test, production
    fne_api_url = Column(String, default="")
    fne_token_url = Column(String, default="")
    fne_client_id = Column(String, default="")
    fne_client_secret = Column(String, default="")
    fne_api_key = Column(String, default="")
    # "Assistance et support" contact points shown to every logged-in user.
    # Editable from the settings page; nothing here is a secret.
    support_whatsapp = Column(String, default="0710069059")
    support_email = Column(String, default="ankouame022@gmail.com")
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class Workstation(Base):
    __tablename__ = "workstations"

    id = Column(Integer, primary_key=True)
    ip = Column(String, unique=True, nullable=False, index=True)
    name = Column(String, default="", nullable=False)
    hostname = Column(String, default="", nullable=False)
    user_agent = Column(String, default="", nullable=False)
    status = Column(String, default="pending", nullable=False)
    first_seen = Column(DateTime, default=utcnow, nullable=False)
    last_seen = Column(DateTime, default=utcnow, nullable=False, index=True)
    last_user = Column(String, default="", nullable=False)


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
    # Ceiling on the customer's unpaid receivables; 0 means no limit.
    credit_limit = Column(Float, default=0)
    created_at = Column(DateTime, default=utcnow)

    sales = relationship("Sale", back_populates="customer")


class UnitSnapshot:
    base_unit = Column(String, default="pièce", nullable=True)
    packaging_unit = Column(String, default="", nullable=True)
    units_per_packaging = Column(Integer, default=1, nullable=True)

    @property
    def quantity_label(self):
        from .units import quantity_label
        return quantity_label(self.quantity, self.base_unit, self.packaging_unit, self.units_per_packaging)


class Product(UnitSnapshot, Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    sku = Column(String, unique=True, index=True, nullable=False)
    description = Column(Text, default="")
    rayon = Column(String, nullable=True)
    emplacement = Column(String, nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    purchase_price = Column(Float, default=0)
    sale_price = Column(Float, default=0)
    packaging_sale_price = Column(Float, nullable=True)
    wholesale_price = Column(Float, default=0)  # 0 = no wholesale price
    wholesale_packaging_price = Column(Float, nullable=True)
    semi_wholesale_price = Column(Float, nullable=True)
    supplier_purchase_price = Column(Float, nullable=True)
    semi_wholesale_min_qty = Column(Integer, nullable=True)
    wholesale_min_qty = Column(Integer, nullable=True)
    quantity = Column(Integer, default=0)
    min_stock = Column(Integer, default=5)
    qr_code = Column(String, default="")  # scan code, defaults to the SKU
    barcode = Column(String, default="", index=True)  # printed EAN-13 digits
    image = Column(Text, default="")  # data URL, optional
    created_at = Column(DateTime, default=utcnow)

    category = relationship("Category", back_populates="products")
    supplier = relationship("Supplier", back_populates="products")
    packagings = relationship("ProductPackaging", order_by="ProductPackaging.sort_order, ProductPackaging.id")


class ProductPackaging(Base):
    __tablename__ = "product_packagings"

    id = Column(Integer, primary_key=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    factor = Column(Integer, nullable=False)
    barcode = Column(String, nullable=True, index=True)
    price_detail = Column(Float, nullable=True)
    price_semi_gros = Column(Float, nullable=True)
    price_gros = Column(Float, nullable=True)
    purchase_price = Column(Float, nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)


class PriceHistory(Base):
    """One price change on an article, with who made it and when."""

    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(
        Integer, ForeignKey("products.id"), nullable=False, index=True
    )
    field = Column(String, default="")  # sale_price, purchase_price, ...
    old_value = Column(Float, default=0)
    new_value = Column(Float, default=0)
    changed_at = Column(DateTime, default=utcnow)
    changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    product = relationship("Product")
    changed_by = relationship("User")


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    date = Column(DateTime, default=utcnow)
    total = Column(Float, default=0)
    vat_rate_snapshot = Column(Float, nullable=True)
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
    discount_by_id = Column(Integer, nullable=True)
    # Gift sale: items leave the stock but are excluded from revenue.
    is_gift = Column(Boolean, default=False, nullable=False)
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
    payments = relationship(
        "SalePayment", back_populates="sale", cascade="all, delete-orphan"
    )

    @property
    def returned_total(self) -> float:
        return sum(r.total for r in self.returns)


class SalePayment(Base):
    """One leg of a mixed payment (Espèces + Mobile Money + ...)."""

    __tablename__ = "sale_payments"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    method = Column(String, default="Espèces")
    amount = Column(Float, default=0)

    sale = relationship("Sale", back_populates="payments")


class SaleItem(UnitSnapshot, Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    packaging_id = Column(Integer, ForeignKey("product_packagings.id"), nullable=True)
    price_tier = Column(String, default="detail")
    catalog_unit_price = Column(Float, nullable=True)
    unit_cost = Column(Float, nullable=True)
    sold_unit = Column(String, default="pièce", nullable=True)
    packaging_quantity = Column(Integer, default=0, nullable=True)
    piece_quantity = Column(Integer, nullable=True)
    base_quantity = Column(Integer, nullable=True)
    base_unit_price = Column(Float, nullable=True)
    packaging_sale_price = Column(Float, nullable=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    # Discount granted on this line only, deducted from its subtotal.
    discount = Column(Float, default=0)
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
            if line.sale_item_id == self.id or (line.sale_item_id is None and line.product_id == self.product_id)
        )


class SaleReturn(Base):
    """Credit note: goods given back, referencing the original ticket."""

    __tablename__ = "sale_returns"
    vat_rate_snapshot = Column(Float, nullable=True)

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True, index=True, nullable=False)
    sale_id = Column(Integer, ForeignKey("sales.id"), nullable=False)
    date = Column(DateTime, default=utcnow)
    total = Column(Float, default=0)
    reason = Column(Text, default="")
    cash_session_id = Column(Integer, ForeignKey("cash_sessions.id"), nullable=True)
    refund_method = Column(String, default="Avoir")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    sale = relationship("Sale", back_populates="returns")
    created_by = relationship("User")
    items = relationship(
        "SaleReturnItem", back_populates="sale_return", cascade="all, delete-orphan"
    )

    @property
    def sale_reference(self) -> str:
        return self.sale.reference if self.sale else ""


class SaleReturnItem(UnitSnapshot, Base):
    __tablename__ = "sale_return_items"

    id = Column(Integer, primary_key=True, index=True)
    return_id = Column(Integer, ForeignKey("sale_returns.id"), nullable=False)
    sale_item_id = Column(Integer, nullable=True)
    unit_cost = Column(Float, nullable=True)
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
    # Immutable Z-report snapshot (JSON) written once the session is closed.
    z_report = Column(Text, default="")

    opened_by = relationship("User", foreign_keys=[opened_by_id])
    closed_by = relationship("User", foreign_keys=[closed_by_id])
    sales = relationship("Sale", backref="cash_session")


class BankAccount(Base):
    """A company bank account receiving deposits from the tills."""

    __tablename__ = "bank_accounts"

    id = Column(Integer, primary_key=True, index=True)
    bank_name = Column(String, nullable=False)
    holder = Column(String, default="")  # titulaire du compte
    account_number = Column(String, default="")  # numéro ou IBAN
    label = Column(String, default="")  # intitulé
    currency = Column(String, default="FCFA")
    is_active = Column(Boolean, default=True, nullable=False)
    note = Column(Text, default="")
    created_at = Column(DateTime, default=utcnow)

    deposits = relationship("BankDeposit", back_populates="account")


class BankDeposit(Base):
    """Cash deposit from a till (or cash desk) to a bank account.

    A deposit is an internal treasury transfer: it never counts as revenue.
    """

    __tablename__ = "bank_deposits"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=False)
    cash_session_id = Column(
        Integer, ForeignKey("cash_sessions.id"), nullable=True
    )
    amount = Column(Float, nullable=False)
    deposit_date = Column(DateTime, default=utcnow)
    method = Column(String, default="Espèces")  # mode de versement
    reference = Column(String, default="")  # référence de transaction
    slip_number = Column(String, default="")  # numéro de bordereau
    note = Column(Text, default="")
    attachment = Column(String, default="")  # justificatif (nom du fichier)
    # en attente -> validé / rejeté / annulé (traçable)
    status = Column(String, default="en attente", nullable=False, index=True)
    reconciled = Column(Boolean, default=False, nullable=False)
    statement_ref = Column(String, default="")  # réf. du relevé bancaire
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    decided_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    account = relationship("BankAccount", back_populates="deposits")
    cash_session = relationship("CashSession")
    created_by = relationship("User", foreign_keys=[created_by_id])
    decided_by = relationship("User", foreign_keys=[decided_by_id])


class Expense(Base):
    """Business expense used by the accounting module."""

    __tablename__ = "expenses"
    payment_method = Column(String, nullable=True)
    bank_account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=True)

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)
    category = Column(String, default="Divers")
    amount = Column(Float, default=0)
    date = Column(DateTime, default=utcnow)
    note = Column(Text, default="")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_by = relationship("User")


class InventorySession(Base):
    __tablename__ = "inventory_sessions"

    id = Column(Integer, primary_key=True)
    reference = Column(String, nullable=False, unique=True)
    name = Column(String, nullable=False)
    scope_type = Column(String, nullable=False)
    scope_json = Column(Text, nullable=False, default="{}")
    blind = Column(Boolean, nullable=False, default=False)
    status = Column(String, nullable=False, default="draft")
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    validated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    validated_by_name = Column(String, nullable=True)
    validated_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=False, default="")


class InventoryCount(Base):
    __tablename__ = "inventory_counts"
    __table_args__ = (UniqueConstraint("session_id", "product_id"),)

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("inventory_sessions.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_snapshot = Column(Text, nullable=False)
    theoretical_qty = Column(Integer, nullable=False)
    physical_qty = Column(Integer, nullable=True)
    stock_after = Column(Integer, nullable=True)
    unit_cost = Column(Float, nullable=False)
    counted_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    counted_at = Column(DateTime, nullable=True)
    note = Column(Text, nullable=False, default="")


class StockMovement(UnitSnapshot, Base):
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


class StockLot(Base):
    """Tagged part of a product's stock carrying a lot number and expiry.

    Lot quantities are earmarked inside ``product.quantity``: the sum of a
    product's lots never exceeds its on-hand stock; the remainder stays
    "untagged". Sales consume lots FEFO (earliest expiry first).
    """

    __tablename__ = "stock_lots"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), index=True)
    lot_number = Column(String, default="")
    expiry_date = Column(DateTime, nullable=True)
    quantity = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    product = relationship("Product")
    created_by = relationship("User")


class StockTransfer(Base):
    """Stock sent to, or received from, another shop of the network.

    Each site records its own side: 'sortie' decrements stock, 'entree'
    increments it. The document keeps the counterpart store for audit.
    """

    __tablename__ = "stock_transfers"

    id = Column(Integer, primary_key=True, index=True)
    reference = Column(String, unique=True)
    direction = Column(String, default="sortie")  # sortie | entree
    store_name = Column(String, default="")
    note = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    items = relationship(
        "StockTransferItem", cascade="all, delete-orphan", back_populates="transfer"
    )
    created_by = relationship("User")


class StockTransferItem(UnitSnapshot, Base):
    __tablename__ = "stock_transfer_items"

    id = Column(Integer, primary_key=True, index=True)
    transfer_id = Column(
        Integer, ForeignKey("stock_transfers.id"), index=True
    )
    product_id = Column(Integer, ForeignKey("products.id"))
    product_name = Column(String, default="")
    quantity = Column(Integer, default=0)

    transfer = relationship("StockTransfer", back_populates="items")


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
    discount = Column(Float, default=0)
    note = Column(Text, default="")
    # A quote and a proforma share this table: only the wording differs.
    kind = Column(String, default="devis", index=True)
    status = Column(String, default="Brouillon", index=True)
    # Where the document went: its proforma, then its order.
    converted_from_id = Column(Integer, ForeignKey("proformas.id"), nullable=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    customer = relationship("Customer")
    order = relationship("Order")
    created_by = relationship("User")
    items = relationship(
        "ProformaItem", back_populates="proforma", cascade="all, delete-orphan"
    )


class ProformaItem(UnitSnapshot, Base):
    __tablename__ = "proforma_items"

    id = Column(Integer, primary_key=True, index=True)
    proforma_id = Column(Integer, ForeignKey("proformas.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    product_name = Column(String, default="")
    reference = Column(String, default="")
    unit = Column(String, default="u")
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)
    discount = Column(Float, default=0)
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


class OrderItem(UnitSnapshot, Base):
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


class DeliveryItem(UnitSnapshot, Base):
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
    # JSON list of user ids who marked it read (per-user read state).
    read_by = Column(Text, default="[]")
    created_at = Column(DateTime, default=utcnow)


class Purchase(Base):
    """Supply order sent to a supplier: goods bought to refill the stock."""

    __tablename__ = "purchases"
    vat_rate_snapshot = Column(Float, nullable=True)
    payment_method = Column(String, nullable=True)
    bank_account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=True)

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


class PurchaseItem(UnitSnapshot, Base):
    __tablename__ = "purchase_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=False)
    packaging_id = Column(Integer, ForeignKey("product_packagings.id"), nullable=True)
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
    # Support contacts signed inside the licence (JSON {phone,email,whatsapp}).
    support = Column(Text, default="")
    registered_at = Column(DateTime, default=utcnow)


class Debt(Base):
    """Money still owed: by a customer (créance) or to a supplier (dette).

    A credit sale opens one automatically; a purchase paid later can be
    written down by hand. What is left to pay is the amount minus the
    payments, so the history of the settlements is never lost.
    """

    __tablename__ = "debts"
    __table_args__ = (Index("ux_debts_purchase_id", "purchase_id", unique=True),)
    purchase_id = Column(Integer, ForeignKey("purchases.id"), nullable=True)

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


class CashMovement(Base):
    __tablename__ = "cash_movements"
    __table_args__ = (
        CheckConstraint("type IN ('in', 'out')", name="ck_cash_movements_type"),
        CheckConstraint("amount > 0", name="ck_cash_movements_amount"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("cash_sessions.id"), nullable=False, index=True)
    type = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    reason = Column(Text, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=utcnow)
    workstation = Column(String, default="")


class DebtPayment(Base):
    """A settlement, total or partial, of a debt or of a receivable."""

    __tablename__ = "debt_payments"
    bank_account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=True)

    id = Column(Integer, primary_key=True, index=True)
    debt_id = Column(Integer, ForeignKey("debts.id"), nullable=False)
    cash_session_id = Column(Integer, ForeignKey("cash_sessions.id"), nullable=True)
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


class AppMigration(Base):
    __tablename__ = "app_migrations"

    name = Column(String, primary_key=True)
    applied_at = Column(DateTime, default=utcnow)


class RolePermission(Base):
    """Right granted by the administrator to a role (seller, stock manager)."""

    __tablename__ = "role_permissions"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String, index=True, nullable=False)
    permission = Column(String, index=True, nullable=False)
    allowed = Column(Boolean, default=False, nullable=False)


class FneInvoice(Base):
    """Facture normalisée électronique rattachée à une vente.

    Le cycle de vie suit l'API officielle : une demande part en ``pending``,
    devient ``submitted`` quand la plateforme l'a acceptée pour traitement,
    ``certified`` quand la réponse officielle apporte la preuve (référence,
    numéro, sticker/QR), et ``rejected``/``error`` sinon. Une facture n'est
    jamais présentée comme normalisée sans la confirmation officielle.
    """

    __tablename__ = "fne_invoices"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(
        Integer, ForeignKey("sales.id"), unique=True, nullable=False
    )
    # pending, submitted, certified, rejected, error
    status = Column(String, default="pending", nullable=False, index=True)
    fne_reference = Column(String, default="")
    fne_number = Column(String, default="")
    fne_token = Column(String, default="")  # sticker / preuve renvoyée
    request_payload = Column(Text, default="")
    response_payload = Column(Text, default="")
    last_error = Column(Text, default="")
    attempts = Column(Integer, default=0, nullable=False)
    submitted_at = Column(DateTime, nullable=True)
    certified_at = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    sale = relationship("Sale")
    created_by = relationship("User")


class SupportRequest(Base):
    """Help request sent through the "Assistance et support" page.

    The row is stored locally first so the form only confirms after a real
    write, then mirrored to the owner's console at the next push (and right
    away through remote_sales.schedule()). Status and internal notes are
    managed on the console; the shop keeps the sent copy as history.
    """

    __tablename__ = "support_requests"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, default="", index=True)
    subject = Column(String, nullable=False)
    category = Column(String, default="assistance", index=True)
    message = Column(Text, nullable=False)
    status = Column(String, default="nouvelle", nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=utcnow)

    created_by = relationship("User")


SUPPORT_CATEGORIES = ("assistance", "bug", "suggestion", "critique", "autre")


class MobileOpApplied(Base):
    """Phone-issued operations already applied to this database.

    Guard against re-processing when the acknowledgement back to the central
    server was lost: a duplicated op is skipped instead of double-applied.
    """

    __tablename__ = "mobile_op_applied"

    remote_id = Column(String, primary_key=True)
    applied_at = Column(DateTime, default=utcnow)


class AccountingAccount(Base):
    __tablename__ = "accounting_accounts"

    number = Column(String, primary_key=True)
    label = Column(String, nullable=False)
    class_number = Column(Integer, nullable=False)
    type = Column(String, nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    is_system = Column(Boolean, nullable=False, default=False)


class AccountingSetting(Base):
    __tablename__ = "accounting_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=False)
    changed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    changed_by_name = Column(String, nullable=False)
    changed_at = Column(DateTime, default=utcnow, nullable=False)


@event.listens_for(Sale, "before_insert")
@event.listens_for(Purchase, "before_insert")
def capture_accounting_tax(mapper, connection, target):
    if target.vat_rate_snapshot is None:
        target.vat_rate_snapshot = connection.execute(select(CompanySettings.vat_rate).order_by(CompanySettings.id)).scalars().first()


@event.listens_for(SaleReturn, "before_insert")
def capture_return_tax(mapper, connection, target):
    if target.vat_rate_snapshot is None:
        target.vat_rate_snapshot = connection.execute(select(Sale.vat_rate_snapshot).where(Sale.id == target.sale_id)).scalar()


@event.listens_for(SaleItem, "before_insert")
@event.listens_for(ProformaItem, "before_insert")
@event.listens_for(OrderItem, "before_insert")
@event.listens_for(DeliveryItem, "before_insert")
@event.listens_for(SaleReturnItem, "before_insert")
@event.listens_for(PurchaseItem, "before_insert")
@event.listens_for(StockTransferItem, "before_insert")
@event.listens_for(StockMovement, "before_insert")
def capture_units(mapper, connection, target):
    if target.base_unit is None and target.product_id is not None:
        product = connection.execute(select(Product.base_unit, Product.packaging_unit, Product.units_per_packaging).where(Product.id == target.product_id)).first()
        if product:
            target.base_unit = product.base_unit or "pièce"
            target.packaging_unit = product.packaging_unit or ""
            target.units_per_packaging = product.units_per_packaging or 1
    if isinstance(target, SaleItem):
        if target.base_quantity is None:
            target.base_quantity = target.quantity
        if target.piece_quantity is None:
            target.piece_quantity = target.quantity
        if target.base_unit_price is None:
            target.base_unit_price = target.unit_price
