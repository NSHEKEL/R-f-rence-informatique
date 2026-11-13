import ast
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, event, func
from sqlalchemy.orm import Session

import test_wholesale as wholesale
from app import history, migrate as migration, stock
from app.database import Base
from app.models import AppMigration, Depot, DepotStock, Product, StockLot
from app.routers import accounting_documents, depots, inventory


def forbidden_stock_writes(source):
    tree = ast.parse(source)
    errors = []
    lot_lines = set()
    for function in (node for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))):
        if any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ("get", "query") and any(isinstance(arg, ast.Name) and arg.id == "StockLot" for arg in node.args) for node in ast.walk(function)):
            lot_lines.update(range(function.lineno, function.end_lineno + 1))
    for node in ast.walk(tree):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        for target in targets:
            if isinstance(target, ast.Attribute) and target.attr == "quantity" and not (ast.unparse(target.value) == "lot" and node.lineno in lot_lines):
                errors.append(node.lineno)
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id == "Product":
                errors.append(node.lineno)
            if isinstance(node.func, ast.Attribute) and node.func.attr == "values" and any(kw.arg == "quantity" for kw in node.keywords):
                errors.append(node.lineno)
            if isinstance(node.func, ast.Name) and node.func.id == "setattr" and len(node.args) > 1 and isinstance(node.args[1], ast.Constant) and node.args[1].value == "quantity":
                errors.append(node.lineno)
    return errors


class StockWriteGuardTests(unittest.TestCase):
    def test_no_stock_writes_outside_helper(self):
        root = Path(stock.__file__).parent
        violations = {str(path.relative_to(root)): forbidden_stock_writes(path.read_text(encoding="utf-8-sig")) for path in root.rglob("*.py") if path.name != "stock.py"}
        self.assertEqual({key: value for key, value in violations.items() if value}, {})
        for source in ("product.quantity = 3", "p.quantity += 1", "lot.quantity = 3", "update(Product).values(quantity=3)", "Product(quantity=3)", "setattr(p, 'quantity', 3)"):
            self.assertTrue(forbidden_stock_writes(source), source)

    def test_2180_shape_migration_preserves_totals_and_marker_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "2180.db"
            with closing(sqlite3.connect(path)) as old:
                old.executescript((Path(__file__).parent / "fixtures/schema_v2_17_32.sql").read_text(encoding="utf-8"))
            engine = create_engine("sqlite:///" + path.as_posix())
            self.addCleanup(engine.dispose)
            with patch.object(migration, "engine", engine):
                migration.migrate()
            Base.metadata.create_all(engine)
            # Remove only the new feature from this disposable test database.
            with engine.begin() as conn:
                for table, columns in migration.COLUMNS.items():
                    if "depot_id" in columns:
                        conn.exec_driver_sql(f"ALTER TABLE {table} DROP COLUMN depot_id")
                conn.exec_driver_sql("DELETE FROM app_migrations WHERE name = 'depot_stock_initialization_v1'")
                for table in ("depot_transfer_items", "depot_transfers", "depot_stocks", "depots"):
                    conn.exec_driver_sql(f"DROP TABLE {table}")
            with Session(engine) as db:
                before = dict(db.query(Product.id, Product.quantity).all())
            with patch.object(migration, "engine", engine):
                migration.migrate()
                migration.migrate()
            with Session(engine) as db:
                default = db.query(Depot).filter_by(is_default=True).one()
                self.assertEqual(default.name, "Magasin principal")
                self.assertEqual(dict(db.query(Product.id, Product.quantity).all()), before)
                self.assertEqual(dict(db.query(DepotStock.product_id, DepotStock.quantity).filter_by(depot_id=default.id)), before)
                self.assertEqual(stock.inconsistencies(db), [])
                self.assertEqual(db.query(AppMigration).filter_by(name="depot_stock_initialization_v1").count(), 1)
            engine.dispose()


class DepotTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    sell = wholesale.WholesaleTests.sell
    grant = wholesale.WholesaleTests.grant
    open = wholesale.WholesaleTests.open

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        for router in (depots.router, inventory.router, accounting_documents.router):
            self.app.include_router(router)
        self.a = self.call("/api/depots")[0]["id"]
        self.b = self.call("/api/depots", "POST", {"code": "B", "name": "Réserve"}, 201)["id"]

    def invariant(self, expected):
        with self.sessions() as db:
            self.assertEqual(stock.inconsistencies(db), [])
            self.assertEqual([stock.quantity(db, self.product.id, depot) for depot in (self.a, self.b)], expected)
            self.assertEqual(db.get(Product, self.product.id).quantity, sum(expected))

    def transfer(self, amount, status=201):
        return self.call("/api/depots/transfers", "POST", {"source_depot_id": self.a, "destination_depot_id": self.b, "items": [{"product_id": self.product.id, "quantity": amount}]}, status)

    def test_sales_always_use_default_allow_negative_default_and_never_touch_reserves(self):
        self.invariant([200, 0])
        self.transfer(150)
        self.invariant([50, 150])
        sale = self.sell([{"quantity": 60}])
        self.assertNotIn("depot_id", sale["items"][0])
        self.invariant([-10, 150])
        returned = self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{"product_id": self.product.id, "quantity": 2}]}, 201)
        self.assertNotIn("depot_id", returned["items"][0])
        self.invariant([-8, 150])
        self.call(f"/api/sales/{sale['id']}", "DELETE", status=204)
        self.invariant([50, 150])
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Grossiste", "items": [{"product_id": self.product.id, "quantity": 24}]}, 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.invariant([74, 150])
        response = self.client.post("/api/sales", headers={"User-Agent": "Android WebView"}, json={"items": [{"product_id": self.product.id, "quantity": 3}]})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertNotIn("depot_id", response.json()["items"][0])
        self.invariant([71, 150])
        self.assertEqual(self.call(f"/api/depots/stocks/{self.product.id}")[0]["is_default"], True)
        self.sell([{"quantity": 222}], status=400)
        self.invariant([71, 150])
        self.assertTrue(self.call("/api/depots/consistency")["ok"])

    def test_inventory_depot_snapshot_shortage_excess_preserves_other_depot_and_sales(self):
        self.transfer(50)
        for physical, expected in ((45, [148, 45]), (48, [146, 48])):
            session = self.call("/api/inventory/sessions", "POST", {"name": "Réserve", "scope_type": "depot", "scope": {"depot_id": self.b}}, 201)
            path = f"/api/inventory/sessions/{session['id']}"
            self.assertEqual(session["scope"]["depot_name"], "Réserve")
            self.call(path + "/start", "POST", {})
            self.call(path + f"/counts/{self.product.id}", "PUT", {"physical_qty": physical})
            self.sell([{"quantity": 2}])
            result = self.call(path + "/validate", "POST", {})
            self.assertEqual(result["rows"][0]["stock_after_qty"], expected[1])
            self.invariant(expected)
            self.call(path + "/validate", "POST", {}, 409)
        report = self.call(f"/api/accounting/documents/report?kind=stock&depot_id={self.b}")
        self.assertEqual(report["rows"][0][3], 48)
        self.assertIn("Réserve", report["footer"])

    def test_transfer_rollback_permissions_empty_and_invalid_inputs(self):
        self.transfer(201, 400)
        self.invariant([200, 0])
        self.transfer(0, 422)
        self.call("/api/inventory/sessions", "POST", {"name": "Invalid", "scope_type": "depot", "scope": {}}, 400)
        self.call("/api/inventory/sessions", "POST", {"name": "Invalid", "scope_type": "depot", "scope": {"depot_id": 999999}}, 400)
        self.call("/api/depots/transfers", "POST", {"source_depot_id": self.a, "destination_depot_id": self.b, "items": []}, 422)
        self.call("/api/depots", "POST", {"code": "B", "name": "Duplicate"}, 409)
        self.call(f"/api/depots/{self.a}", "PUT", {"code": "PRINCIPAL", "name": "Main", "active": False}, 400)
        self.user.role = "gestionnaire"
        self.db.commit()
        self.transfer(1, 403)
        self.call("/api/depots", "POST", {"code": "C", "name": "Denied"}, 403)
        self.call("/api/depots/consistency", status=403)
        self.invariant([200, 0])

    def test_catalogue_delta_total_scope_lots_and_history_keep_invariant(self):
        self.transfer(50)
        payload = self.call("/api/products")[0]
        payload["quantity"] = 220
        self.call(f"/api/products/{self.product.id}", "PUT", payload)
        self.invariant([170, 50])
        self.call("/api/inventory/apply", "POST", {"lines": [{"product_id": self.product.id, "counted_quantity": 210}]})
        self.invariant([160, 50])
        self.call(f"/api/products/{self.product.id}/lots", "POST", {"depot_id": self.a, "quantity": 30, "lot_number": "A"}, 201)
        self.transfer(20)
        self.invariant([140, 70])
        self.sell([{"quantity": 5}])
        self.invariant([135, 70])
        with self.sessions() as db:
            self.assertEqual([(lot.depot_id, lot.quantity) for lot in db.query(StockLot).order_by(StockLot.id)], [(self.a, 5), (self.b, 20)])
        with self.engine.begin() as conn:
            stock.replay_product(conn, {"id": self.product.id, "quantity": 215}, None)
        self.invariant([145, 70])

    def test_history_records_quantity_only_edit_and_replays_default_delta(self):
        self.transfer(50)
        event.listen(self.sessions, "after_flush", history._capture)
        self.addCleanup(event.remove, self.sessions, "after_flush", history._capture)
        recorder = history.start("Modification d'un article", self.user.id)
        try:
            with self.sessions() as db:
                product = db.get(Product, self.product.id)
                stock.set_total(db, product, 220)
                db.commit()
        finally:
            history.stop()
        self.assertEqual(len(recorder.entries), 1)
        self.assertEqual(recorder.entries[0]["before"]["quantity"], 200)
        self.assertEqual(recorder.entries[0]["after"]["quantity"], 220)
        self.invariant([170, 50])
        with patch.object(history, "engine", self.engine):
            history._apply(recorder.entries, undo=True)
            self.invariant([150, 50])
            history._apply(recorder.entries, undo=False)
            self.invariant([170, 50])

    def test_replenishment_of_negative_principal_consumes_already_sold_lot_tags(self):
        self.call(f"/api/products/{self.product.id}/lots", "POST", {"quantity": 200, "lot_number": "FEFO"}, 201)
        self.transfer(150)
        self.sell([{"quantity": 60}])
        self.invariant([-10, 150])
        for amount, expected in ((5, [-5, 145]), (10, [5, 135])):
            self.call("/api/depots/transfers", "POST", {"source_depot_id": self.b, "destination_depot_id": self.a, "items": [{"product_id": self.product.id, "quantity": amount}]}, 201)
            self.invariant(expected)
            with self.sessions() as db:
                for depot, qty in zip((self.a, self.b), expected):
                    tagged = db.query(func.coalesce(func.sum(StockLot.quantity), 0)).filter_by(product_id=self.product.id, depot_id=depot).scalar()
                    self.assertEqual(tagged, max(0, qty))


if __name__ == "__main__":
    unittest.main()
