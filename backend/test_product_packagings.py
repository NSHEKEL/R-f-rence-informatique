import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text

from app.database import Base
from app import migrate as migration
from app.models import PriceHistory, ProductPackaging
import test_wholesale as wholesale_tests


class ProductPackagingsTests(unittest.TestCase):
    setUp = wholesale_tests.WholesaleTests.setUp
    call = wholesale_tests.WholesaleTests.call
    sell = wholesale_tests.WholesaleTests.sell
    stock = wholesale_tests.WholesaleTests.stock
    open = wholesale_tests.WholesaleTests.open
    grant = wholesale_tests.WholesaleTests.grant
    balances = wholesale_tests.WholesaleTests.balances

    def update(self, **changes):
        payload = self.call(f"/api/products/{self.product.id}")
        return self.call(f"/api/products/{self.product.id}", "PUT", {**payload, **changes})

    def configure(self):
        product = self.update(semi_wholesale_price=90, semi_wholesale_min_qty=24,
                              wholesale_min_qty=48, supplier_purchase_price=60,
                              packagings=[{"name": "Colis", "factor": 24, "barcode": "PACK-24",
                                           "price_detail": 2100, "price_semi_gros": 1800,
                                           "price_gros": 1500, "purchase_price": 960}])
        return product["packagings"][0]

    def test_purchase_240_sale_48_five_pieces_and_mixed_51(self):
        packaging = self.configure()
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Fournisseur", "items": [{"product_id": self.product.id,
            "packaging_id": packaging["id"], "packaging_quantity": 10}]}, 201)
        self.assertEqual(purchase["items"][0]["quantity"], 240)
        self.assertEqual(purchase["items"][0]["unit_cost"], 40)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.balances(0, 0, 440)
        sale = self.sell([{"packaging_id": packaging["id"], "packaging_quantity": 2}])
        self.assertEqual(sale["items"][0]["quantity"], 48)
        self.assertEqual(sale["items"][0]["packaging_unit"], "Colis")
        self.balances(4200, 1920, 392)
        self.sell([{"quantity": 5}])
        self.balances(4700, 2120, 387)
        mixed = self.sell([{"packaging_id": packaging["id"], "packaging_quantity": 2,
                            "piece_quantity": 3, "price_tier": "gros"}])
        self.assertEqual(mixed["items"][0]["quantity"], 51)
        self.assertEqual(mixed["total"], 3240)
        self.balances(7940, 4160, 336)

    def test_tiers_thresholds_and_fallbacks(self):
        packaging = self.configure()
        for quantity, tier, total in ((1, "detail", 100), (23, "detail", 2300),
                                      (24, "semi_gros", 2160), (47, "semi_gros", 4230), (48, "gros", 3840)):
            sale = self.sell([{"quantity": quantity, "price_tier": "auto"}])
            self.assertEqual(sale["items"][0]["price_tier"], tier)
            self.assertEqual(sale["total"], total)
        semi = self.sell([{"packaging_id": packaging["id"], "packaging_quantity": 1, "price_tier": "auto"}])
        self.assertEqual(semi["total"], 1800)
        self.assertEqual(semi["items"][0]["price_tier"], "semi_gros")
        self.update(packagings=[{**packaging, "price_gros": None, "price_semi_gros": None}], semi_wholesale_price=None)
        self.assertEqual(self.sell([{"packaging_id": packaging["id"], "packaging_quantity": 1, "price_tier": "semi_gros"}])["total"], 2400)
        self.assertEqual(self.sell([{"packaging_id": packaging["id"], "quantity": 1, "price_tier": "gros"}])["total"], 80)

    def test_lookup_uniqueness_validation_empty_and_old_payloads(self):
        packaging = self.configure()
        self.update(barcode="1234567890123")
        found = self.call("/api/products/by-code/PACK-24")
        self.assertEqual((found["id"], found["packaging_id"]), (self.product.id, packaging["id"]))
        self.assertIsNone(self.call(f"/api/products/by-code/{self.product.sku}")["packaging_id"])
        payload = self.call(f"/api/products/{self.product.id}")
        for code in (self.product.sku, "PACK-24", "1234567890123"):
            self.call("/api/products", "POST", {"name": "Doublon", "sku": code}, 400)
            self.call("/api/products", "POST", {"name": "Doublon", "sku": "UNIQUE", "packagings": [{"name": "Sac", "factor": 2, "barcode": code}]}, 400)
        for factor in (0, -1, 1.5):
            self.call(f"/api/products/{self.product.id}", "PUT", {**payload, "packagings": [{"name": "Sac", "factor": factor}]}, 422)
        duplicate = [{"name": "Sac", "factor": 2, "barcode": "DUP"}, {"name": "Boîte", "factor": 3, "barcode": "DUP"}]
        self.call(f"/api/products/{self.product.id}", "PUT", {**payload, "packagings": duplicate}, 400)
        self.assertEqual(len(self.call(f"/api/products/{self.product.id}")["packagings"]), 1)
        self.call(f"/api/products/{self.product.id}", "DELETE", status=400)
        self.call(f"/api/products/{self.product.id}", "PUT", {"sku": self.product.sku, "name": self.product.name})
        self.assertEqual(len(self.call(f"/api/products/{self.product.id}")["packagings"]), 1)
        self.update(packagings=[])
        self.call("/api/products/by-code/PACK-24", status=404)
        self.assertFalse(self.call(f"/api/products/{self.product.id}")["packagings"][0]["active"])
        self.sell([{"packaging_id": packaging["id"], "packaging_quantity": 1}], status=400)

    def test_history_returns_and_snapshots_survive_packaging_changes(self):
        packaging = self.configure()
        sale = self.sell([{"packaging_id": packaging["id"], "packaging_quantity": 2,
                           "piece_quantity": 3, "price_tier": "auto"}])
        self.update(packagings=[{**packaging, "name": "Nouveau colis", "factor": 12, "price_gros": 999}], purchase_price=999)
        history = self.call(f"/api/products/{self.product.id}/price-history")
        entry = next(row for row in history if row["field"] == f"packaging:{packaging['id']}:price_gros")
        self.assertEqual(entry["changed_by"]["id"], self.user.id)
        self.assertEqual(self.call(f"/api/sales/{sale['id']}")["items"], sale["items"])
        self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{
            "product_id": self.product.id, "sale_item_id": sale["items"][0]["id"], "packaging_quantity": 1}]}, 201)
        self.assertEqual(self.stock(), 173)
        self.call(f"/api/sales/{sale['id']}", "DELETE", status=204)
        self.assertEqual(self.stock(), 200)
        self.assertIsNotNone(self.db.get(ProductPackaging, packaging["id"]))

    def test_invalid_line_rolls_back_stock_and_unprivileged_price_override(self):
        packaging = self.configure()
        other = self.call("/api/products", "POST", {"name": "Autre article", "sku": "OTHER",
            "packagings": [{"name": "Sac", "factor": 12}]}, 201)
        foreign = other["packagings"][0]["id"]
        self.sell([{"packaging_id": foreign, "packaging_quantity": 1}], status=400)
        self.call("/api/purchases", "POST", {"supplier_name": "Fournisseur", "items": [{
            "product_id": self.product.id, "packaging_id": foreign, "packaging_quantity": 1}]}, 400)
        self.sell([{"quantity": 1}, {"packaging_id": 999999, "packaging_quantity": 1}], status=400)
        self.assertEqual(self.stock(), 200)
        self.user.role = "vendeur"
        self.grant("vente_nouvelle", "ventes")
        self.sell([{"packaging_id": packaging["id"], "packaging_quantity": 1, "price_tier": "semi_gros", "unit_price": 1}], status=403)
        self.assertEqual(self.stock(), 200)

    def test_csv_author_and_additive_migration(self):
        data = f"reference;nom;prix_vente\n{self.product.sku};Test;125\n"
        response = self.client.post("/api/products/import", files={"file": ("prix.csv", data.encode(), "text/csv")})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated"], 1)
        self.db.expire_all()
        self.assertEqual(self.db.query(PriceHistory).filter_by(field="sale_price").one().changed_by_id, self.user.id)
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE products (id INTEGER PRIMARY KEY, quantity INTEGER)"))
            conn.execute(text("INSERT INTO products VALUES (1, 73)"))
            conn.execute(text("CREATE TABLE sale_items (id INTEGER PRIMARY KEY, quantity INTEGER)"))
            conn.execute(text("INSERT INTO sale_items VALUES (1, 51)"))
        Base.metadata.create_all(engine)
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        self.assertIn("product_packagings", inspect(engine).get_table_names())
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT quantity, semi_wholesale_price, wholesale_min_qty FROM products")).one(), (73, None, None))
            self.assertEqual(conn.execute(text("SELECT quantity, packaging_id FROM sale_items")).one(), (51, None))


if __name__ == "__main__":
    unittest.main()
