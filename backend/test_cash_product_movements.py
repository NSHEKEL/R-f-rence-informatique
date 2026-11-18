import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

import test_cash_register as fixtures
from app.models import CashSession, Depot, Notification, StockMovement
from app.routers import products
from app import remote_sales


class CashProductMovementsTests(unittest.TestCase):
    setUp = fixtures.CashRegisterTests.setUp
    call = fixtures.CashRegisterTests.call
    grant = fixtures.CashRegisterTests.grant

    def test_session_depot_movements_totals_filters_and_access(self):
        self.app.include_router(products.router)
        self.grant("retours", "produits_gerer", "caisse_operations", "soldes_consulter",
                   "tresorerie_consulter", "depenses_gerer")
        session = self.call("/api/cash-sessions/open", "POST", {"opening_balance": 0}, status=201)
        path = f"/api/cash-sessions/{session['id']}/product-movements"
        self.assertEqual(self.call(path)["totals"], {"entries": 0, "exits": 0, "net": 0})
        sale = self.call("/api/sales", "POST", {
            "client_id": "product-movements", "items": [{"product_id": self.product.id, "quantity": 3}],
            "paid_amount": 300, "payment_method": "Espèces",
        }, status=201)
        credit = self.call("/api/returns", "POST", {
            "sale_reference": sale["reference"], "refund_method": "Espèces",
            "lines": [{"product_id": self.product.id, "quantity": 1}],
        }, status=201)
        notification = self.db.query(Notification).filter_by(kind="retour").one()
        self.assertEqual(notification.title, f"Retour {credit['reference']}")
        self.assertNotIn(sale["reference"], notification.title)
        self.assertIn(sale["reference"], notification.message)
        self.assertIn("−100 FCFA", notification.message)
        self.call(f"/api/products/{self.product.id}/stock-entry", "POST", {
            "quantity": 5, "reason": "Arrivage", "note": "Session test",
        }, status=201)
        opened = self.db.get(CashSession, session["id"]).opened_at.replace(tzinfo=timezone.utc)
        self.call("/api/accounting/expenses", "POST", {
            "label": "Transport", "amount": 20, "payment_method": "Espèces",
        }, status=201)
        self.call("/api/cash-sessions/movements", "POST", {
            "type": "in", "amount": 10, "reason": "Appoint",
        })
        self.call("/api/cash-sessions/movements", "POST", {
            "type": "out", "amount": 5, "reason": "Retrait",
        })
        balance = remote_sales._cash_balances(self.db)
        self.assertEqual(balance["sessions"][0]["expected_cash"], 185)
        self.assertEqual(balance["sessions"][0]["expected_cash"], self.call("/api/cash-sessions/today")["expected_cash"])
        self.assertIn("soldes_consulter", remote_sales._users(self.db)[0]["cash_permissions"])
        depot = self.db.query(Depot).filter_by(is_default=True).one()
        other_depot = Depot(code="AUTRE", name="Autre dépôt")
        self.db.add(other_depot)
        self.db.flush()
        self.db.add_all([
            StockMovement(product_id=self.product.id, product_name=self.product.name, depot_id=depot.id,
                          kind="entree", quantity=100, date=opened-timedelta(seconds=1)),
            StockMovement(product_id=self.product.id, product_name=self.product.name, depot_id=other_depot.id,
                          kind="entree", quantity=200),
            StockMovement(product_id=self.product.id, product_name=self.product.name, depot_id=depot.id,
                          kind="entree", quantity=300, date=datetime.now(timezone.utc)+timedelta(days=1)),
        ])
        self.db.commit()
        report = self.call(path)
        self.assertEqual(report["depot_id"], depot.id)
        self.assertEqual(report["totals"], {"entries": 6, "exits": 3, "net": 3})
        self.assertEqual(len(report["products"]), 1)
        self.assertEqual(report["products"][0]["net"], 3)
        self.assertEqual({item["type"] for item in report["items"]}, {"vente", "retour", "entree"})
        self.assertEqual({item["quantity"] for item in report["items"]}, {-3, 1, 5})
        self.assertTrue(all(item["sku"] == self.product.sku and item["user"] == self.user.name
                            and item["date"] and item["reason"] for item in report["items"]))
        with TestClient(self.app) as client:
            self.assertEqual(client.get(path, params={"period": "today"}).json()["totals"], report["totals"])
            self.assertEqual(client.get(path, params={"period": "custom"}).status_code, 400)
            self.assertEqual(client.get(path, params={"date_from": "2026-02-02", "date_to": "2026-01-01"}).status_code, 400)
            self.assertEqual(client.get(path, params={"date_from": "invalid"}).status_code, 422)
            empty = client.get(path, params={"date_to": (opened-timedelta(days=1)).date().isoformat()}).json()
            self.assertEqual(empty["totals"]["net"], 0)
        closed = datetime.now(timezone.utc)
        self.db.get(CashSession, session["id"]).closed_at = closed
        self.db.add(StockMovement(product_id=self.product.id, depot_id=depot.id, kind="entree",
                                  quantity=400, date=closed+timedelta(seconds=1)))
        other_session = CashSession(opened_by_id=self.other.id)
        self.db.add(other_session)
        self.db.commit()
        self.assertEqual(self.call(path)["totals"], report["totals"])
        self.call(f"/api/cash-sessions/{other_session.id}/product-movements", status=403)
        self.call("/api/cash-sessions/99999/product-movements", status=404)
        self.grant("clotures_consulter")
        self.call(f"/api/cash-sessions/{other_session.id}/product-movements")
        self.db.get(CashSession, session["id"]).z_report = "invalid"
        self.db.commit()
        unknown = next(row for row in remote_sales._cash_balances(self.db)["sessions"]
                       if row["seller_email"] == self.user.email)
        self.assertIsNone(unknown["expected_cash"])
        self.other.is_active = False
        self.db.commit()
        self.assertIn(self.other.email, [row["seller_email"] for row in remote_sales._cash_balances(self.db)["sessions"]])


if __name__ == "__main__":
    unittest.main()
