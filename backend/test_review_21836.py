import unittest

import test_purchase_links as links
from app.accounting_ledger import derive
from app.models import Debt, DebtPayment, Purchase, SecurityLog


class Review21836Tests(unittest.TestCase):
    setUp = links.PurchaseLinksTests.setUp
    call = links.PurchaseLinksTests.call
    open = links.PurchaseLinksTests.open
    stock = links.PurchaseLinksTests.stock

    def pending(self):
        purchase = self.call("/api/purchases", "POST", {"supplier_id": self.supplier.id,
            "items": [{"product_id": self.product.id, "quantity": 1, "unit_cost": 100}]}, 201)
        debt = self.call("/api/debts", "POST", {"kind": "dette", "supplier_id": self.supplier.id,
            "reference": purchase["reference"], "amount": 100, "purchase_id": purchase["id"]}, 201)
        return purchase, debt

    def test_cancel_reconciled_pending_purchase_releases_unpaid_debt_and_preserves_paid_origin(self):
        purchase, debt = self.pending()
        cancelled = self.call(f"/api/purchases/{purchase['id']}/cancel", "POST")
        self.assertEqual(cancelled["status"], "Annulé")
        free = self.call(f"/api/debts/{debt['id']}", "PUT", {"kind": "dette", "amount": 100, "party": "FVFD", "note": "À examiner"})
        self.assertIsNone(free["purchase_id"])
        self.call(f"/api/debts/{debt['id']}", "DELETE", status=204)
        self.assertEqual(self.db.query(SecurityLog).filter_by(event="annulation_approvisionnement").count(), 1)
        for cancelled_payment in (False, True):
            purchase, debt = self.pending()
            payment = DebtPayment(debt_id=debt["id"], amount=20, method="Espèces", cancelled=cancelled_payment,
                receipt_reference="REG-CANCEL-GUARD", created_by_id=self.user.id, cancel_reason="Conserver")
            self.db.add(payment)
            self.db.commit()
            payment_id = payment.id
            self.call(f"/api/purchases/{purchase['id']}/cancel", "POST", status=409)
            self.db.expire_all()
            self.assertEqual(self.db.get(Purchase, purchase["id"]).status, "En attente")
            self.assertEqual(self.db.get(Debt, debt["id"]).purchase_id, purchase["id"])
            self.assertEqual(self.db.get(DebtPayment, payment_id).receipt_reference, "REG-CANCEL-GUARD")
            self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
            self.db.expire_all()
            posted, missing, _ = derive(self.db)
            self.assertFalse(any(row["source_type"] == "settlement" and row["source_id"] == payment_id for row in missing))
            if not cancelled_payment:
                self.assertTrue(any(row["source_type"] == "settlement" and row["source_id"] == payment_id for row in posted))


if __name__ == "__main__":
    unittest.main()
