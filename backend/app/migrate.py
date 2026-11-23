"""Lightweight, idempotent schema migrations.

SQLAlchemy's create_all() only creates missing tables, not missing columns on
existing tables. This adds columns introduced after the first release so that
databases created by earlier versions keep working, on SQLite as well as on the
shared PostgreSQL server.
"""

import logging
import re

from sqlalchemy import inspect, literal, select, text
from sqlalchemy.orm import Session

from .accounting_ledger import seed_accounts

from .database import engine
from .models import AppMigration, CashClosure, CashMovement, Delivery, Depot, DepotStock, DepotTransfer, DepotTransferItem, Product, RolePermission, User, Workstation
from .stock import default_id, reconcile
from .permissions import CONFIGURABLE_ROLES, DEFAULTS, PERMISSIONS
from .paths import log_path

TRUE_LITERAL = "1" if engine.dialect.name == "sqlite" else "TRUE"
FALSE_LITERAL = "0" if engine.dialect.name == "sqlite" else "FALSE"

# table -> column -> SQL type/default appended to "ALTER TABLE ... ADD COLUMN".
COLUMNS: dict[str, dict[str, str]] = {
    "offline_devices": {"workstation_ip": "VARCHAR NOT NULL DEFAULT ''", "last_seen": "TIMESTAMP"},
    "offline_events": {"resolution": "TEXT NOT NULL DEFAULT ''"},
    "change_log": {"product_ids": "TEXT"},
    "cash_movements": {"return_id": "INTEGER", "client_id": "VARCHAR(64)"},
    "inventory_counts": {"counts_json": "TEXT NOT NULL DEFAULT '{}'", "client_updated_at": "TIMESTAMP", "client_id": "VARCHAR NOT NULL DEFAULT ''"},
    "stock_lots": {"depot_id": "INTEGER", "unit_cost": "FLOAT DEFAULT NULL"},
    "stock_movements": {"depot_id": "INTEGER"},
    "expenses": {"payment_method": "VARCHAR", "bank_account_id": "INTEGER"},
    "debts": {"purchase_id": "INTEGER", "cancelled": f"BOOLEAN DEFAULT {FALSE_LITERAL}"},
    "sale_returns": {"cash_session_id": "INTEGER", "refund_method": "VARCHAR DEFAULT 'Avoir'", "vat_rate_snapshot": "FLOAT"},
    "purchases": {"vat_rate_snapshot": "FLOAT", "payment_method": "VARCHAR", "bank_account_id": "INTEGER"},
    "users": {
        "is_active": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "role": "VARCHAR DEFAULT 'admin'",
        "photo": "TEXT DEFAULT ''",
        "notification_kinds": "VARCHAR DEFAULT ''",
    },
    "notifications": {
        "read_by": "TEXT DEFAULT '[]'",
    },
    "suppliers": {
        "logo": "TEXT DEFAULT ''",
    },
    "customers": {
        "credit_limit": "FLOAT DEFAULT 0",
    },
    "sales": {
        "vat_rate_snapshot": "FLOAT",
        "created_by_id": "INTEGER",
        "note": "TEXT DEFAULT ''",
        "receipt_footer": "TEXT DEFAULT ''",
        "cash_session_id": "INTEGER",
        "print_count": "INTEGER DEFAULT 0",
        "client_id": "VARCHAR",
        "price_mode": "VARCHAR DEFAULT 'detail'",
        "paid_amount": "FLOAT DEFAULT 0",
        "discount": "FLOAT DEFAULT 0",
        "is_gift": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
    },
    "products": {
        "client_uuid": "VARCHAR(64)",
        "rayon": "VARCHAR",
        "emplacement": "VARCHAR",
        "qr_code": "VARCHAR DEFAULT ''",
        "barcode": "VARCHAR DEFAULT ''",
        "image": "TEXT DEFAULT ''",
        "wholesale_price": "FLOAT DEFAULT 0",
    },
    "company_settings": {
        "offline_enabled": f"BOOLEAN NOT NULL DEFAULT {TRUE_LITERAL}",
        "offline_authorization_hours": "INTEGER NOT NULL DEFAULT 24",
        "receipt_format": "VARCHAR DEFAULT 'A4'",
        "logo": "TEXT DEFAULT ''",
        "printer_name": "VARCHAR DEFAULT ''",
        "auto_print_cash": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "mobile_money_to_cash": f"BOOLEAN NOT NULL DEFAULT {TRUE_LITERAL}",
        "expiry_critical_days": "INTEGER DEFAULT 7",
        "expiry_alert_days": "INTEGER DEFAULT 30",
        "expiry_watch_days": "INTEGER DEFAULT 60",
        "smtp_host": "VARCHAR DEFAULT ''",
        "smtp_port": "INTEGER DEFAULT 587",
        "smtp_user": "VARCHAR DEFAULT ''",
        "smtp_password": "VARCHAR DEFAULT ''",
        "smtp_from": "VARCHAR DEFAULT ''",
        "smtp_tls": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "about": "TEXT DEFAULT ''",
        "city": "VARCHAR DEFAULT ''",
        "backup_dir": "VARCHAR DEFAULT ''",
        "phone2": "VARCHAR DEFAULT ''",
        "country": "VARCHAR DEFAULT ''",
        "rccm": "VARCHAR DEFAULT ''",
        "ncc": "VARCHAR DEFAULT ''",
        "capital_social": "VARCHAR DEFAULT ''",
        "regime_fiscal": "VARCHAR DEFAULT ''",
        "document_layouts": "TEXT DEFAULT ''",
        "backup_auto": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "backup_keep": "INTEGER DEFAULT 30",
        "backup_on_sale": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "last_backup_at": "TIMESTAMP",
        "backup_auto_enabled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "backup_frequency": "VARCHAR DEFAULT 'daily'",
        "backup_time": "VARCHAR DEFAULT '20:00'",
        "backup_weekday": "INTEGER DEFAULT 0",
        "backup_monthday": "INTEGER DEFAULT 1",
        "last_backup_status": "VARCHAR DEFAULT ''",
        "last_backup_error": "TEXT DEFAULT ''",
        "drive_enabled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "drive_folder_name": "VARCHAR DEFAULT 'EasyGest Sauvegardes'",
        "drive_folder_id": "VARCHAR DEFAULT ''",
        "drive_keep": "INTEGER DEFAULT 30",
        "drive_last_upload_at": "TIMESTAMP",
        "drive_last_status": "VARCHAR DEFAULT ''",
        "drive_last_error": "TEXT DEFAULT ''",
        "drive_last_file_id": "VARCHAR DEFAULT ''",
        "drive_account_email": "VARCHAR DEFAULT ''",
        "network_restrict_workstations": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "support_whatsapp": "VARCHAR DEFAULT '0710069059'",
        "support_email": "VARCHAR DEFAULT 'ankouame022@gmail.com'",
        "vat_rate": "FLOAT DEFAULT 0",
        "drawer_enabled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "drawer_port": "VARCHAR DEFAULT ''",
        "drawer_code": "VARCHAR DEFAULT '27,112,0,25,250'",
        "drawer_open_after_sale": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "printing_config": "TEXT DEFAULT ''",
        "fne_enabled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "fne_environment": "VARCHAR DEFAULT 'test'",
        "fne_api_url": "VARCHAR DEFAULT ''",
        "fne_token_url": "VARCHAR DEFAULT ''",
        "fne_client_id": "VARCHAR DEFAULT ''",
        "fne_client_secret": "VARCHAR DEFAULT ''",
        "fne_api_key": "VARCHAR DEFAULT ''",
    },
    "orders": {
        "discount": "FLOAT DEFAULT 0",
        "payment_terms": "VARCHAR DEFAULT ''",
        "delivery_terms": "VARCHAR DEFAULT ''",
    },
    "proformas": {
        "discount": "FLOAT DEFAULT 0",
        # Documents written before quotes existed were all proformas.
        "kind": "VARCHAR DEFAULT 'proforma'",
        "status": "VARCHAR DEFAULT 'Brouillon'",
        "converted_from_id": "INTEGER",
        "order_id": "INTEGER",
    },
    "proforma_items": {
        "reference": "VARCHAR DEFAULT ''",
        "unit": "VARCHAR DEFAULT 'u'",
        "discount": "FLOAT DEFAULT 0",
    },
    "order_items": {
        "reference": "VARCHAR DEFAULT ''",
        "unit": "VARCHAR DEFAULT 'u'",
        "delivered_quantity": "INTEGER DEFAULT 0",
        "discount": "FLOAT DEFAULT 0",
    },
    "deliveries": {
        "customer_id": "INTEGER",
        "customer_name": "VARCHAR DEFAULT ''",
        "status": "VARCHAR DEFAULT 'Validé'",
        "validated_at": "TIMESTAMP",
    },
    "sale_items": {
        "packaging_divisor": "INTEGER",
        "scanned_code": "VARCHAR", "scanned_label": "VARCHAR",
        # Per-line discount at the register (proforma/order lines had it).
        "discount": "FLOAT DEFAULT 0",
    },
    "debt_payments": {
        "bank_account_id": "INTEGER",
        "cash_session_id": "INTEGER",
        "reference": "VARCHAR DEFAULT ''",
        "receipt_reference": "VARCHAR DEFAULT ''",
        "cancelled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "cancel_reason": "TEXT DEFAULT ''",
        "cancelled_at": "TIMESTAMP",
        "cancelled_by_id": "INTEGER",
    },
    "cash_sessions": {
        "offline_mobile_money_to_cash": "BOOLEAN",
        "kept_balance": "FLOAT",
        "remitted_amount": "FLOAT",
        "global_closure_id": "INTEGER",
        "business_day": "VARCHAR DEFAULT ''",
        "workstation": "VARCHAR",
        "z_report": "TEXT DEFAULT ''",
    },
    "license_state": {
        "directives_state": "TEXT DEFAULT ''",
        "support": "TEXT DEFAULT ''",
    },
}

