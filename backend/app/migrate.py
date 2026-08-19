"""Lightweight, idempotent schema migrations.

SQLAlchemy's create_all() only creates missing tables, not missing columns on
existing tables. This adds columns introduced after the first release so that
databases created by earlier versions keep working, on SQLite as well as on the
shared PostgreSQL server.
"""

from sqlalchemy import inspect, text

from .database import engine

TRUE_LITERAL = "1" if engine.dialect.name == "sqlite" else "TRUE"
FALSE_LITERAL = "0" if engine.dialect.name == "sqlite" else "FALSE"

# table -> column -> SQL type/default appended to "ALTER TABLE ... ADD COLUMN".
COLUMNS: dict[str, dict[str, str]] = {
    "users": {
        "is_active": f"BOOLEAN DEFAULT {TRUE_LITERAL}",
        "role": "VARCHAR DEFAULT 'admin'",
    },
    "sales": {
        "created_by_id": "INTEGER",
        "note": "TEXT DEFAULT ''",
        "receipt_footer": "TEXT DEFAULT ''",
        "cash_session_id": "INTEGER",
        "print_count": "INTEGER DEFAULT 0",
        "client_id": "VARCHAR",
        "price_mode": "VARCHAR DEFAULT 'detail'",
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
    },
    "cash_sessions": {
        "business_day": "VARCHAR DEFAULT ''",
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
        if "company_settings" in tables:
            conn.execute(
                text(
                    "UPDATE company_settings SET name = :new "
                    "WHERE name = :old"
                ),
                {"new": NEW_COMPANY_NAME, "old": OLD_COMPANY_NAME},
            )
