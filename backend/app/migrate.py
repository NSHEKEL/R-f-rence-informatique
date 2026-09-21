"""Lightweight, idempotent schema migrations.

SQLAlchemy's create_all() only creates missing tables, not missing columns on
existing tables. This adds columns introduced after the first release so that
databases created by earlier versions keep working, on SQLite as well as on the
shared PostgreSQL server.
"""

from sqlalchemy import inspect, text

from .database import engine
from .models import Delivery

TRUE_LITERAL = "1" if engine.dialect.name == "sqlite" else "TRUE"
FALSE_LITERAL = "0" if engine.dialect.name == "sqlite" else "FALSE"

# table -> column -> SQL type/default appended to "ALTER TABLE ... ADD COLUMN".
COLUMNS: dict[str, dict[str, str]] = {
    "users": {
        "is_active": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "role": "VARCHAR DEFAULT 'admin'",
        "photo": "TEXT DEFAULT ''",
    },
    "suppliers": {
        "logo": "TEXT DEFAULT ''",
    },
    "sales": {
        "created_by_id": "INTEGER",
        "note": "TEXT DEFAULT ''",
        "receipt_footer": "TEXT DEFAULT ''",
        "cash_session_id": "INTEGER",
        "print_count": "INTEGER DEFAULT 0",
        "client_id": "VARCHAR",
        "price_mode": "VARCHAR DEFAULT 'detail'",
        "paid_amount": "FLOAT DEFAULT 0",
        "discount": "FLOAT DEFAULT 0",
    },
    "products": {
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
        "smtp_host": "VARCHAR DEFAULT ''",
        "smtp_port": "INTEGER DEFAULT 587",
        "smtp_user": "VARCHAR DEFAULT ''",
        "smtp_password": "VARCHAR DEFAULT ''",
        "smtp_from": "VARCHAR DEFAULT ''",
        "smtp_tls": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "about": "TEXT DEFAULT ''",
        "backup_dir": "VARCHAR DEFAULT ''",
        "backup_auto": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "backup_keep": "INTEGER DEFAULT 30",
        "backup_on_sale": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "last_backup_at": "TIMESTAMP",
        "vat_rate": "FLOAT DEFAULT 0",
        "drawer_enabled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "drawer_port": "VARCHAR DEFAULT ''",
        "drawer_code": "VARCHAR DEFAULT '27,112,0,25,250'",
        "drawer_open_after_sale": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "printing_config": "TEXT DEFAULT ''",
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
    "debt_payments": {
        "reference": "VARCHAR DEFAULT ''",
        "receipt_reference": "VARCHAR DEFAULT ''",
        "cancelled": f"BOOLEAN DEFAULT {FALSE_LITERAL}",
        "cancel_reason": "TEXT DEFAULT ''",
        "cancelled_at": "TIMESTAMP",
        "cancelled_by_id": "INTEGER",
    },
    "cash_sessions": {
        "business_day": "VARCHAR DEFAULT ''",
    },
    "license_state": {
        "directives_state": "TEXT DEFAULT ''",
    },
}

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


def migrate() -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())

    with engine.begin() as conn:
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
        if "company_settings" in tables:
            conn.execute(
                text(
                    "UPDATE company_settings SET name = :new "
                    "WHERE name = :old"
                ),
                {"new": NEW_COMPANY_NAME, "old": OLD_COMPANY_NAME},
            )
