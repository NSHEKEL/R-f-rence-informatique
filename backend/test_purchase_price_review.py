import unittest

import test_wholesale as wholesale
from app import stock
from app.models import PriceHistory, Product, Purchase, StockMovement


class PurchasePriceReviewTests(unittest.TestCase):
    setUp = wholesale.WholesaleTests.setUp
    call = wholesale.WholesaleTests.call
    sell = wholesale.WholesaleTests.sell
    grant = wholesale.WholesaleTests.grant
    open = wholesale.WholesaleTests.open
    stock = wholesale.WholesaleTests.stock

    def purchase(self, items=None):
        return self.call("/api/purchases", "POST", {"supplier_name": "Grossiste",
            "items": items or [{"product_id": self.product.id, "quantity": 3, "unit_cost": 60}]}, 201)

    def change(self, field="sale_price", old=100, new=125, **kwargs):
        return {"product_id": self.product.id, "field": field, "old_value": old, "new_value": new, **kwargs}

    def test_bulk_review_all_catalogue_fields_audit_and_historical_snapshots(self):
        sale = self.sell([{"quantity": 1}])
        original = self.call(f"/api/products/{self.product.id}")
        original = self.call(f"/api/products/{self.product.id}", "PUT", {**original,
            "semi_wholesale_price": 90, "packagings": [{"name": "Colis", "factor": 12,
            "price_detail": 1100, "price_gros": 900, "purchase_price": 500}]})
        packaging = original["packagings"][0]
        other = self.call("/api/products", "POST", {"name": "Deuxième", "sku": "REVIEW-2", "sale_price": 20}, 201)
        purchase = self.purchase([{"product_id": self.product.id, "quantity": 3, "unit_cost": 60},
            {"product_id": other["id"], "quantity": 2, "unit_cost": 10}])
        rows = self.call(f"/api/purchases/{purchase['id']}/price-review")
        self.assertEqual([row["id"] for row in rows], [self.product.id, other["id"]])
        self.assertEqual(rows[0]["prices"]["purchase_price"], 40)
        self.assertNotIn("quantity", rows[0])
        changes = [self.change(field, old, new) for field, old, new in (
            ("purchase_price", 40, 55), ("sale_price", 100, 125), ("wholesale_price", 80, 95),
            ("semi_wholesale_price", 90, 105), ("packaging_sale_price", 2000, 2200),
            ("wholesale_packaging_price", 1500, 1800), ("supplier_purchase_price", None, 50))]
        changes += [self.change(field, old, new, packaging_id=packaging["id"]) for field, old, new in (
            ("purchase_price", 500, 600), ("price_detail", 1100, 1200),
            ("price_semi_gros", None, 1000), ("price_gros", 900, None))]
        changes.append(self.change(old=20, new=25, product_id=other["id"]))
        result = self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"price_changes": changes})
        self.assertEqual(result["status"], "Reçu")
        self.assertEqual(result["items"][0]["unit_cost"], 60)
        self.assertEqual(self.stock(), 202)
        current = self.call(f"/api/products/{self.product.id}")
        self.assertEqual(current["purchase_price"], 55)
        self.assertEqual(current["packagings"][0]["price_detail"], 1200)
        self.assertIsNone(current["packagings"][0]["price_gros"])
        audit = [row for row in self.call(f"/api/products/{self.product.id}/price-history") if row["purchase_reference"] == purchase["reference"]]
        self.assertEqual(len(audit), 11)
        for row in audit:
            self.assertEqual(row["changed_by"]["id"], self.user.id)
            self.assertTrue(row["changed_at"])
        nullable = next(row for row in audit if row["field"] == f"packaging:{packaging['id']}:price_semi_gros")
        self.assertEqual((nullable["old_value"], nullable["new_value"]), (None, 1000))
        self.assertIsNone(next(row for row in audit if row["field"].endswith(":price_gros"))["new_value"])
        self.assertEqual(self.call(f"/api/sales/{sale['id']}")["items"], sale["items"])
        self.db.expire_all()
        self.assertEqual(stock.inconsistencies(self.db), [])

    def test_keep_is_default_partial_receipt_and_legacy_update_cost_is_audited(self):
        purchase = self.purchase()
        line = purchase["items"][0]["id"]
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"items": [{"item_id": line, "quantity": 1}]})
        self.assertEqual(self.call(f"/api/products/{self.product.id}")["purchase_price"], 40)
        self.assertEqual(self.db.query(PriceHistory).count(), 0)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"update_cost": True})
        self.assertEqual(self.stock(), 203)
        self.db.expire_all()
        audit = self.db.query(PriceHistory).one()
        self.assertEqual((audit.old_value, audit.new_value, audit.purchase_reference), (40, 60, purchase["reference"]))
        mixed = self.purchase([{"product_id": self.product.id, "quantity": 1, "unit_cost": 70},
            {"product_id": self.product.id, "quantity": 1, "unit_cost": 80}])
        self.call(f"/api/purchases/{mixed['id']}/receive", "POST", {"update_cost": True})
        self.assertEqual(self.call(f"/api/products/{self.product.id}")["purchase_price"], 80)
        self.db.expire_all()
        audit = self.db.query(PriceHistory).filter_by(purchase_reference=mixed["reference"]).one()
        self.assertEqual((audit.old_value, audit.new_value), (60, 80))

    def test_readonly_receiver_can_keep_prices_but_cannot_forge_changes(self):
        purchase = self.purchase()
        self.user.role = "vendeur"
        self.grant("approvisionnements_gerer", "prix_modifier")
        self.assertEqual(len(self.call(f"/api/purchases/{purchase['id']}/price-review")), 1)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"price_changes": [self.change()]}, 403)
        self.assertEqual(self.stock(), 200)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"update_cost": True,
            "items": [{"item_id": purchase["items"][0]["id"], "quantity": 1}]})
        self.assertEqual(self.stock(), 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.assertEqual(self.stock(), 203)
        self.db.expire_all()
        self.assertEqual(self.db.get(Product, self.product.id).purchase_price, 40)
        self.assertEqual(self.db.query(PriceHistory).count(), 0)

    def test_invalid_or_stale_changes_rollback_entire_receipt(self):
        purchase = self.purchase()
        for changes, status in (([self.change(), self.change("quantity", 200, 999)], 400),
            ([self.change(old=99)], 409), ([self.change(), self.change()], 400),
            ([self.change(packaging_id=999999)], 400), ([self.change(product_id=999999)], 400),
            ([self.change(new=-1)], 422), ([self.change(new="NaN")], 422),
            ([self.change(new=None)], 400)):
            with self.subTest(changes=changes):
                self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"price_changes": changes}, status)
                self.assertEqual(self.stock(), 200)
                self.db.expire_all()
                self.assertEqual(self.db.get(Product, self.product.id).sale_price, 100)
                self.assertEqual(self.db.query(PriceHistory).count(), 0)
                self.assertEqual(self.db.query(StockMovement).count(), 0)
                self.assertEqual(self.db.get(Purchase, purchase["id"]).items[0].received_quantity, 0)
                self.assertEqual(stock.inconsistencies(self.db), [])

    def test_empty_unknown_or_unreceived_lines_and_review_permissions(self):
        purchase = self.purchase()
        line = purchase["items"][0]["id"]
        for items in ([{"item_id": line, "quantity": 0}], [{"item_id": 999999, "quantity": 1}],
            [{"item_id": line, "quantity": 1}, {"item_id": line, "quantity": 1}]):
            self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {"items": items, "price_changes": [self.change()]}, 400)
        self.call("/api/purchases/999999/price-review", status=404)
        self.user.role = "vendeur"
        self.call(f"/api/purchases/{purchase['id']}/price-review", status=403)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {}, 403)
        self.assertEqual(self.stock(), 200)
