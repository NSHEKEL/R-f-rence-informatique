import ast
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.dialects.postgresql import dialect as postgresql_dialect
from sqlalchemy.orm import Session

from app import migrate as migration
from app.auth import get_current_user
from app.database import Base, get_db
from app.models import CashSession, Debt, Sale, User
from app.routers import cash


class SchemaRepairTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.engine = create_engine(f"sqlite:///{self.folder / 'scratch.db'}", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        change = patch.object(migration, "engine", self.engine)
        change.start()
        self.addCleanup(change.stop)
        with Session(self.engine) as db:
            user = User(email="schema@test.invalid", name="HAWA", role="admin", hashed_password="scratch-only")
            db.add(user)
            db.flush()
            till = CashSession(opened_by_id=user.id, opening_balance=170000, opened_at=datetime.now(), business_day=datetime.now().date().isoformat())
            db.add(till)
            db.flush()
            db.add(Sale(reference="ORIGINAL", cash_session_id=till.id, created_by_id=user.id, total=3500, paid_amount=3500, payment_method="Espèces"))
            db.commit()
            self.user_id, self.till_id = user.id, till.id
        with self.engine.begin() as conn:
            conn.execute(text("ALTER TABLE cash_sessions DROP COLUMN offline_mobile_money_to_cash"))

    def assert_reads(self):
        app = FastAPI()
        app.include_router(cash.router)
        def database():
            with Session(self.engine) as db:
                yield db
        with Session(self.engine) as db:
            user = db.get(User, self.user_id)
            app.dependency_overrides[get_current_user] = lambda: user
            app.dependency_overrides[get_db] = database
            with TestClient(app) as client:
                for route in ("current", "today", "global"):
                    result = client.get("/api/cash-sessions/" + route)
                    self.assertEqual(result.status_code, 200, result.text)
                    if route != "global":
                        self.assertEqual((result.json()["id"], result.json()["opening_balance"], result.json()["sales_count"]), (self.till_id, 170000, 1))
        with self.engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT reference,total,cash_session_id FROM sales")).all(), [("ORIGINAL",3500,self.till_id)])

    def test_late_unique_failure_cannot_undo_columns_and_later_steps_continue(self):
        with self.engine.begin() as conn:
            conn.execute(text("DROP INDEX ux_debts_purchase_id"))
            conn.execute(Debt.__table__.insert(), [{"kind":"dette","party":"Original","purchase_id":12345,"amount":10}, {"kind":"dette","party":"Original","purchase_id":12345,"amount":20}])
        for _ in range(2):
            with self.assertLogs("app.migrate", level="WARNING") as logs:
                migration.migrate()
            output = "\n".join(logs.output)
            self.assertIn("row ids=[1, 2]", output)
            self.assertIn("Traceback (most recent call last)", output)
            self.assertIn("UNIQUE constraint failed", output)
            self.assert_reads()
        with self.engine.connect() as conn:
            self.assertEqual(conn.execute(select(Debt.amount).order_by(Debt.id)).scalars().all(), [10,20])
            self.assertTrue(conn.execute(text("SELECT 1 FROM app_migrations WHERE name='depot_stock_initialization_v1'")).first())

    def test_model_comparison_repairs_nullable_gap_but_does_not_invent_required_data(self):
        with self.engine.begin() as conn:
            conn.execute(text("ALTER TABLE cash_sessions DROP COLUMN note"))
            conn.execute(text("ALTER TABLE offline_events DROP COLUMN hash"))
        with self.assertLogs("app.migrate", level="WARNING") as logs:
            migration.migrate()
        self.assertIn("offline_events.hash has no safe default", "\n".join(logs.output))
        self.assertIn("note", {c["name"] for c in inspect(self.engine).get_columns("cash_sessions")})
        self.assertNotIn("hash", {c["name"] for c in inspect(self.engine).get_columns("offline_events")})
        self.assert_reads()

    def test_concurrent_addition_is_idempotent(self):
        ready = Barrier(2)
        def repair():
            ready.wait(timeout=10)
            migration._add_column("cash_sessions", "offline_mobile_money_to_cash", "BOOLEAN")
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _: repair(), range(2)))
        self.assertEqual([c["name"] for c in inspect(self.engine).get_columns("cash_sessions")].count("offline_mobile_money_to_cash"), 1)

    def test_registry_keeps_offline_override_with_other_cash_columns(self):
        self.assertEqual(migration.COLUMNS["cash_sessions"]["offline_mobile_money_to_cash"], "BOOLEAN")
        self.assertIn("z_report", migration.COLUMNS["cash_sessions"])

    def test_startup_reflects_each_table_once_and_reuses_the_snapshot_for_repairs(self):
        counts = {}
        original = migration.inspect
        class CountingInspector:
            def __init__(self, target):
                self.delegate = original(target)
            def get_columns(self, table):
                counts[table] = counts.get(table, 0) + 1
                return self.delegate.get_columns(table)
            def __getattr__(self, name):
                return getattr(self.delegate, name)
        with patch.object(migration, "inspect", side_effect=CountingInspector):
            migration.migrate()
        self.assertEqual(set(counts), set(Base.metadata.tables))
        self.assertEqual(set(counts.values()), {1})
        self.assert_reads()
        print(f"SCHEMA_CATALOG_CACHE_OK tables={len(counts)} max_get_columns_per_table={max(counts.values())} missing_offline_column_repaired=True")

    def test_postgresql_fractional_step_uses_cached_types_even_for_new_integer_columns(self):
        conn = Mock(dialect=postgresql_dialect())
        with patch.object(migration, "inspect", side_effect=AssertionError("unexpected catalog query")):
            migration._fractional_quantities(conn, {})
            conn.execute.assert_not_called()
            migration._fractional_quantities(conn, {"products": {"quantity": {"type": "INTEGER"}}})
        self.assertEqual(conn.execute.call_count, 1)
        self.assertIn("ALTER COLUMN quantity TYPE NUMERIC(24,6)", str(conn.execute.call_args.args[0]))

    def test_migration_failure_traceback_is_written_to_discoverable_log(self):
        target = self.folder / "easygest.log"
        logger = migration.logging.getLogger("app.migrate")
        handlers, level, propagate = logger.handlers[:], logger.level, logger.propagate
        try:
            with patch.object(migration, "log_path", return_value=target):
                migration.configure_logging()
            def fail(conn):
                raise RuntimeError("late fixture failure")
            self.assertFalse(migration._migration_step("fixture", fail))
            content = target.read_text(encoding="utf-8")
            self.assertIn("Traceback (most recent call last)", content)
            self.assertIn("RuntimeError: late fixture failure", content)
        finally:
            for handler in logger.handlers:
                if handler not in handlers:
                    handler.close()
            logger.handlers, logger.level, logger.propagate = handlers, level, propagate


