"""Lightweight, idempotent schema migrations for the SQLite dev database.

SQLAlchemy's create_all() only creates missing tables, not missing columns on
existing tables. This adds columns introduced after the first release so that
databases created by earlier versions keep working.
"""

from sqlalchemy import inspect, text

from .database import engine


def _columns(insp, table: str) -> set[str]:
    return {c["name"] for c in insp.get_columns(table)}


def migrate() -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())

    with engine.begin() as conn:
        if "users" in tables:
            user_cols = _columns(insp, "users")
            if "is_active" not in user_cols:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1")
                )
            if "role" not in user_cols:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT 'admin'")
                )

        if "sales" in tables:
            sale_cols = _columns(insp, "sales")
            if "created_by_id" not in sale_cols:
                conn.execute(
                    text("ALTER TABLE sales ADD COLUMN created_by_id INTEGER")
                )
            if "note" not in sale_cols:
                conn.execute(
                    text("ALTER TABLE sales ADD COLUMN note TEXT DEFAULT ''")
                )
            if "receipt_footer" not in sale_cols:
                conn.execute(
                    text("ALTER TABLE sales ADD COLUMN receipt_footer TEXT DEFAULT ''")
                )
