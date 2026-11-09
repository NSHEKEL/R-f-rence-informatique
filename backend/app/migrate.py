"""Lightweight, idempotent schema migrations.

SQLAlchemy's create_all() only creates missing tables, not missing columns on
existing tables. This adds columns introduced after the first release so that
databases created by earlier versions keep working, on SQLite as well as on the
shared PostgreSQL server.
"""

from sqlalchemy import inspect, select, text

from .accounting_ledger import seed_accounts

from .database import engine
from .models import AppMigration, CashMovement, Delivery, RolePermission, User, Workstation
from .permissions import CONFIGURABLE_ROLES, DEFAULTS, PERMISSIONS

TRUE_LITERAL = "1" if engine.dialect.name == "sqlite" else "TRUE"
FALSE_LITERAL = "0" if engine.dialect.name == "sqlite" else "FALSE"

# table -> column -> SQL type/default appended to "ALTER TABLE ... ADD COLUMN".
COLUMNS: dict[str, dict[str, str]] = {
    "expenses": {"payment_method": "VARCHAR", "bank_account_id": "INTEGER"},
    "debt_payments": {"bank_account_id": "INTEGER"},
    "debts": {"purchase_id": "INTEGER"},
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
        "rayon": "VARCHAR",
        "emplacement": "VARCHAR",
        "qr_code": "VARCHAR DEFAULT ''",
        "barcode": "VARCHAR DEFAULT ''",
        "image": "TEXT DEFAULT ''",
        "wholesale_price": "FLOAT DEFAULT 0",
    },
    "company_settings": {
        "receipt_format": "VARCHAR DEFAULT 'A4'",
        "logo": "TEXT DEFAULT ''",
        "printer_name": "VARCHAR DEFAULT ''",
        "auto_print_cash": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
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
        # Per-line discount at the register (proforma/order lines had it).
        "discount": "FLOAT DEFAULT 0",
    },
    "debt_payments": {
        "cash_session_id": "INTEGER",
        "reference": "VARCHAR DEFAULT ''",
        "receipt_reference": "VARCHAR DEFAULT ''",
        "cancelled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "cancel_reason": "TEXT DEFAULT ''",
        "cancelled_at": "TIMESTAMP",
        "cancelled_by_id": "INTEGER",
    },
    "cash_sessions": {
        "business_day": "VARCHAR DEFAULT ''",
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
COLUMNS["sale_items"].update({
    "sold_unit": "VARCHAR DEFAULT 'pièce'",
    "packaging_quantity": "INTEGER DEFAULT 0",
    "piece_quantity": "INTEGER DEFAULT NULL",
    "base_quantity": "INTEGER DEFAULT NULL",
    "base_unit_price": "FLOAT DEFAULT NULL",
    "packaging_sale_price": "FLOAT DEFAULT NULL",
})

INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS ix_sales_client_id ON sales (client_id)",
]

# The product was renamed: bases created before EasyGest still carry the old
# default company name, which the user never chose.
OLD_COMPANY_NAME = "Référence Informatique"
NEW_COMPANY_NAME = "EasyGest"


def _columns(insp, table: str) -> set[str]:
    return {c["name"] for c in insp.get_columns(table)}


def _relax_delivery_order(conn, insp) -> None:
    """Delivery notes may now stand alone, so ``order_id`` accepts NULL."""
    column = next(
        (c for c in insp.get_columns("deliveries") if c["name"] == "order_id"),
        None,
    )
    if column is None or column["nullable"]:
        return
    if engine.dialect.name != "sqlite":
        conn.execute(
            text("ALTER TABLE deliveries ALTER COLUMN order_id DROP NOT NULL")
        )
        return
    names = [c["name"] for c in insp.get_columns("deliveries")]
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


def migrate() -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())

    with engine.begin() as conn:
        insp = inspect(conn)
        Workstation.__table__.create(bind=conn, checkfirst=True)
        if "cash_sessions" in tables:
            CashMovement.__table__.create(bind=conn, checkfirst=True)
        for table, columns in COLUMNS.items():
            if table not in tables:
                continue
            existing = _columns(insp, table)
            for column, definition in columns.items():
                if column in existing:
                    continue
                conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
                )
        if "sales" in tables:
            for statement in INDEXES:
                conn.execute(text(statement))
        if "deliveries" in tables:
            _relax_delivery_order(conn, inspect(conn))
        if "role_permissions" in tables:
            _treasury_permissions(conn)
            _inventory_permissions(conn)
        if "company_settings" in tables:
            conn.execute(
                text(
                    "UPDATE company_settings SET name = :new "
                    "WHERE name = :old"
                ),
                {"new": NEW_COMPANY_NAME, "old": OLD_COMPANY_NAME},
            )
        if "debts" in tables:
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ux_debts_purchase_id ON debts (purchase_id)"))
        seed_accounts(conn)