class AutomaticUpdateTests(unittest.TestCase):
    def test_startup_does_not_apply_even_a_staged_update_without_explicit_opt_in(self):
        source = Path(__file__).with_name("run.py").read_text(encoding="utf-8")
        function = next(node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == "_auto_update")
        scope = {"os": os}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "run.py", "exec"), scope)
        from app import updater
        with patch.dict(os.environ, {}, clear=True), patch.object(updater, "apply_pending") as apply, patch.object(updater, "stage_in_background") as stage:
            scope["_auto_update"]()
            apply.assert_not_called()
            stage.assert_not_called()

    def test_background_download_is_off_by_default_but_manual_check_is_unchanged(self):
        from app import updater
        with patch.dict(os.environ, {}, clear=True), patch.object(updater, "is_packaged", return_value=True), patch.object(updater.threading, "Thread") as thread:
            updater.stage_in_background()
            thread.assert_not_called()
        frontend = Path(__file__).resolve().parents[1] / "frontend/src"
        self.assertNotIn("<UpdateBanner", (frontend / "components/Layout.tsx").read_text(encoding="utf-8"))
        settings = (frontend / "pages/Settings.tsx").read_text(encoding="utf-8")
        self.assertIn("onClick={checkUpdate}", settings)
        self.assertIn("await updateLocal()", settings)
