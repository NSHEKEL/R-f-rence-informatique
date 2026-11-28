import unittest

import test_product_packagings as packaging
from app import stock
from app.models import PriceHistory, Product, ProductPackaging, Sale, StockMovement
from app.routers import returns


class PackagingDivisionTests(unittest.TestCase):
    setUp = packaging.ProductPackagingsTests.setUp
    call = packaging.ProductPackagingsTests.call
    update = packaging.ProductPackagingsTests.update
    sell = packaging.ProductPackagingsTests.sell
    grant = packaging.ProductPackagingsTests.grant
    open = packaging.ProductPackagingsTests.open

    def test_rounded_divided_carton_refunds_match_pieces(self):
        self.app.include_router(returns.router)
        self.update(units_per_packaging=12, packaging_sale_price=2002)
        for price in (None, 180):
            line = {"packaging_divisor": 4, "piece_quantity": 24}
            if price is not None:
                line.update(unit_price=price, price_edited=True)
            refunds = []
            for parts in ({"packaging_quantity": 1}, {"piece_quantity": 12}):
                sold = self.sell([line])
                item = sold["items"][0]
                expected = 2004 if price is None else 2160
                self.assertEqual(item["packaging_sale_price"], expected)
                self.assertAlmostEqual(item["base_unit_price"] * 12, expected)
                returned = self.call("/api/returns", "POST", {
                    "sale_reference": sold["reference"], "refund_method": "Espèces",
                    "lines": [{"product_id": self.product.id, "sale_item_id": item["id"], **parts}],
                }, 201)
                refunds.append(returned["total"])
            self.assertEqual(refunds, [expected, expected])

    def test_half_carton_stock_money_snapshot_and_idempotent_sync(self):
        self.update(units_per_packaging=12, packaging_sale_price=2000)
        payload = {"client_id": "half-offline", "items": [{"product_id": self.product.id, "packaging_divisor": 2, "expected_units_per_packaging": 12, "packaging_quantity": 0, "piece_quantity": 6, "unit_price": 1000 / 6}]}
        saved = self.call("/api/sales", "POST", payload, 201)
        self.assertEqual((saved["total"], saved["items"][0]["quantity"], saved["items"][0]["packaging_divisor"]), (1000, 6, 2))
        self.assertEqual(self.call("/api/sales", "POST", payload, 201)["id"], saved["id"])
        self.db.expire_all()
        self.assertEqual(self.db.get(Product, self.product.id).quantity, 194)
        self.assertEqual(self.db.query(StockMovement).filter_by(kind="vente").count(), 1)
        self.assertEqual(self.db.query(Sale).count(), 1)
        self.assertEqual(stock.inconsistencies(self.db), [])
        self.assertEqual(self.db.get(Product, self.product.id).packaging_sale_price, 2000)

    def test_additional_packaging_rounding_manual_price_not_persisted_and_permissions(self):
        pack = self.update(packagings=[{"name": "Colis", "factor": 12, "price_detail": 2002}])["packagings"][0]
        line = {"packaging_id": pack["id"], "packaging_divisor": 4, "piece_quantity": 3, "unit_price": 501 / 3}
        self.user.role = "vendeur"
        self.db.commit()
        self.grant("vente_nouvelle")
        sold = self.sell([line])
        self.assertEqual(sold["total"], 501)
        self.sell([{**line, "unit_price": 200}], status=403)
        self.grant("vente_nouvelle", "prix_modifier")
        manual = self.sell([{**line, "unit_price": 200, "price_edited": True}])
        self.assertEqual(manual["total"], 600)
        self.db.expire_all()
        self.assertEqual(self.db.get(ProductPackaging, pack["id"]).price_detail, 2002)
        self.assertEqual(self.db.query(PriceHistory).count(), 0)

    def test_invalid_fraction_empty_packaging_changed_factor_and_zero_divisor(self):
        for line, status in (({"packaging_divisor": 5, "quantity": 4}, 400), ({"packaging_divisor": 2, "quantity": 5}, 400), ({"packaging_divisor": 0, "quantity": 6}, 422), ({"packaging_divisor": 2, "quantity": 12, "expected_units_per_packaging": 99}, 409)):
            self.sell([line], status=status)
        self.update(packaging_unit="", units_per_packaging=1)
        self.sell([{"packaging_divisor": 2, "quantity": 1}], status=400)
        self.assertEqual(self.db.query(Sale).count(), 0)