for _table in ("products", "sale_items", "sale_return_items", "purchase_items", "stock_movements", "stock_transfer_items", "proforma_items", "order_items", "delivery_items"):
    COLUMNS.setdefault(_table, {}).update({
        "base_unit": "VARCHAR DEFAULT 'pièce'",
        "packaging_unit": "VARCHAR DEFAULT ''",
        "units_per_packaging": "INTEGER DEFAULT 1",
    })
COLUMNS["products"]["packaging_sale_price"] = "FLOAT DEFAULT NULL"
COLUMNS["products"]["active"] = f"BOOLEAN NOT NULL DEFAULT {TRUE_LITERAL}"
COLUMNS.setdefault("price_history", {})["purchase_reference"] = "VARCHAR DEFAULT NULL"
COLUMNS["products"]["wholesale_packaging_price"] = "FLOAT DEFAULT NULL"
COLUMNS["products"].update({
    "semi_wholesale_price": "FLOAT DEFAULT NULL",
    "supplier_purchase_price": "FLOAT DEFAULT NULL",
    "semi_wholesale_min_qty": "INTEGER DEFAULT NULL",
    "wholesale_min_qty": "INTEGER DEFAULT NULL",
})
COLUMNS["sale_items"]["packaging_id"] = "INTEGER DEFAULT NULL"
COLUMNS["purchase_items"]["packaging_id"] = "INTEGER DEFAULT NULL"
COLUMNS["sales"]["discount_by_id"] = "INTEGER DEFAULT NULL"
COLUMNS["sale_items"].update({
    "price_tier": "VARCHAR DEFAULT 'detail'",
    "catalog_unit_price": "FLOAT DEFAULT NULL",
    "unit_cost": "FLOAT DEFAULT NULL",
})
COLUMNS["sale_return_items"].update({
    "sale_item_id": "INTEGER DEFAULT NULL",
    "unit_cost": "FLOAT DEFAULT NULL",
})
COLUMNS["company_settings"]["pos_display"] = "TEXT DEFAULT '{}'"
COLUMNS["company_settings"]["allow_negative_stock_sale"] = f"BOOLEAN NOT NULL DEFAULT {FALSE_LITERAL}"
COLUMNS["sale_items"].update({
    "sold_unit": "VARCHAR DEFAULT 'pièce'",
    "packaging_quantity": "INTEGER DEFAULT 0",
    "piece_quantity": "INTEGER DEFAULT NULL",
    "base_quantity": "INTEGER DEFAULT NULL",
    "base_unit_price": "FLOAT DEFAULT NULL",
    "packaging_sale_price": "FLOAT DEFAULT NULL",
})

INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_products_client_uuid ON products (client_uuid)",
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_sales_client_id ON sales (client_id)",
]

# The product was renamed: bases created before EasyGest still carry the old
# default company name, which the user never chose.
OLD_COMPANY_NAME = "Référence Informatique"
NEW_COMPANY_NAME = "EasyGest"


def _columns(insp, table: str) -> set[str]:
    return {c["name"] for c in insp.get_columns(table)}


def _relax_delivery_order(conn, insp, columns=None) -> None:
    """Delivery notes may now stand alone, so ``order_id`` accepts NULL."""
    if columns is None:
        columns = {column["name"]: column for column in insp.get_columns("deliveries")}
    column = columns.get("order_id")
    if column is None or column["nullable"]:
        return
    if engine.dialect.name != "sqlite":
        conn.execute(
            text("ALTER TABLE deliveries ALTER COLUMN order_id DROP NOT NULL")
        )
        return
    names = list(columns)
    columns = ", ".join(names)
    # SQLite index names stay global and follow the renamed table, so they are
    # dropped before the new table recreates them.
    old_indexes = [index["name"] for index in insp.get_indexes("deliveries")]
    conn.execute(text("ALTER TABLE deliveries RENAME TO deliveries_old"))
    for name in old_indexes:
        if name:
            conn.execute(text(f'DROP INDEX IF EXISTS "{name}"'))
    Delivery.__table__.create(bind=conn)
    conn.execute(
        text(
            f"INSERT INTO deliveries ({columns}) "
            f"SELECT {columns} FROM deliveries_old"
        )
    )
    conn.execute(text("DROP TABLE deliveries_old"))


