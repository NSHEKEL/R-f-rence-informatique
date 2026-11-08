import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import test_units as units_tests
from app import migrate as migration
from app.models import Product, Sale, SaleItem, SaleReturnItem


class WholesaleTests(unittest.TestCase):
    grant = units_tests.PackagingTests.grant
    open = units_tests.PackagingTests.open
    stock = units_tests.PackagingTests.stock

    def call(self, path, method="GET", payload=None, status=200):
        response = self.client.request(method, path, json=payload)
        self.assertEqual(response.status_code, status, response.text)
        return response.json() if response.content else None

    def setUp(self):
        units_tests.cash_tests.CashRegisterTests.setUp(self)
        for router in (units_tests.products.router, units_tests.purchases.router):
            self.app.include_router(router)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.user.role = "admin"
        self.product.quantity = 200
        self.product.base_unit = "pièce"
        self.product.packaging_unit = "carton"
        self.product.units_per_packaging = 24
        self.product.purchase_price = 40
        self.product.sale_price = 100
        self.product.packaging_sale_price = 2000
        self.product.wholesale_price = 80
        self.product.wholesale_packaging_price = 1500
        self.db.commit()
        self.open()

    def sell(self, lines, discount=0, status=201):
        return self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, **line} for line in lines], "discount": discount}, status)

    def balances(self, revenue, cost, stock):
        result = self.call("/api/accounting/summary")
        self.assertAlmostEqual(result["revenue"], revenue)
        self.assertAlmostEqual(result["cost_of_goods"], cost)
        self.assertAlmostEqual(result["gross_margin"], revenue - cost)
        self.assertEqual(self.stock(), stock)
        report = self.call("/api/reports/sales")
        self.assertAlmostEqual(sum(row["profit"] for row in report["profit_by_product"]), revenue - cost)
        self.assertAlmostEqual(sum(row["profit"] for row in report["profit_by_sale"]), revenue - cost)

    def test_purchase_sales_discounts_return_cancel_and_immutable_cost(self):
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Grossiste", "items": [{"product_id": self.product.id, "packaging_quantity": 1, "packaging_unit_cost": 960}]}, 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.balances(0, 0, 224)
        carton = self.sell([{"price_tier": "gros", "packaging_quantity": 1}])
        self.assertEqual(carton["items"][0]["catalog_unit_price"], 62.5)
        self.assertEqual(carton["items"][0]["unit_cost"], 40)
        self.balances(1500, 960, 200)
        self.sell([{"price_tier": "gros", "quantity": 5}])
        self.balances(1900, 1160, 195)
        mixed = self.sell([{"price_tier": "gros", "packaging_quantity": 2, "piece_quantity": 5, "discount": 100}], discount=300)
        self.assertEqual(mixed["items"][0]["quantity"], 53)
        self.assertAlmostEqual(mixed["total"], 3000)
        self.assertEqual(mixed["discount_by_id"], self.user.id)
        self.balances(4900, 3280, 142)
        self.product.purchase_price = 90
        self.product.wholesale_packaging_price = 5000
        self.db.commit()
        line = mixed["items"][0]
        credit = self.call("/api/returns", "POST", {"sale_reference": mixed["reference"], "lines": [{"sale_item_id": line["id"], "product_id": self.product.id, "packaging_quantity": 1}]}, 201)
        refund = 1500 * 3000 / 3400
        self.assertAlmostEqual(credit["total"], refund)
        self.assertEqual(self.db.query(SaleReturnItem).one().unit_cost, 40)
        self.balances(4900 - refund, 2320, 166)
        detail = self.call(f"/api/sales/{mixed['id']}")
        self.assertAlmostEqual(detail["profit"], 3000 - refund - 1160)
        self.call(f"/api/sales/{mixed['id']}", "DELETE", status=204)
        self.balances(1900, 1160, 195)
        self.db.expire_all()
        product = self.db.get(Product, self.product.id)
        product.purchase_price = 999
        product.sale_price = 500
        product.wholesale_price = 400
        product.wholesale_packaging_price = 9000
        self.db.commit()
        self.assertEqual(self.call(f"/api/sales/{carton['id']}")["items"], carton["items"])
        self.balances(1900, 1160, 195)

    def test_permissions_recomputation_tiers_and_redaction(self):
        self.user.role = "vendeur"
        self.grant("vente_nouvelle", "ventes", "retours")
        self.sell([{"quantity": 1, "unit_price": 1}], status=403)
        self.sell([{"quantity": 1, "discount": 1}], status=403)
        self.sell([{"quantity": 1}], discount=1, status=403)
        self.assertEqual(self.stock(), 200)
        self.sell([{"quantity": 1, "price_tier": "invalid"}], status=422)
        self.sell([], status=400)
        self.sell([{"packaging_quantity": 0}], status=400)
        sale = self.sell([{"price_tier": "detail", "packaging_quantity": 1}, {"price_tier": "gros", "quantity": 5}])
        self.assertEqual([line["price_tier"] for line in sale["items"]], ["detail", "gros"])
        self.assertEqual(sale["total"], 2400)
        for path, method in [(f"/api/sales/{sale['id']}", "GET"), (f"/api/sales/{sale['id']}/print", "POST")]:
            hidden = self.call(path, method)
            self.assertIsNone(hidden["profit"])
            self.assertTrue(all(line["unit_cost"] is None for line in hidden["items"]))
        self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{"product_id": self.product.id, "quantity": 1}]}, 400)
        credit = self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{"product_id": self.product.id, "sale_item_id": sale["items"][1]["id"], "quantity": 2}]}, 201)
        self.assertEqual(credit["total"], 160)
        detail = self.call(f"/api/sales/{sale['id']}")
        self.assertEqual([line["returned_quantity"] for line in detail["items"]], [0, 2])
        self.assertEqual(self.stock(), 173)
        self.grant("prix_modifier")
        changed = self.sell([{"quantity": 2, "unit_price": 120, "discount": 10}], discount=5)
        self.assertEqual(changed["items"][0]["catalog_unit_price"], 100)
        self.assertEqual(changed["items"][0]["unit_price"], 120)
        self.assertEqual(changed["total"], 225)

    def test_migration_defaults_legacy_cost_and_carton_fallbacks(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE products (id INTEGER PRIMARY KEY, quantity INTEGER)"))
            conn.execute(text("INSERT INTO products VALUES (1, 24)"))
            conn.execute(text("CREATE TABLE sales (id INTEGER PRIMARY KEY)"))
            conn.execute(text("CREATE TABLE sale_items (id INTEGER PRIMARY KEY, quantity INTEGER, unit_price FLOAT)"))
            conn.execute(text("INSERT INTO sale_items VALUES (1, 24, 100)"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT quantity, wholesale_packaging_price FROM products")).one(), (24, None))
            self.assertEqual(conn.execute(text("SELECT quantity, unit_price, price_tier, catalog_unit_price, unit_cost FROM sale_items")).one(), (24, 100, "detail", None, None))
        self.assertIn("discount_by_id", {c["name"] for c in inspect(engine).get_columns("sales")})
        legacy = Sale(reference="LEGACY", total=200)
        legacy.items.append(SaleItem(product_id=self.product.id, product_name=self.product.name, quantity=2, unit_price=100, subtotal=200))
        self.db.add(legacy)
        self.db.commit()
        self.balances(200, 80, 200)
        self.product.wholesale_packaging_price = None
        self.db.commit()
        self.assertEqual(self.sell([{"packaging_quantity": 1, "price_tier": "gros"}])["total"], 1920)
        self.product.wholesale_price = 0
        self.db.commit()
        self.assertEqual(self.sell([{"packaging_quantity": 1, "price_tier": "gros"}])["total"], 2000)

    def test_catalogue_carton_field_and_csv_alias_are_additive(self):
        payload = {"name": self.product.name, "sku": self.product.sku, "sale_price": 100, "purchase_price": 40, "wholesale_price": 80}
        unchanged = self.call(f"/api/products/{self.product.id}", "PUT", payload)
        self.assertEqual(unchanged["wholesale_packaging_price"], 1500)
        self.call(f"/api/products/{self.product.id}", "PUT", {**payload, "wholesale_packaging_price": -1}, 422)
        self.call(f"/api/products/{self.product.id}", "PUT", {**payload, "wholesale_packaging_price": None})
        data = f"reference;nom;prix_gros_carton\n{self.product.sku};Grossiste;1450\n"
        response = self.client.post("/api/products/import", files={"file": ("prix.csv", data.encode(), "text/csv")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.call(f"/api/products/{self.product.id}")["wholesale_packaging_price"], 1450)
        self.call(f"/api/products/{self.product.id}/price-history")


if __name__ == "__main__":
    unittest.main()
