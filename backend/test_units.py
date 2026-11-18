import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text

import test_cash_register as cash_tests
from app import migrate as migration
from app.models import Product, StockLot, StockMovement
from app.routers import inventory, products, purchases, transfers


class PackagingTests(unittest.TestCase):
    call = cash_tests.CashRegisterTests.call
    grant = cash_tests.CashRegisterTests.grant
    open = cash_tests.CashRegisterTests.open

    def setUp(self):
        cash_tests.CashRegisterTests.setUp(self)
        for router in (inventory.router, products.router, purchases.router, transfers.router):
            self.app.include_router(router)
        self.user.role = "admin"
        self.product.quantity = 200
        self.product.base_unit = "pièce"
        self.product.packaging_unit = "carton"
        self.product.units_per_packaging = 12
        self.product.packaging_sale_price = 1000
        self.db.commit()
        self.open()

    def sell(self, **line):
        return self.call("/api/sales", "POST", {"client_id": "packaged-sale", "items": [{"product_id": self.product.id, **line}]}, status=201)

    def stock(self):
        self.db.expire_all()
        return self.db.get(Product, self.product.id).quantity

    def test_mixed_sale_and_replay_deduct_exactly_27_once(self):
        self.db.add(StockLot(product_id=self.product.id, quantity=200))
        self.db.commit()
        first = self.sell(packaging_quantity=2, piece_quantity=3)
        self.assertEqual(first["items"][0]["quantity"], 27)
        self.assertEqual(first["total"], 2300)
        self.assertEqual(self.stock(), 173)
        replay = self.sell(packaging_quantity=2, piece_quantity=3)
        self.assertEqual(replay["id"], first["id"])
        self.assertEqual(self.stock(), 173)
        self.assertEqual(self.db.query(StockMovement).filter_by(kind="vente").count(), 1)
        self.assertEqual(self.db.query(StockLot).one().quantity, 173)

    def test_carton_only_and_price_fallback(self):
        self.product.packaging_sale_price = None
        self.db.commit()
        sale = self.sell(packaging_quantity=2)
        self.assertEqual(sale["total"], 2400)
        self.assertEqual(sale["items"][0]["sold_unit"], "carton")
        self.assertEqual(self.stock(), 176)

    def test_base_only_product_keeps_legacy_payload_and_prices(self):
        self.product.packaging_unit = ""
        self.db.commit()
        sale = self.sell(quantity=3)
        self.assertEqual(sale["total"], 300)
        self.assertEqual(self.stock(), 197)

    def test_sale_history_and_return_keep_original_factor_and_prices(self):
        sale = self.sell(packaging_quantity=2, piece_quantity=3)
        original = sale["items"][0]
        self.assertEqual((original["base_quantity"], original["packaging_quantity"], original["piece_quantity"]), (27, 2, 3))
        self.product.units_per_packaging = 24
        self.product.packaging_unit = "boîte"
        self.product.sale_price = 150
        self.product.packaging_sale_price = 2000
        self.db.commit()
        history = self.call("/api/sales")[0]["items"][0]
        self.assertEqual(history, original)
        self.assertEqual(self.sell(packaging_quantity=2, piece_quantity=3)["items"][0], original)
        credit = self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{"product_id": self.product.id, "packaging_quantity": 1}]}, status=201)
        self.assertEqual(credit["items"][0]["quantity"], 12)
        self.assertEqual(credit["total"], 1000)
        self.assertEqual(credit["items"][0]["units_per_packaging"], 12)
        self.assertEqual(self.stock(), 185)

    def test_purchase_receipt_uses_order_snapshot(self):
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Fournisseur test", "items": [{"product_id": self.product.id, "packaging_quantity": 2, "packaging_unit_cost": 1200}]}, status=201)
        self.assertEqual(purchase["items"][0]["quantity"], 24)
        self.assertEqual(purchase["total"], 2400)
        self.product.units_per_packaging = 24
        self.db.commit()
        partial = self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"items": [{"item_id": purchase["items"][0]["id"], "packaging_quantity": 1}]})
        self.assertEqual(partial["items"][0]["received_quantity"], 12)
        self.assertEqual(self.stock(), 212)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.assertEqual(self.stock(), 224)

    def test_inventory_mixed_count_and_transfer(self):
        moves = self.call("/api/inventory/apply", "POST", {"lines": [{"product_id": self.product.id, "packaging_quantity": 2, "piece_quantity": 3}]})
        self.assertEqual(self.stock(), 27)
        self.assertEqual(moves[0]["stock_after"], 27)
        self.assertEqual(moves[0]["quantity_label"], "-173 pièce = −14 carton − 5 pièce")
        transfer = self.call("/api/transfers", "POST", {"direction": "entree", "store_name": "Dépôt", "items": [{"product_id": self.product.id, "packaging_quantity": 1}]}, status=201)
        self.assertEqual(transfer["items"][0]["quantity"], 12)
        self.assertEqual(self.stock(), 39)

    def test_invalid_empty_and_changed_factor_do_not_move_stock(self):
        self.call("/api/sales", "POST", {"items": []}, status=400)
        for line, status in [({"packaging_quantity": -1}, 422), ({"packaging_quantity": 0}, 400), ({"packaging_quantity": 1, "expected_units_per_packaging": 24}, 409), ({"packaging_quantity": 100}, 400)]:
            self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, **line}]}, status=status)
        self.assertEqual(self.stock(), 200)

    def test_old_schema_migration_preserves_rows_and_integer_stock(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE products (id INTEGER PRIMARY KEY, quantity INTEGER)"))
            conn.execute(text("INSERT INTO products VALUES (1, 120)"))
            conn.execute(text("CREATE TABLE sale_items (id INTEGER PRIMARY KEY, quantity INTEGER, unit_price FLOAT)"))
            conn.execute(text("INSERT INTO sale_items VALUES (1, 3, 100)"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT quantity, base_unit, packaging_unit, units_per_packaging FROM products")).one(), (120, "pièce", "", 1))
            self.assertEqual(conn.execute(text("SELECT quantity, unit_price FROM sale_items")).one(), (3, 100))
        self.assertEqual(str(next(c["type"] for c in inspect(engine).get_columns("products") if c["name"] == "quantity")), "INTEGER")

    def test_legacy_product_update_preserves_optional_packaging(self):
        updated = self.call(f"/api/products/{self.product.id}", "PUT", {"name": "Nouveau nom", "sku": self.product.sku, "quantity": 200, "sale_price": 100})
        self.assertEqual(updated["packaging_unit"], "carton")
        self.assertEqual(updated["units_per_packaging"], 12)
        self.assertEqual(updated["packaging_sale_price"], 1000)

    def test_packaging_does_not_bypass_price_permissions_or_create_packs(self):
        self.user.role = "vendeur"
        self.db.commit()
        self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, "packaging_quantity": 1, "unit_price": 1}]}, status=403)
        self.product.packaging_unit = ""
        self.db.commit()
        self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, "packaging_quantity": 1}]}, status=400)
        self.assertEqual(self.stock(), 200)