def _treasury_permissions(conn) -> None:
    marker = "treasury_permissions_v1"
    AppMigration.__table__.create(bind=conn, checkfirst=True)
    if conn.execute(select(AppMigration.name).where(AppMigration.name == marker)).first():
        return
    new_keys = {
        "tresorerie_consulter", "recette_enregistrer", "soldes_consulter",
        "caisse_operations", "clotures_consulter",
    }
    cleanup_keys = {
        "versements_gerer", "versements_valider", "depenses_gerer",
        "comptabilite", "dettes", "dettes_gerer", "dettes_regler",
    }
    rows = conn.execute(select(RolePermission.__table__)).mappings().all()
    stored = {(row["role"], row["permission"]): row for row in rows}
    existing_install = bool(rows) or conn.execute(select(User.id).limit(1)).first() is not None
    legacy = {
        "vendeur": {"caisse", "caisse_fermer", "caisse_z", "vente_nouvelle", "assistance"},
        "gestionnaire": {"produits", "inventaire", "fournisseurs", "categories", "approvisionnements", "assistance"},
    }
    for role in CONFIGURABLE_ROLES:
        legacy_defaults = legacy[role] if existing_install else DEFAULTS[role]
        for key in PERMISSIONS:
            row = stored.get((role, key))
            allowed = row["allowed"] if row else key in legacy_defaults
            if key in new_keys or (role == "vendeur" and key in cleanup_keys):
                allowed = False
            if row and (key in new_keys or (role == "vendeur" and key in cleanup_keys)):
                conn.execute(RolePermission.__table__.update().where(
                    RolePermission.role == role, RolePermission.permission == key
                ).values(allowed=allowed))
            elif not row:
                conn.execute(RolePermission.__table__.insert().values(
                    role=role, permission=key, allowed=allowed
                ))
    conn.execute(AppMigration.__table__.insert().values(name=marker))


def _inventory_permissions(conn) -> None:
    marker = "inventory_session_permissions_v1"
    AppMigration.__table__.create(bind=conn, checkfirst=True)
    if conn.execute(select(AppMigration.name).where(AppMigration.name == marker)).first():
        return
    for role in CONFIGURABLE_ROLES:
        allowed = conn.execute(select(RolePermission.allowed).where(RolePermission.role == role, RolePermission.permission == "inventaire_appliquer")).scalar_one_or_none()
        if allowed is None:
            allowed = "inventaire_appliquer" in DEFAULTS[role]
        existing = conn.execute(select(RolePermission.id).where(RolePermission.role == role, RolePermission.permission == "inventaire_valider")).scalar_one_or_none()
        if existing is None:
            conn.execute(RolePermission.__table__.insert().values(role=role, permission="inventaire_valider", allowed=allowed))
        else:
            conn.execute(RolePermission.__table__.update().where(RolePermission.id == existing).values(allowed=allowed))
    conn.execute(AppMigration.__table__.insert().values(name=marker))


