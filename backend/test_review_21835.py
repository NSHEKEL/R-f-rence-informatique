import json
import unittest

from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

import test_wholesale as wholesale
from app.models import CashMovement, CashSession, Notification, PriceHistory, Product, ProductPackaging, Sale, SaleReturn, SecurityLog


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

    def test_sale_delete_detaches_refund_movement_before_fk_cascade_once_and_preserves_z(self):
        def enforce_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
        event.listen(self.engine, "connect", enforce_foreign_keys)
        self.db.close()
        self.engine.dispose()
        self.assertEqual(self.db.execute(text("PRAGMA foreign_keys")).scalar(), 1)
        self.db.rollback()
        baseline = self.stock()
        for frozen in (False, True):
            sale = self.call("/api/sales", "POST", {"items": [{"product_id": self.product.id, "quantity": 2}]}, 201)
            refund = self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "refund_method": "Espèces",
                "lines": [{"product_id": self.product.id, "quantity": 1}]}, 201)
            movement = self.call("/api/cash-sessions/movements", "POST", {"type": "out", "amount": 100,
                "reason": "Remboursement documenté", "return_id": refund["id"]})
            if not frozen:
                self.db.query(Notification).filter_by(sale_id=sale["id"]).delete()
                with self.assertRaises(IntegrityError) as blocked:
                    self.db.delete(self.db.get(Sale, sale["id"]))
                    self.db.flush()
                self.assertIn("DELETE FROM sale_returns", blocked.exception.statement)
                self.db.rollback()
            before = self.call("/api/cash-sessions/current")
            snapshot = None
            if frozen:
                self.call("/api/cash-sessions/close", "POST", {"cash_session_id": self.call("/api/cash-sessions/current")["id"], "closing_balance": before["expected_cash"]})
                self.db.expire_all()
                snapshot = self.db.get(CashSession, before["id"]).z_report
            self.call(f"/api/sales/{sale['id']}", "DELETE", status=204)
            self.db.expire_all()
            kept = self.db.get(CashMovement, movement["id"])
            self.assertIsNone(kept.return_id)
            self.assertEqual((kept.amount, kept.reason, kept.session_id, kept.user_id),
                (100, "Remboursement documenté", before["id"], self.user.id))
            self.assertIsNone(self.db.get(SaleReturn, refund["id"]))
            self.assertEqual(self.stock(), baseline)
            self.assertEqual(self.db.execute(text("PRAGMA foreign_key_check")).all(), [])
            if frozen:
                self.assertEqual(self.db.get(CashSession, before["id"]).z_report, snapshot)
                self.assertEqual(self.call(f"/api/cash-sessions/{before['id']}/z")["expected_cash"], before["expected_cash"])
            else:
                self.assertEqual(self.call("/api/cash-sessions/current")["expected_cash"], before["expected_cash"] - sale["total"])
            self.call(f"/api/sales/{sale['id']}", "DELETE", status=404)
        logs = self.db.query(SecurityLog).filter_by(event="suppression_vente").all()
        self.assertEqual(len(logs), 2)
        self.assertTrue(all(json.loads(row.detail)["detached_refund_movements"][0]["amount"] == 100 for row in logs))


if __name__ == "__main__":
    unittest.main()
