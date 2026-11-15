import unittest
from datetime import datetime
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text

import test_units as units
import test_wholesale as wholesale
from app import migrate as migration, stock
from app.database import Base
from app.models import Depot, Product, StockLot, StockMovement
from app.routers import inventory


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 3, 1, 12)


class StockWorkspaceTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    grant = units.PackagingTests.grant
    open = units.PackagingTests.open

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        self.app.include_router(inventory.router)

    def test_movement_periods_filters_stable_pagination_and_legacy_list(self):
        default = stock.resolve(self.db)
        reserve = Depot(code="RES", name="Réserve")
        other = Product(name="Autre", sku="OTHER")
        self.db.add_all([reserve, other])
        self.db.flush()
        rows = []
        for product, when, qty, kind, user, depot in (
            (self.product, "2026-02-01T00:00:00", 5, "inventaire", self.user.id, default),
            (self.product, "2026-02-23T00:00:00", -2, "vente", self.user.id, default),
            (self.product, "2026-02-28T23:59:59.999999", 3, "reception", None, reserve.id),
            (self.product, "2026-03-01T09:00:00", -1, "vente", self.user.id, default),
            (other, "2026-03-01T09:00:00", 4, "ajustement", self.user.id, default),
        ):
            row = StockMovement(product_id=product.id, product_name=product.name, date=datetime.fromisoformat(when),
                quantity=qty, kind=kind, created_by_id=user, depot_id=depot, reason="Trace conservée", stock_before=10, stock_after=10 + qty)
            self.db.add(row)
            rows.append(row)
        self.db.commit()
        ids = [row.id for row in rows]
        with patch.object(inventory, "datetime", FrozenDateTime):
            for period, expected in (("all", 5), ("today", 2), ("7d", 4), ("month", 2), ("previous", 3)):
                with self.subTest(period=period):
                    self.assertEqual(self.call(f"/api/inventory/movements/page?period={period}")["total"], expected)
            first = self.call("/api/inventory/movements/page?page_size=2")
            second = self.call("/api/inventory/movements/page?page_size=2&page=2")
            self.assertEqual([row["id"] for row in first["items"]], ids[::-1][:2])
            self.assertEqual([row["id"] for row in second["items"]], ids[::-1][2:4])
            self.assertEqual(self.call("/api/inventory/movements/page?sort=oldest")["items"][0]["id"], ids[0])
            filtered = self.call(f"/api/inventory/movements/page?product_id={self.product.id}&kind=vente&user_id={self.user.id}&depot_id={default}&direction=sortie")
            self.assertEqual(filtered["total"], 2)
            self.assertEqual(filtered["items"][0]["reason"], "Trace conservée")
            self.assertEqual(self.call("/api/inventory/movements/page?direction=entree")["total"], 3)
            self.assertEqual(self.call("/api/inventory/movements/page?period=custom&date_from=2026-02-28&date_to=2026-02-28")["items"][0]["id"], ids[2])
            self.assertEqual(self.call("/api/inventory/movements/page?search=Autre")["total"], 1)
        self.assertIsInstance(self.call("/api/inventory/movements?limit=1"), list)
        self.product.active = False
        self.db.commit()
        options = self.call("/api/inventory/movements/filters")
        self.assertIn(self.product.id, [row["id"] for row in options["products"]])
        self.assertIn(self.user.id, [row["id"] for row in options["users"]])
        self.assertIn(reserve.id, [row["id"] for row in options["depots"]])

    def test_movement_empty_invalid_and_forbidden_requests(self):
        self.assertEqual(self.call("/api/inventory/movements/page?product_id=999999")["items"], [])
        for query, status in (("page=0", 422), ("page_size=201", 422), ("sort=wrong", 422),
                              ("period=custom", 400), ("date_from=wrong", 422),
                              ("date_from=2026-03-02&date_to=2026-03-01", 400)):
            self.call(f"/api/inventory/movements/page?{query}", status=status)
        self.user.role = "vendeur"
        self.call("/api/inventory/movements/page", status=403)
        self.call("/api/inventory/movements/filters", status=403)

    def test_stock_columns_nearest_remaining_lot_and_financial_permission(self):
        self.product.purchase_price = 42
        self.db.add_all([StockLot(product_id=self.product.id, quantity=0, expiry_date=datetime(2020, 1, 1)),
                         StockLot(product_id=self.product.id, quantity=2, expiry_date=datetime(2025, 1, 1)),
                         StockLot(product_id=self.product.id, quantity=10, expiry_date=datetime(2030, 1, 1))])
        self.db.commit()
        row = self.call("/api/products")[0]
        self.assertEqual(row["stock_purchase_price"], 42)
        self.assertEqual(row["stock_value"], 8400)
        self.assertTrue(row["nearest_expiry"].startswith("2025-01-01"))
        self.user.role = "vendeur"
        self.grant("inventaire", "vente_nouvelle")
        row = self.call("/api/products")[0]
        self.assertIsNone(row["stock_purchase_price"])
        self.assertIsNone(row["stock_value"])


class MovementIndexMigrationTests(unittest.TestCase):
    def test_date_index_added_idempotently_without_touching_history(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX ix_stock_movements_date"))
            conn.execute(text("INSERT INTO stock_movements (id, date, quantity, reason) VALUES (1, '2020-01-02 03:04:05', 7, 'Historique')"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        self.assertIn("ix_stock_movements_date", {row["name"] for row in inspect(engine).get_indexes("stock_movements")})
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT quantity, reason, date FROM stock_movements WHERE id=1")).one(), (7, "Historique", "2020-01-02 03:04:05"))
