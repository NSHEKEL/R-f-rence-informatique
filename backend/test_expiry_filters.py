import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

import test_wholesale as wholesale
from app import migrate as migration, stock
from app.database import Base
from app.models import Category, Product, StockLot, Supplier
from app.routers import depots, products


class FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2030, 1, 31, 12)


class ExpiryFiltersTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    open = wholesale.WholesaleTests.open

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        clock = patch.object(products, "datetime", FixedDatetime)
        clock.start()
        self.addCleanup(clock.stop)
        self.dates = {"expired": "2030-01-30", "today": "2030-01-31", "week": "2030-02-07",
            "eight": "2030-02-08", "one": "2030-02-28", "two": "2030-03-31",
            "three": "2030-04-30", "four": "2030-05-31", "nine": "2030-10-31", "later": "2030-11-01"}
        for name, expiry in self.dates.items():
            self.db.add(StockLot(product_id=self.product.id, lot_number=name, expiry_date=datetime.fromisoformat(expiry), quantity=3, unit_cost=7.5))
        self.db.add_all([StockLot(product_id=self.product.id, lot_number="empty", expiry_date=datetime(2030, 1, 1), quantity=0, unit_cost=7.5),
            StockLot(product_id=self.product.id, lot_number="undated", quantity=4, unit_cost=7.5)])
        self.db.commit()

    def rows(self, query=""):
        return self.call("/api/products/stock/perimes" + ("?" + query if query else ""))

    def test_all_calendar_horizons_and_per_lot_values(self):
        expected = {"7d": ["today", "week"], "1m": ["today", "week", "eight", "one"],
            "2m": ["today", "week", "eight", "one", "two"],
            "3m": ["today", "week", "eight", "one", "two", "three"],
            "4m": ["today", "week", "eight", "one", "two", "three", "four"],
            "9m": ["today", "week", "eight", "one", "two", "three", "four", "nine"]}
        self.assertEqual([row["lot_number"] for row in self.rows()], ["expired"])
        for period, names in expected.items():
            with self.subTest(period=period):
                self.assertEqual([row["lot_number"] for row in self.rows(f"period={period}")], names)
        self.product.purchase_price = 999
        self.db.commit()
        rows = self.rows("period=all")
        self.assertEqual(len(rows), 10)
        self.assertEqual(len({row["lot_id"] for row in rows}), 10)
        self.assertEqual(rows[0]["days_left"], -1)
        self.assertEqual(rows[2]["days_left"], 7)
        self.assertIsInstance(rows[2]["months_left"], (int, float))
        for row in rows:
            self.assertEqual((row["quantity"], row["unit_cost"], row["value"], row["loss_value"]), (3, 7.5, 22.5, 22.5))

    def test_custom_period_boundaries_search_category_supplier_and_empty_results(self):
        self.db.add(StockLot(product_id=self.product.id, lot_number="end-of-day", quantity=1,
            expiry_date=datetime(2030, 2, 28, 23, 59, 59, 999999), unit_cost=5))
        category, supplier = Category(name="Aliments"), Supplier(name="Fournisseur")
        self.db.add_all([category, supplier])
        self.db.flush()
        self.product.category_id, self.product.supplier_id = category.id, supplier.id
        self.db.commit()
        rows = self.rows("period=custom&date_from=2030-02-08&date_to=2030-02-28")
        self.assertEqual([row["lot_number"] for row in rows], ["eight", "one", "end-of-day"])
        self.assertEqual(len(self.rows("period=custom&date_to=2030-01-30")), 1)
        self.assertEqual(len(self.rows(f"period=all&category_id={category.id}&supplier_id={supplier.id}")), 11)
        self.assertEqual([row["lot_number"] for row in self.rows("period=all&search=end-of-day")], ["end-of-day"])
        self.assertEqual(self.rows("period=all&search=does-not-exist"), [])
        self.assertEqual(self.rows("period=all&category_id=999999"), [])
        self.assertEqual(self.rows("period=all&supplier_id=999999"), [])
        for query, status in (("period=custom", 400), ("period=custom&date_from=bad", 400),
            ("period=custom&date_from=2030-02-03&date_to=2030-01-01", 400), ("period=unknown", 422)):
            self.call("/api/products/stock/perimes?" + query, status=status)

    def test_dashboard_expired_value_matches_lot_report_after_price_change_and_fallbacks(self):
        self.product.purchase_price = 999
        self.db.add_all([
            StockLot(product_id=self.product.id, lot_number="fallback", quantity=2, unit_cost=None,
                expiry_date=datetime(2030, 1, 30, 23, 59, 59, 999999)),
            StockLot(product_id=self.product.id, lot_number="zero-cost", quantity=4, unit_cost=0,
                expiry_date=datetime(2030, 1, 30)),
        ])
        self.db.commit()
        dashboard = self.call("/api/products/stock/dashboard")
        self.assertEqual(dashboard["expired_value"], 3 * 7.5 + 2 * 999)
        self.assertEqual(dashboard["expired_value"], sum(row["value"] for row in self.rows()))
        self.assertEqual(dashboard["loss_value"], dashboard["expired_value"])
        self.product.purchase_price = None
        self.db.commit()
        self.assertEqual(self.call("/api/products/stock/dashboard")["expired_value"], 22.5)
        self.db.query(StockLot).filter(StockLot.product_id == self.product.id).delete()
        self.db.commit()
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.call("/api/products/stock/dashboard")["expired_value"], 0)

    def test_new_lots_capture_cost_and_keep_it_after_catalogue_price_changes(self):
        self.product.purchase_price = 77
        self.db.commit()
        lot = self.call(f"/api/products/{self.product.id}/lots", "POST", {"lot_number": "NEW-COST", "quantity": 2, "expiry_date": "2030-04-01T00:00:00"}, 201)
        self.product.purchase_price = 888
        self.db.commit()
        row = next(row for row in self.rows("period=all") if row["lot_id"] == lot["id"])
        self.assertEqual((row["unit_cost"], row["value"]), (77, 154))

    def test_internal_transfer_keeps_lot_costs(self):
        self.app.include_router(depots.router)
        source = stock.resolve(self.db)
        self.db.commit()
        reserve = self.call("/api/depots", "POST", {"code": "RESERVE", "name": "Réserve"}, 201)
        self.call("/api/depots/transfers", "POST", {"source_depot_id": source, "destination_depot_id": reserve["id"],
            "items": [{"product_id": self.product.id, "quantity": 4}]}, 201)
        self.db.expire_all()
        moved = self.db.query(StockLot).filter_by(depot_id=reserve["id"]).all()
        self.assertEqual(sum(lot.quantity for lot in moved), 4)
        self.assertTrue(all(lot.unit_cost == 7.5 for lot in moved))
        self.assertEqual(stock.inconsistencies(self.db), [])