def _packaging_retail_from_wholesale() -> None:
    from . import backup

    marker = "packaging_retail_from_wholesale_v1"
    with engine.connect() as conn:
        if "product_packagings" not in inspect(conn).get_table_names():
            return
        AppMigration.__table__.create(bind=conn, checkfirst=True)
        conn.commit()
        if conn.execute(select(AppMigration.name).where(AppMigration.name == marker)).first():
            return
        count = conn.execute(text("SELECT COUNT(*) FROM product_packagings WHERE price_gros > 0 AND (price_detail IS NULL OR price_detail <> price_gros)")).scalar_one()
    if count:
        try:
            with Session(engine) as db:
                backup.create(db, reason="migration-packaging-retail-v1", drive_background=False, mirror_required=False)
        except Exception:
            logging.getLogger(__name__).exception("%s: sauvegarde locale impossible, migration différée", marker)
            return
    with engine.begin() as conn:
        if conn.execute(select(AppMigration.name).where(AppMigration.name == marker)).first():
            return
        result = conn.execute(text("UPDATE product_packagings SET price_detail = price_gros WHERE price_gros > 0 AND (price_detail IS NULL OR price_detail <> price_gros)"))
        conn.execute(AppMigration.__table__.insert().values(name=marker))
        logging.getLogger(__name__).warning("%s: %s conditionnements mis à jour", marker, result.rowcount)


def _schema_columns(conn):
    inspector = inspect(conn)
    return {table: {column["name"]: column for column in inspector.get_columns(table)}
            for table in inspector.get_table_names()}


def _fractional_quantities(conn, columns=None):
    if conn.dialect.name != "postgresql":
        return
    columns = _schema_columns(conn) if columns is None else columns
    quote = conn.dialect.identifier_preparer.quote
    for table in Product.metadata.tables.values():
        if table.name not in columns:
            continue
        existing = {name: column["type"] for name, column in columns[table.name].items()}
        for column in table.columns:
            if getattr(column.type, "scale", None) == 6 and str(existing.get(column.name, "")).upper() in ("INTEGER", "BIGINT", "SMALLINT"):
                name = quote(column.name)
                conn.execute(text(f"ALTER TABLE {quote(table.name)} ALTER COLUMN {name} TYPE NUMERIC(24,6) USING {name}::NUMERIC(24,6)"))


