import json
import unittest

from sqlalchemy import event, text
from sqlalchemy.exc import IntegrityError

import test_purchase_links as links
from app import purchase_links
from app.models import Debt, DebtPayment, Product, Purchase, SecurityLog, Supplier, utcnow
from app.routers import suppliers


class SupplierOriginsTests(unittest.TestCase):
    call = links.PurchaseLinksTests.call
    open = links.PurchaseLinksTests.open
    stock = links.PurchaseLinksTests.stock
    received = links.PurchaseLinksTests.received
    orphan = links.PurchaseLinksTests.orphan

    def setUp(self):
        links.PurchaseLinksTests.setUp(self)
        self.app.include_router(suppliers.router)
        self.product.supplier_id = self.supplier.id
        self.db.commit()

    def test_supplier_delete_strict_fk_preserves_purchase_orphan_debt_and_payments(self):
        event.listen(self.engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
        self.db.close()
        self.engine.dispose()
        self.assertEqual(self.db.execute(text("PRAGMA foreign_keys")).scalar(), 1)
        self.db.rollback()
        purchase, debt = self.received()
        self.orphan(debt)
        active = DebtPayment(debt_id=debt.id, amount=100, method="Espèces", receipt_reference="RP-ACTIVE", created_by_id=self.user.id)
        cancelled = DebtPayment(debt_id=debt.id, amount=50, method="Espèces", receipt_reference="RP-CANCELLED",
            created_by_id=self.user.id, cancelled=True, cancel_reason="Erreur documentée", cancelled_by_id=self.user.id, cancelled_at=utcnow())
        self.db.add_all([active, cancelled])
        self.db.commit()
        with self.assertRaises(IntegrityError) as blocked:
            self.db.delete(self.db.get(Supplier, self.supplier.id))
            self.db.flush()
        self.assertIn("DELETE FROM suppliers", blocked.exception.statement)
        self.db.rollback()
        supplier_id = self.supplier.id
        self.call(f"/api/suppliers/{supplier_id}", "DELETE", status=204)
        self.db.expire_all()
        self.assertIsNone(self.db.get(Supplier, supplier_id))
        self.assertIsNone(self.db.get(Product, self.product.id).supplier_id)
        saved = self.call(f"/api/purchases/{purchase.id}")
        self.assertEqual((saved["supplier_id"], saved["supplier_name"], saved["total"], saved["status"]), (None, "FVFD", 1000000, "Reçu"))
        listed = self.call("/api/debts?kind=dette&orphan=true")
        self.assertEqual((listed[0]["id"], listed[0]["supplier_id"], listed[0]["party"]), (debt.id, None, "FVFD"))
        self.assertEqual([row["receipt_reference"] for row in listed[0]["payments"]], ["RP-ACTIVE", "RP-CANCELLED"])
        self.assertEqual(purchase_links.repair(self.db)["linked"], [debt.id])
        self.call(f"/api/purchases/{purchase.id}", "DELETE", status=409)
        self.call(f"/api/debts/{debt.id}", "DELETE", status=400)
        self.db.expire_all()
        self.assertEqual(self.db.get(DebtPayment, cancelled.id).cancel_reason, "Erreur documentée")
        self.assertEqual(self.db.get(DebtPayment, active.id).amount, 100)
        self.assertEqual(self.db.execute(text("PRAGMA foreign_key_check")).all(), [])
        audit = json.loads(self.db.query(SecurityLog).filter_by(event="suppression_fournisseur").one().detail)
        self.assertEqual((audit["supplier"]["name"], audit["purchases"], audit["debts"], len(audit["payments"])), ("FVFD", [purchase.id], [debt.id], 2))
        self.call(f"/api/suppliers/{supplier_id}", "DELETE", status=404)
        empty = self.call("/api/suppliers", "POST", {"name": "Sans document"}, 201)
        self.call(f"/api/suppliers/{empty['id']}", "DELETE", status=204)
        self.user.role = "vendeur"
        self.db.commit()
        self.call(f"/api/suppliers/{supplier_id}", "DELETE", status=403)

    def test_legacy_deleted_supplier_dangling_ids_are_visible_repairable_and_unpaid_deletable(self):
        purchase, debt = self.received()
        purchase_id, debt_id = purchase.id, debt.id
        self.orphan(debt)
        loose = Debt(kind="dette", supplier_id=self.supplier.id, party="FVFD", reference="Engagement libre", amount=50)
        self.db.add(loose)
        self.db.get(Product, self.product.id).supplier_id = None
        self.db.commit()
        supplier_id = self.supplier.id
        self.assertEqual(self.db.execute(text("PRAGMA foreign_keys")).scalar(), 0)
        self.db.execute(text("DELETE FROM suppliers WHERE id=:id"), {"id": supplier_id})
        self.db.commit()
        self.db.expire_all()
        listed = self.call("/api/debts?kind=dette&orphan=true")
        original = next(row for row in listed if row["id"] == debt.id)
        self.assertEqual((original["supplier"], original["supplier_id"], original["party"]), (None, supplier_id, "FVFD"))
        self.assertTrue(self.call(f"/api/debts/{debt.id}/purchase-candidates"))
        result = purchase_links.repair(self.db)
        self.assertEqual(result, {"linked": [debt.id], "orphans": [loose.id]})
        self.call(f"/api/debts/{loose.id}", "DELETE", status=204)
        self.call(f"/api/purchases/{purchase.id}", "DELETE", status=204)
        self.db.expire_all()
        self.assertIsNone(self.db.get(Purchase, purchase_id))
        self.assertIsNone(self.db.get(Debt, debt_id))
        self.assertEqual(self.db.query(DebtPayment).count(), 0)
        self.assertEqual(self.stock(), 200)

    def test_direct_delete_includes_unique_orphan_without_supplier_or_prior_reconciliation(self):
        for legacy in (False, True):
            if legacy:
                self.supplier = Supplier(name="FVFD")
                self.db.add(self.supplier)
                self.db.commit()
            purchase, debt = self.received()
            purchase_id, debt_id, supplier_id = purchase.id, debt.id, self.supplier.id
            self.orphan(debt)
            foreign = Debt(kind="dette", party="Autre", reference=purchase.reference, amount=1000000)
            self.db.add(foreign)
            self.db.commit()
            foreign_id = foreign.id
            self.call(f"/api/suppliers/{supplier_id}", "DELETE", status=204)
            self.db.expire_all()
            if legacy:
                self.db.get(Purchase, purchase_id).supplier_id = supplier_id
                self.db.get(Debt, debt_id).supplier_id = supplier_id
                self.db.commit()
            self.call(f"/api/purchases/{purchase_id}", "DELETE", status=204)
            self.db.expire_all()
            self.assertIsNone(self.db.get(Purchase, purchase_id))
            self.assertIsNone(self.db.get(Debt, debt_id))
            self.assertIsNotNone(self.db.get(Debt, foreign_id))
            self.assertEqual(self.stock(), 200)
            audit = json.loads(self.db.query(SecurityLog).filter_by(event="suppression_approvisionnement").order_by(SecurityLog.id.desc()).first().detail)
            self.assertEqual(audit["deleted_orphan_debts"], [debt_id])
            self.assertIsNone(audit["sources"]["debts"][0]["purchase_id"])

    def test_missing_supplier_does_not_bypass_ambiguity_or_payment_preservation(self):
        purchase, debt = self.received()
        purchase_id, debt_id = purchase.id, debt.id
        self.orphan(debt)
        duplicate = Debt(kind="dette", supplier_id=self.supplier.id, party="FVFD", reference=purchase.reference, amount=1000000)
        self.db.add(duplicate)
        self.db.commit()
        duplicate_id = duplicate.id
        self.call(f"/api/suppliers/{self.supplier.id}", "DELETE", status=204)
        self.call(f"/api/purchases/{purchase_id}", "DELETE", status=409)
        self.call(f"/api/debts/{duplicate_id}", "DELETE", status=204)
        payment = DebtPayment(debt_id=debt_id, amount=50, cancelled=True, cancel_reason="Historique", receipt_reference="RP-KEEP", created_by_id=self.user.id)
        self.db.add(payment)
        self.db.commit()
        payment_id = payment.id
        self.call(f"/api/purchases/{purchase_id}", "DELETE", status=409)
        self.db.expire_all()
        self.assertEqual(self.db.get(DebtPayment, payment_id).receipt_reference, "RP-KEEP")
        self.assertIsNotNone(self.db.get(Purchase, purchase_id))
        self.assertEqual(self.stock(), 201)

    def test_cancelled_purchase_deletion_handles_own_debt_and_preserves_cancelled_receipts(self):
        for deleted_supplier, payment_state in ((False, None), (True, None), (True, "cancelled"), (True, "active")):
            with self.subTest(deleted_supplier=deleted_supplier, payment_state=payment_state):
                self.supplier = Supplier(name="FVFD")
                self.db.add(self.supplier)
                self.db.commit()
                purchase = self.call("/api/purchases", "POST", {"supplier_id": self.supplier.id,
                    "items": [{"product_id": self.product.id, "quantity": 1, "unit_cost": 100}]}, 201)
                debt = self.call("/api/debts", "POST", {"kind": "dette", "supplier_id": self.supplier.id,
                    "reference": purchase["reference"], "amount": 100, "purchase_id": purchase["id"]}, 201)
                self.call(f"/api/purchases/{purchase['id']}/cancel", "POST")
                if deleted_supplier:
                    self.call(f"/api/suppliers/{self.supplier.id}", "DELETE", status=204)
                payment_id = None
                if payment_state:
                    self.db.expire_all()
                    self.db.get(Debt, debt["id"]).purchase_id = purchase["id"]
                    payment = DebtPayment(debt_id=debt["id"], amount=20, cancelled=payment_state == "cancelled",
                        receipt_reference="RP-CANCELLED-ORIGIN", cancel_reason="Motif conservé", created_by_id=self.user.id)
                    self.db.add(payment)
                    self.db.commit()
                    payment_id = payment.id
                self.call(f"/api/purchases/{purchase['id']}", "DELETE", status=409 if payment_state == "active" else 204)
                self.db.expire_all()
                if payment_state == "active":
                    self.assertIsNotNone(self.db.get(Purchase, purchase["id"]))
                else:
                    self.assertIsNone(self.db.get(Purchase, purchase["id"]))
                    kept = self.db.get(Debt, debt["id"])
                    if payment_state:
                        self.assertIsNone(kept.purchase_id)
                        payment = self.db.get(DebtPayment, payment_id)
                        self.assertEqual((payment.receipt_reference, payment.cancel_reason, payment.created_by_id),
                            ("RP-CANCELLED-ORIGIN", "Motif conservé", self.user.id))
                    else:
                        self.assertIsNone(kept)
                self.assertEqual(self.stock(), 200)


if __name__ == "__main__":
    unittest.main()
