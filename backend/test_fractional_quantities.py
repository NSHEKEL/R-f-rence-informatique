import unittest

import test_units as fixtures
from app import stock
from app.models import Product, StockLot, StockMovement


class FractionalQuantityTests(unittest.TestCase):
    setUp = fixtures.PackagingTests.setUp
    call = fixtures.PackagingTests.call
    grant = fixtures.PackagingTests.grant
    open = fixtures.PackagingTests.open
    stock = fixtures.PackagingTests.stock

    def prepare(self):
        product = self.db.get(Product, self.product.id)
        stock.set_total(self.db, product, 1)
        product.base_unit = "kg"
        product.packaging_unit = ""
        product.sale_price = 3500
        product.purchase_price = 2000
        self.db.add(StockLot(product_id=product.id, quantity=1, unit_cost=2000))
        self.db.commit()

    def test_half_unit_sale_and_return_preserve_fractional_stock_and_cash(self):
        self.prepare()
        opening = self.call("/api/cash-sessions/current")["expected_cash"]
        sale = self.call("/api/sales", "POST", {"client_id": "half-unit", "items": [{"product_id": self.product.id, "quantity": 0.5}]}, 201)
        self.assertEqual((sale["total"], sale["items"][0]["quantity"], self.stock()), (1750, 0.5, 0.5))
        self.assertIn("0,5", sale["items"][0]["quantity_label"])
        self.assertEqual(stock.quantity(self.db, self.product.id), 0.5)
        self.assertEqual(self.db.query(StockLot).one().quantity, 0.5)
        move = self.db.query(StockMovement).filter_by(kind="vente").one()
        self.assertEqual((move.quantity, move.stock_before, move.stock_after), (-0.5, 1, 0.5))
        self.assertEqual(self.call("/api/products")[0]["stock_value"], 1000)
        self.assertEqual(self.call("/api/products/stock/dashboard")["cost_value"], 1000)
        self.assertEqual(self.call("/api/cash-sessions/current")["expected_cash"], opening + 1750)
        replay = self.call("/api/sales", "POST", {"client_id": "half-unit", "items": [{"product_id": self.product.id, "quantity": 0.5}]}, 201)
        self.assertEqual(replay["id"], sale["id"])
        self.assertEqual(self.stock(), 0.5)
        returned = self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "refund_method": "Espèces", "lines": [{"product_id": self.product.id, "quantity": 0.5}]}, 201)
        self.assertEqual((returned["total"], returned["items"][0]["quantity"], self.stock()), (1750, 0.5, 1))
        self.assertEqual(self.call("/api/cash-sessions/current")["expected_cash"], opening)
        self.assertEqual(stock.inconsistencies(self.db), [])
        self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{"product_id": self.product.id, "quantity": 0.5}]}, 400)

    def test_decimal_rounding_inventory_and_invalid_quantities(self):
        self.prepare()
        self.call("/api/sales", "POST", {"items": []}, 400)
        for quantity, status in ((0, 400), (-0.5, 400), (0.0000001, 422), (2, 400)):
            self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, "quantity": quantity}]}, status)
        sale = self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, "quantity": 0.333333}]}, 201)
        self.assertEqual((sale["total"], self.stock()), (1167, 0.666667))
        returned = self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{"product_id": self.product.id, "piece_quantity": 0.333333}]}, 201)
        self.assertAlmostEqual(returned["total"], 1167)
        self.assertEqual(self.stock(), 1)
        split_sale = self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, "quantity": 0.3}]}, 201)
        for _ in range(3):
            self.call("/api/returns", "POST", {"sale_reference": split_sale["reference"], "lines": [{"product_id": self.product.id, "quantity": 0.1}]}, 201)
        self.assertEqual(self.stock(), 1)
        moves = self.call("/api/inventory/apply", "POST", {"lines": [{"product_id": self.product.id, "counted_quantity": 0.25}]})
        self.assertEqual(self.stock(), 0.25)
        self.assertEqual(stock.inconsistencies(self.db), [])