class PartAMigrationTests(unittest.TestCase):
    def test_historical_schema_active_default_lot_cost_backfill_and_idempotence(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "legacy.db"
            with closing(sqlite3.connect(path)) as old:
                old.executescript((Path(__file__).parent / "fixtures/schema_v2_17_32.sql").read_text(encoding="utf-8"))
                old.execute("INSERT INTO stock_lots (id, product_id, lot_number, quantity) VALUES (1, 1, 'ANCIEN', 5)")
                old.commit()
            engine = create_engine("sqlite:///" + path.as_posix())
            try:
                Base.metadata.create_all(engine)
                with patch.object(migration, "engine", engine):
                    migration.migrate()
                    migration.migrate()
                with Session(engine) as db:
                    product, lot = db.get(Product, 1), db.get(StockLot, 1)
                    self.assertTrue(product.active)
                    self.assertEqual((product.quantity, lot.quantity, lot.unit_cost), (20, 5, 40))
                    product.active, product.purchase_price = False, 999
                    db.commit()
                with patch.object(migration, "engine", engine):
                    migration.migrate()
                with Session(engine) as db:
                    self.assertFalse(db.get(Product, 1).active)
                    self.assertEqual(db.get(StockLot, 1).unit_cost, 40)
                self.assertIn("purchase_reference", {column["name"] for column in inspect(engine).get_columns("price_history")})
                with engine.connect() as conn:
                    self.assertEqual(conn.execute(text("SELECT name FROM products WHERE id = 1")).scalar_one(), "Article ancien")
            finally:
                engine.dispose()
