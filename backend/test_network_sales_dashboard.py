import asyncio
import unittest
from datetime import datetime

from sqlalchemy import inspect, text

import test_cash_register as register
import test_treasury_permissions as treasury
from app.models import CashSession, Sale, SalePayment, StockMovement, User
from app.routers import dashboard


class NetworkSalesDashboardTests(unittest.TestCase):
    setUp = register.CashRegisterTests.setUp
    call = register.CashRegisterTests.call
    open = register.CashRegisterTests.open
    sale = register.CashRegisterTests.sale
    run_migration = register.CashRegisterTests.run_migration

    def test_stock_value_empty_zero_cost_and_unrelated_sale_price(self):
        self.user.role = "admin"
        self.product.quantity = 24
        self.product.purchase_price = 500
        self.product.supplier_purchase_price = 400
        self.product.sale_price = 6000
        self.db.commit()
        self.assertEqual(self.call("/api/dashboard")["total_stock_value"], 12000)
        self.product.purchase_price = 0
        self.db.commit()
        self.assertEqual(self.call("/api/dashboard")["total_stock_value"], 0)
        self.db.delete(self.product)
        self.db.commit()
        self.assertEqual(self.call("/api/dashboard")["total_stock_value"], 0)

    def test_global_cashiers_homonyms_and_payment_legs_without_double_count(self):
        self.user.role = "admin"
        self.db.commit()
        self.open()
        self.sale("poste-one")
        self.db.add(Sale(reference="CREDIT", total=200, created_by_id=self.other.id, payment_method="Crédit"))
        self.db.add(Sale(reference="MIXTE", total=300, created_by_id=self.other.id, payment_method="Mixte", payments=[SalePayment(method="Espèces", amount=100), SalePayment(method="Mobile Money", amount=200)]))
        self.db.add_all([Sale(reference="GIFT", total=900, is_gift=True), Sale(reference="CANCELLED", total=800, status="Annulée")])
        self.other.name = self.user.name
        for index in range(5):
            seller = User(name=f"Caissier {index}", email=f"cashier{index}", hashed_password="unused", role="vendeur")
            self.db.add(seller)
            self.db.flush()
            self.db.add(Sale(reference=f"POSTE-{index}", total=10, created_by_id=seller.id))
        self.db.commit()
        stats = self.call("/api/dashboard")
        self.assertEqual((stats["total_sales"], stats["total_revenue"], stats["total_collected"]), (8, 650, 450))
        self.assertEqual(stats["payments"], {"Espèces": 250, "Mobile Money": 200, "Crédit": 200})
        self.assertEqual(len(stats["top_sellers"]), 7)
        other = next(row for row in stats["top_sellers"] if row["user_id"] == self.other.id)
        self.assertEqual((other["sales_count"], other["revenue"], other["collected"]), (2, 500, 300))
        self.assertEqual(stats["total_revenue"], sum(row["revenue"] for row in stats["top_sellers"]))

    def test_period_boundaries_empty_and_global_not_current_till(self):
        self.db.add_all([
            Sale(reference="START", total=10, date=datetime(2026, 1, 1), created_by_id=self.other.id),
            Sale(reference="END", total=20, date=datetime(2026, 1, 7, 23, 59, 59), created_by_id=self.other.id),
            Sale(reference="OUTSIDE", total=30, date=datetime(2026, 1, 8)),
        ])
        self.db.commit()
        stats = dashboard.get_stats(datetime(2026, 1, 1), datetime(2026, 1, 7), self.db, self.user)
        self.assertEqual((stats.total_sales, stats.total_revenue), (2, 30))
        empty = dashboard.get_stats(datetime(2025, 1, 1), datetime(2025, 1, 1), self.db, self.user)
        self.assertEqual((empty.total_sales, empty.total_collected, empty.payments, empty.top_sellers), (0, 0, {}, []))

    def test_queued_sale_keeps_original_session_and_duplicate_is_idempotent(self):
        self.user.role = "admin"
        self.db.commit()
        first = self.open()
        body = {"client_id": "offline-bound", "cash_session_id": first["id"], "items": [{"product_id": self.product.id, "quantity": 1}]}
        saved = self.call("/api/sales", "POST", body, 201)
        self.call("/api/cash-sessions/close", "POST", {"closing_balance": 600})
        second = self.call(f"/api/cash-sessions/{first['id']}/reopen", "POST")
        self.assertEqual(self.call("/api/sales", "POST", body, 201)["id"], saved["id"])
        refused = self.call("/api/sales", "POST", {**body, "client_id": "not-yet-sent"}, 409)
        self.assertIn("origine", refused["detail"])
        self.db.expire_all()
        self.assertEqual(self.db.query(Sale).count(), 1)
        self.assertEqual(self.db.query(StockMovement).filter_by(kind="vente").count(), 1)
        self.assertNotEqual(first["id"], second["id"])

    def test_workstation_recorded_at_till_open_and_additive_migration(self):
        self.user.role = "admin"
        self.db.commit()
        code, opened = asyncio.run(treasury.request(self.app, "/api/cash-sessions/open", "POST", {}, client=("192.168.1.42", 1234)))
        self.assertEqual(code, 201, opened)
        self.assertEqual(opened["workstation"], "192.168.1.42")
        with self.engine.begin() as connection:
            connection.execute(text("ALTER TABLE cash_sessions DROP COLUMN workstation"))
        self.run_migration()
        self.assertIn("workstation", {column["name"] for column in inspect(self.engine).get_columns("cash_sessions")})
        self.assertEqual(self.db.get(CashSession, opened["id"]).opened_by_id, self.user.id)