def configure_logging():
    logger = logging.getLogger(__name__)
    target = str(log_path().resolve())
    if not any(getattr(handler, "baseFilename", None) == target for handler in logger.handlers):
        handler = logging.FileHandler(target, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    logger.propagate = False


def migrate() -> None:
    tables = set(inspect(engine).get_table_names())
    for table in Product.metadata.sorted_tables:
        if table.name not in tables:
            _migration_step(f"table {table.name}", lambda conn, table=table: table.create(conn, checkfirst=True))
    with engine.connect() as conn:
        columns = _schema_columns(conn)
    for table, definitions in COLUMNS.items():
        for column, definition in definitions.items():
            _add_column(table, column, definition, columns)
    _repair_model_columns(columns)
    _migration_step("fractional quantities", lambda conn: _fractional_quantities(conn, columns))
    for statement in INDEXES + [
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_cash_movements_client_id ON cash_movements (client_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_debts_purchase_id ON debts (purchase_id)",
        "CREATE INDEX IF NOT EXISTS ix_stock_movements_date ON stock_movements (date)",
        "CREATE INDEX IF NOT EXISTS ix_products_active_name ON products (active, name)",
        "CREATE INDEX IF NOT EXISTS ix_stock_movements_product_date_id ON stock_movements (product_id, date, id)",
        "CREATE INDEX IF NOT EXISTS ix_sale_items_product_id ON sale_items (product_id)",
        "CREATE INDEX IF NOT EXISTS ix_sale_items_sale_id ON sale_items (sale_id)",
    ]:
        _migration_step(statement, lambda conn, statement=statement: _create_index(conn, statement))
    for name, step in (
        ("delivery order", lambda conn: _relax_delivery_order(conn, inspect(conn), columns.get("deliveries", {}))),
        ("treasury permissions", _treasury_permissions),
        ("inventory permissions", _inventory_permissions),
        ("company name", lambda conn: conn.execute(text("UPDATE company_settings SET name=:new WHERE name=:old"), {"new": NEW_COMPANY_NAME, "old": OLD_COMPANY_NAME})),
        ("accounting accounts", seed_accounts),
        ("default depot", default_id),
        ("lot costs", _lot_costs),
        ("depot initialization", _initialize_depots),
    ):
        _migration_step(name, step)
    try:
        _packaging_retail_from_wholesale()
    except Exception:
        logging.getLogger(__name__).exception("Migration packaging retail failed; original data retained, retry at next startup")


def _migration_step(name, action):
    try:
        with engine.begin() as conn:
            action(conn)
        return True
    except Exception:
        logging.getLogger(__name__).exception("Migration %s failed; original data retained, retry at next startup", name)
        return False


def _add_column(table, column, definition, columns=None):
    logger = logging.getLogger(__name__)
    if columns is not None and (table not in columns or column in columns[table]):
        return
    try:
        with engine.begin() as conn:
            if columns is None:
                inspector = inspect(conn)
                if table not in inspector.get_table_names() or column in _columns(inspector, table):
                    return
            quote = conn.dialect.identifier_preparer.quote
            conn.execute(text(f"ALTER TABLE {quote(table)} ADD COLUMN {quote(column)} {definition}"))
        if columns is not None:
            columns[table][column] = {"name": column, "type": definition.split()[0], "nullable": "NOT NULL" not in definition.upper()}
        logger.warning("Schema repaired: added %s.%s", table, column)
    except Exception:
        with engine.connect() as conn:
            inspector = inspect(conn)
            if table in inspector.get_table_names():
                existing = {item["name"]: item for item in inspector.get_columns(table)}
                if column in existing:
                    if columns is not None:
                        columns[table][column] = existing[column]
                    return
        logger.exception("Schema repair failed: %s.%s; retry at next startup", table, column)


def _repair_model_columns(actual=None):
    if actual is None:
        with engine.connect() as conn:
            actual = _schema_columns(conn)
    for table in Product.metadata.sorted_tables:
        for column in table.columns:
            if column.name in actual.get(table.name, set()):
                continue
            if column.primary_key:
                logging.getLogger(__name__).error("Schema repair requires manual recovery: %s.%s is a missing primary key", table.name, column.name)
                continue
            definition = str(column.type.compile(dialect=engine.dialect))
            if not column.nullable:
                if column.server_default is not None:
                    default = engine.dialect.ddl_compiler(engine.dialect, None).get_column_default_string(column)
                elif column.default is not None and column.default.is_scalar:
                    default = str(literal(column.default.arg, type_=column.type).compile(dialect=engine.dialect, compile_kwargs={"literal_binds": True}))
                else:
                    default = None
                if default is None or not re.fullmatch(r"(?:'([^']|'')*'|[-+]?\d+(?:\.\d+)?|TRUE|FALSE)", default, re.I):
                    logging.getLogger(__name__).error("Schema repair requires manual recovery: %s.%s has no safe default", table.name, column.name)
                    continue
                definition += f" NOT NULL DEFAULT {default}"
            _add_column(table.name, column.name, definition, actual)


def _create_index(conn, statement):
    match = re.search(r"CREATE UNIQUE INDEX IF NOT EXISTS (\w+) ON (\w+) \(([^)]+)\)", statement)
    if match:
        name, table, columns = match.groups()
        if name not in {index["name"] for index in inspect(conn).get_indexes(table)}:
            columns = [column.strip() for column in columns.split(",")]
            groups = conn.execute(text(f"SELECT {', '.join(columns)} FROM {table} WHERE {' AND '.join(column + ' IS NOT NULL' for column in columns)} GROUP BY {', '.join(columns)} HAVING COUNT(*) > 1")).all()
            for group in groups:
                params = {f"key{i}": value for i, value in enumerate(group)}
                where = " AND ".join(f"{column}=:key{i}" for i, column in enumerate(columns))
                ids = list(conn.execute(text(f"SELECT id FROM {table} WHERE {where} ORDER BY id"), params).scalars())
                logging.getLogger(__name__).error("Unique index %s conflicts: %s row ids=%s; rows retained", name, table, ids)
    conn.execute(text(statement))


def _lot_costs(conn):
    marker = "stock_lot_cost_snapshot_v1"
    if not conn.execute(select(AppMigration.name).where(AppMigration.name == marker)).first():
        conn.execute(text("UPDATE stock_lots SET unit_cost = COALESCE((SELECT purchase_price FROM products WHERE products.id = stock_lots.product_id), 0) WHERE unit_cost IS NULL"))
        conn.execute(AppMigration.__table__.insert().values(name=marker))


def _initialize_depots(conn):
    marker = "depot_stock_initialization_v1"
    if not conn.execute(select(AppMigration.name).where(AppMigration.name == marker)).first():
        for row in conn.execute(select(Product.id, Product.quantity)):
            reconcile(conn, row.id, row.quantity or 0)
        conn.execute(AppMigration.__table__.insert().values(name=marker))
