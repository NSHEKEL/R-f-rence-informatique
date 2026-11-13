import ast
import sqlite3
import tempfile
import unittest
from contextlib import ExitStack, closing
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app import migrate as migration
from app.auth import get_current_user
from app.database import Base, get_db
from app.models import CashSession, DebtPayment, Product, User
from app.routers import accounting, accounting_documents, cash, inventory, sales


def duplicate_dict_keys(source):
    duplicates = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Dict):
            continue
        seen = {}
        for key in node.keys:
            try:
                value = ast.literal_eval(key)
                hash(value)
            except (ValueError, TypeError):
                continue
            if value in seen:
                duplicates.append((value, seen[value], key.lineno))
            seen[value] = key.lineno
    return duplicates


class MigrationRegistryTests(unittest.TestCase):
    def test_no_duplicate_literal_keys_in_migration_or_application_registries(self):
        root = Path(migration.__file__).parent
        for path in sorted(root.rglob("*.py")):
            with self.subTest(path=path.relative_to(root)):
                self.assertEqual(duplicate_dict_keys(path.read_text(encoding="utf-8-sig")), [])

    def test_guard_detects_nested_and_overwritten_registry_entries(self):
        source = 'COLUMNS = {"debt_payments": {"bank_account_id": "INTEGER"}, "debt_payments": {"cancelled": "BOOLEAN"}, "sales": {"note": "TEXT", "note": "VARCHAR"}}'
        self.assertEqual([key for key, _, _ in duplicate_dict_keys(source)], ["debt_payments", "note"])
        self.assertEqual(duplicate_dict_keys('{"a": {"id": 1}, "b": {"id": 2}}'), [])


class HistoricalUpgradeTests(unittest.TestCase):
    def test_v21732_upgrade_preserves_data_and_runs_till_sale_inventory_accounting(self):
        with ExitStack() as cleanup:
            folder = cleanup.enter_context(tempfile.TemporaryDirectory())
            path = Path(folder) / "installed.db"
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            with closing(sqlite3.connect(path)) as old:
                old.executescript((Path(__file__).parent / "fixtures/schema_v2_17_32.sql").read_text(encoding="utf-8"))
                old.execute("UPDATE cash_sessions SET opened_at=?, business_day=?", (now, now.date().isoformat()))
                old.execute("UPDATE debts SET created_at=?", (now,))
                old.execute("UPDATE debt_payments SET date=?", (now,))
                old.commit()
                self.assertNotIn("bank_account_id", {row[1] for row in old.execute("PRAGMA table_info(debt_payments)")})
                old_tables = {row[0] for row in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                old_columns = {table: {row[1] for row in old.execute(f'PRAGMA table_info("{table}")')} for table in old_tables}
            engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})
            cleanup.callback(engine.dispose)
            # Match main.py: create missing tables first, then extend existing ones.
            Base.metadata.create_all(engine)
            with patch.object(migration, "engine", engine):
                migration.migrate()
                migration.migrate()
            inspector = inspect(engine)
            for table in Base.metadata.sorted_tables:
                actual = {column["name"] for column in inspector.get_columns(table.name)}
                self.assertTrue({column.name for column in table.columns} <= actual, table.name)
            for table, columns in old_columns.items():
                self.assertTrue(columns <= {c["name"] for c in inspector.get_columns(table)}, table)
            sessions = sessionmaker(engine, expire_on_commit=False)
            with sessions() as db:
                user = db.get(User, 1)
                self.assertEqual(user.name, "Admin ancien")
                payment = db.get(DebtPayment, 1)
                self.assertEqual((payment.amount, payment.method, payment.bank_account_id), (50, "Espèces", None))
                self.assertEqual(cash.session_amounts(db, db.get(CashSession, 1)).expected_cash, 550)
            app = FastAPI()
            for router in (cash.router, sales.router, inventory.router, accounting.router, accounting_documents.router):
                app.include_router(router)

            def dependency():
                with sessions() as db:
                    yield db

            app.dependency_overrides[get_db] = dependency
            app.dependency_overrides[get_current_user] = lambda: user
            with patch.object(sales, "_backup_after_sale"), patch.object(sales.remote_sales, "schedule"), TestClient(app) as client:
                def call(url, method="GET", payload=None, expected=200):
                    result = client.request(method, url, json=payload)
                    self.assertEqual(result.status_code, expected, result.text)
                    return result.json()

                self.assertEqual(call("/api/cash-sessions/current")["expected_cash"], 550)
                sale = call("/api/sales", "POST", {"payment_method": "Espèces", "items": [{"product_id": 1, "quantity": 1}]}, 201)
                self.assertEqual(sale["total"], 100)
                self.assertEqual(call("/api/cash-sessions/current")["expected_cash"], 650)
                call("/api/inventory/movements")
                session = call("/api/inventory/sessions", "POST", {"name": "Après mise à jour"}, 201)
                call(f"/api/inventory/sessions/{session['id']}/start", "POST", {})
                call(f"/api/inventory/sessions/{session['id']}/counts/1", "PUT", {"physical_qty": 18})
                call(f"/api/inventory/sessions/{session['id']}/validate", "POST", {})
                call(f"/api/inventory/sessions/{session['id']}/report")
                self.assertEqual(call("/api/accounting/summary")["revenue"], 100)
                call("/api/accounting/documents/config")
                call("/api/accounting/documents/report")
            with sessions() as db:
                self.assertEqual(db.get(Product, 1).quantity, 18)
                self.assertEqual(db.get(DebtPayment, 1).amount, 50)
