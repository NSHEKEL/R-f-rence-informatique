import json
import unittest

import test_wholesale as wholesale
from app.models import PriceHistory, Product, ProductPackaging, SecurityLog


class Review21835Tests(unittest.TestCase):
    setUp = wholesale.WholesaleTests.setUp
    call = wholesale.WholesaleTests.call
    open = wholesale.WholesaleTests.open
    stock = wholesale.WholesaleTests.stock

    def purchase(self, cost, changes=None):
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Grossiste",
            "items": [{"product_id": self.product.id, "quantity": 2, "unit_cost": cost}]}, 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST",
            {"price_changes": changes} if changes else {"update_cost": True})
        return purchase

    def test_deleted_purchase_price_chain_product_packaging_nullable_and_audit(self):
        packaging = ProductPackaging(product_id=self.product.id, name="Colis", factor=12, purchase_price=500)
        other = Product(name="Autre", sku="CHAIN-OTHER", purchase_price=999, quantity=10)
        self.db.add_all([packaging, other])
        self.db.commit()
        def changes(old, new, supplier_old, supplier_new, pack_old, pack_new, nullable_old, nullable_new):
            return [{"product_id": self.product.id, "field": field, "old_value": before, "new_value": after,
                     "packaging_id": pack_id} for field, before, after, pack_id in (
                ("purchase_price", old, new, None), ("supplier_purchase_price", supplier_old, supplier_new, None),
                ("purchase_price", pack_old, pack_new, packaging.id), ("price_semi_gros", nullable_old, nullable_new, packaging.id))]
        first = self.purchase(60, changes(40, 60, None, 50, 500, 600, None, 1000))
        second = self.purchase(80, changes(60, 80, 50, 70, 600, 700, 1000, 1200))
        self.call(f"/api/purchases/{first['id']}", "DELETE", status=204)
        self.db.expire_all()
        product, pack = self.db.get(Product, self.product.id), self.db.get(ProductPackaging, packaging.id)
        self.assertEqual((product.purchase_price, product.supplier_purchase_price, pack.purchase_price, pack.price_semi_gros), (80, 70, 700, 1200))
        surviving = {row.field: row for row in self.db.query(PriceHistory).filter_by(purchase_reference=second["reference"])}
        self.assertEqual([surviving[field].old_value for field in ("purchase_price", "supplier_purchase_price", f"packaging:{pack.id}:purchase_price", f"packaging:{pack.id}:price_semi_gros")], [40, None, 500, None])
        trace = json.loads(self.db.query(SecurityLog).filter_by(event="suppression_approvisionnement").one().detail)
        self.assertEqual((len(trace["price_history"]["removed"]), len(trace["price_history"]["successors"])), (4, 4))
        self.call(f"/api/purchases/{second['id']}", "DELETE", status=204)
        self.db.expire_all()
        product, pack = self.db.get(Product, self.product.id), self.db.get(ProductPackaging, packaging.id)
        self.assertEqual((product.purchase_price, product.supplier_purchase_price, pack.purchase_price, pack.price_semi_gros), (40, None, 500, None))
        self.assertEqual(self.db.get(Product, other.id).purchase_price, 999)
        self.assertEqual(self.db.query(PriceHistory).count(), 0)

    def test_price_reversal_preserves_discontinuous_history_and_manual_override(self):
        first = self.purchase(100)
        self.db.expire_all()
        self.db.get(Product, self.product.id).purchase_price = 150
        self.db.commit()
        second = self.purchase(200)
        self.call(f"/api/purchases/{first['id']}", "DELETE", status=204)
        self.db.expire_all()
        self.assertEqual(self.db.query(PriceHistory).filter_by(purchase_reference=second["reference"]).one().old_value, 150)
        self.call(f"/api/purchases/{second['id']}", "DELETE", status=204)
        self.db.expire_all()
        self.assertEqual(self.db.get(Product, self.product.id).purchase_price, 150)
        third = self.purchase(250)
        self.db.expire_all()
        self.db.get(Product, self.product.id).purchase_price = 375
        self.db.commit()
        self.call(f"/api/purchases/{third['id']}", "DELETE", status=204)
        self.db.expire_all()
        self.assertEqual(self.db.get(Product, self.product.id).purchase_price, 375)


if __name__ == "__main__":
    unittest.main()
