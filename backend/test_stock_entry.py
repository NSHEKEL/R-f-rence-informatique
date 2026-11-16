import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import test_wholesale as wholesale
from app import stock
from app.models import CompanySettings, Depot, ProductPackaging, StockMovement
from app.routers import settings


class StockEntryTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    sell = wholesale.WholesaleTests.sell
    stock = wholesale.WholesaleTests.stock
    grant = wholesale.WholesaleTests.grant
    open = wholesale.WholesaleTests.open

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        self.app.include_router(settings.router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.product.quantity = 0
        self.company = CompanySettings()
        self.db.add(self.company)
        self.pack = ProductPackaging(product_id=self.product.id, name="Colis", factor=6, active=True)
        self.db.add(self.pack)
        self.db.commit()

    def enable(self):
        self.call("/api/settings/company", "PUT", {"allow_negative_stock_sale": True})

    def entry(self, **values):
        return self.call(f"/api/products/{self.product.id}/stock-entry", "POST", values, 201)

    def test_setting_off_on_sale_receipt_and_offline_replay(self):
        self.assertFalse(self.call("/api/settings/company")["allow_negative_stock_sale"])
        self.sell([{"quantity": 2}], status=400)
        self.assertEqual(self.stock(), 0)
        self.assertEqual(self.call("/api/products/pos"), [])
        self.enable()
        self.assertIn(self.product.id, [row["id"] for row in self.call("/api/products/pos")])
        payload = {"client_id": "offline-negative-sale", "items": [{"product_id": self.product.id, "quantity": 2}]}
        first = self.call("/api/sales", "POST", payload, 201)
        self.assertEqual(self.stock(), -2)
        self.call("/api/sales", "POST", payload, 201)
        self.assertEqual(self.stock(), -2)
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Test", "items": [{"product_id": self.product.id, "quantity": 24, "unit_cost": 40}]}, 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.assertEqual(self.stock(), 22)
        self.call("/api/settings/company", "PUT", {"allow_negative_stock_sale": False})
        self.sell([{"quantity": 23}], status=400)
        self.assertEqual(self.stock(), 22)
        self.assertEqual(self.call(f"/api/sales/{first['id']}")["items"][0]["quantity"], 2)

    def test_primary_and_additional_packaging_and_transaction_policy(self):
        self.enable()
        self.sell([{"packaging_quantity": 1}])
        self.assertEqual(self.stock(), -24)
        self.sell([{"packaging_id": self.pack.id, "packaging_quantity": 2}])
        self.assertEqual(self.stock(), -36)
        self.assertEqual(stock.quantity(self.db, self.product.id), -36)
        self.call("/api/settings/company", "PUT", {"allow_negative_stock_sale": False})
        self.sell([{"packaging_quantity": 1}], status=400)
        self.product.quantity = 24
        self.db.commit()
        with patch("app.routers.sales.stock.adjust", side_effect=HTTPException(400, "Stock insuffisant")) as adjust:
            self.sell([{"quantity": 1}], status=400)
            self.assertTrue(adjust.call_args.kwargs["check_total"])
        self.enable()
        original = stock.adjust
        with patch("app.routers.sales.stock.adjust", wraps=original) as adjust:
            self.sell([{"quantity": 25}])
            self.assertFalse(adjust.call_args.kwargs["check_total"])

    def test_entries_base_primary_packaging_and_depot_record_history(self):
        self.product.quantity = -2
        self.db.commit()
        self.assertEqual(self.entry(quantity=2)["quantity"], 0)
        self.assertEqual(self.entry(quantity=1, unit="packaging")["quantity"], 24)
        depot = Depot(code="RESERVE-ENTRY", name="Réserve", active=True)
        self.db.add(depot)
        self.db.commit()
        self.assertEqual(self.entry(quantity=2, unit="packaging", packaging_id=self.pack.id, depot_id=depot.id, reason="Correction", note=" Livraison ")["quantity"], 36)
        self.assertEqual(stock.quantity(self.db, self.product.id, depot.id), 12)
        movement = self.db.query(StockMovement).filter_by(kind="entree").order_by(StockMovement.id.desc()).first()
        self.assertEqual((movement.quantity, movement.stock_before, movement.stock_after), (12, 0, 12))
        self.assertEqual((movement.depot_id, movement.created_by_id), (depot.id, self.user.id))
        self.assertEqual(movement.reason, "Correction — Livraison")
        self.assertEqual((movement.packaging_unit, movement.units_per_packaging), ("Colis", 6))
        updated = self.call(f"/api/products/{self.product.id}", "PUT", {"name": self.product.name, "sku": self.product.sku, "quantity": 5})
        self.assertEqual(updated["quantity"], 5)

    def test_entry_invalid_input_permissions_missing_and_inactive(self):
        path = f"/api/products/{self.product.id}/stock-entry"
        for quantity in (0, -1, 1.5, True, "2", 2147483648):
            self.call(path, "POST", {"quantity": quantity}, 422)
        self.call(path, "POST", {}, 422)
        self.call(path, "POST", {"quantity": 1, "reason": "Invalid"}, 422)
        self.call(path, "POST", {"quantity": 1, "note": "x" * 501}, 422)
        for fields in ({"depot_id": 99999}, {"packaging_id": self.pack.id}, {"unit": "packaging", "quantity": 2147483647}):
            self.call(path, "POST", {"quantity": 1, **fields}, 400)
        self.call("/api/products/99999/stock-entry", "POST", {"quantity": 1}, 404)
        self.pack.active = False
        self.db.commit()
        self.call(path, "POST", {"quantity": 1, "unit": "packaging", "packaging_id": self.pack.id}, 400)
        self.assertEqual(self.stock(), 0)
        self.assertEqual(self.db.query(StockMovement).filter_by(kind="entree").count(), 0)
        self.user.role = "vendeur"
        self.db.commit()
        self.call(path, "POST", {"quantity": 1}, 403)
        self.call("/api/settings/company", "PUT", {"allow_negative_stock_sale": True}, 403)
        self.grant("generaux_modifier")
        self.enable()
        self.grant("produits_gerer")
        self.entry(quantity=1)


if __name__ == "__main__":
    unittest.main()
