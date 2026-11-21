import json
import sqlite3
import unittest
import zipfile
from contextlib import closing
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import test_wholesale as wholesale
from app import purchase_links
from app.accounting_ledger import derive, seed_accounts
from app.models import CompanySettings, Debt, DebtPayment, Purchase, SecurityLog, Supplier, utcnow
from app.receivables import open_purchase_payable
from app.routers import accounting_documents


class PurchaseLinksTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    open = wholesale.WholesaleTests.open
    stock = wholesale.WholesaleTests.stock

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        self.app.include_router(accounting_documents.router)
        self.db.add(CompanySettings(name="Test", vat_rate=0))
        self.supplier = Supplier(name="FVFD")
        self.db.add(self.supplier)
        self.db.commit()
        with self.engine.begin() as conn:
            seed_accounts(conn)
        folder = Path(self.temp.name)
        for target in (patch.object(purchase_links.backup, "engine", self.engine),
                       patch.object(purchase_links.backup, "backups_dir", return_value=folder),
                       patch.object(purchase_links.backup, "IS_SQLITE", True)):
            target.start()
            self.addCleanup(target.stop)

    def received(self, amount=1000000):
        row = self.call("/api/purchases", "POST", {"supplier_id": self.supplier.id,
            "items": [{"product_id": self.product.id, "quantity": 1, "unit_cost": amount}]}, 201)
        self.call(f"/api/purchases/{row['id']}/receive", "POST", {})
        self.db.expire_all()
        return self.db.get(Purchase, row["id"]), self.db.query(Debt).filter_by(purchase_id=row["id"]).one()

    def orphan(self, debt):
        debt.purchase_id = None
        debt.purchase = None
        self.db.commit()

    def snapshot_debt(self, snapshot, debt_id):
        with zipfile.ZipFile(snapshot) as archive:
            path = Path(self.temp.name) / "before.db"
            path.write_bytes(archive.read("easygest.db"))
        with closing(sqlite3.connect(path)) as conn:
            return conn.execute("SELECT purchase_id FROM debts WHERE id=?", (debt_id,)).fetchone()[0]

    def test_creation_origin_manual_explicit_duplicate_and_legacy_guard(self):
        purchase, debt = self.received()
        listed = self.call("/api/debts?kind=dette")
        self.assertEqual((listed[0]["purchase_id"], listed[0]["purchase_reference"]), (purchase.id, purchase.reference))
        open_purchase_payable(self.db, purchase, self.user)
        self.db.commit()
        self.assertEqual(self.db.query(Debt).count(), 1)
        self.call(f"/api/debts/{debt.id}", "DELETE", status=409)
        self.orphan(debt)
        with self.assertRaises(purchase_links.HTTPException) as caught:
            open_purchase_payable(self.db, purchase, self.user)
        self.assertEqual(caught.exception.status_code, 409)
        self.db.rollback()
        self.assertEqual(self.db.query(Debt).count(), 1)
        self.db.delete(debt)
        self.db.commit()
        payload = {"kind": "dette", "supplier_id": self.supplier.id, "reference": purchase.reference,
            "amount": purchase.balance, "purchase_id": purchase.id}
        created = self.call("/api/debts", "POST", payload, 201)
        self.assertEqual(created["purchase_id"], purchase.id)
        self.call("/api/debts", "POST", payload, 409)
        self.db.expire_all()
        self.db.delete(self.db.get(Debt, created["id"]))
        self.db.commit()
        del payload["purchase_id"]
        automatic = self.call("/api/debts", "POST", payload, 201)
        self.assertEqual(automatic["purchase_id"], purchase.id)
        self.call("/api/debts", "POST", payload, 409)

    def test_auto_app_2026_0001_backup_audit_idempotence_and_accounting(self):
        purchase, debt = self.received()
        purchase.reference = "APP-2026-0001"
        debt.reference = "Ancienne dette"
        debt.note = "Reste à payer sur l'approvisionnement APP-2026-0001"
        payment = DebtPayment(debt_id=debt.id, amount=100, method="Espèces", receipt_reference="RP-TEST", created_by_id=self.user.id)
        self.db.add(payment)
        self.orphan(debt)
        result = purchase_links.repair(self.db)
        self.assertEqual(result, {"linked": [debt.id], "orphans": []})
        log = self.db.query(SecurityLog).filter_by(event="comptabilite_liaison").one()
        detail = json.loads(log.detail)
        self.assertEqual(detail["mode"], "automatique")
        self.assertIsNone(self.snapshot_debt(Path(self.temp.name) / detail["backup"], debt.id))
        self.assertEqual((debt.amount, debt.reference, debt.purchase_reference, debt.payments[0].receipt_reference),
            (1000000, "Ancienne dette", "APP-2026-0001", "RP-TEST"))
        entries, missing, _ = derive(self.db)
        self.assertTrue(any(row["source_type"] == "settlement" and row["source_id"] == payment.id for row in entries))
        self.assertFalse(any(row["source_type"] in ("debt", "settlement") for row in missing))
        with patch.object(purchase_links.backup, "create") as backup:
            self.assertEqual(purchase_links.repair(self.db), {"linked": [], "orphans": []})
            backup.assert_not_called()
        self.assertEqual(self.db.query(SecurityLog).filter_by(event="comptabilite_liaison").count(), 1)

    def test_ambiguity_reference_boundaries_date_supplier_amount_and_empty(self):
        first, debt = self.received()
        self.orphan(debt)
        twin = Debt(kind="dette", party=debt.party, supplier_id=debt.supplier_id, amount=debt.amount,
                    reference=debt.reference, created_at=debt.created_at)
        self.db.add(twin)
        self.db.commit()
        with patch.object(purchase_links.backup, "create") as backup:
            result = purchase_links.repair(self.db)
            self.assertEqual(set(result["orphans"]), {debt.id, twin.id})
            backup.assert_not_called()
        self.db.delete(twin)
        debt.note = ""
        self.db.commit()
        original = (debt.amount, debt.supplier_id, debt.created_at, debt.reference, debt.note)
        for field, value in (("amount", debt.amount + 1), ("supplier_id", None),
            ("created_at", debt.created_at - timedelta(days=8)), ("reference", first.reference + "0")):
            setattr(debt, field, value)
            self.db.commit()
            self.assertFalse(purchase_links.automatic_pairs(self.db), field)
            debt.amount, debt.supplier_id, debt.created_at, debt.reference, debt.note = original
            self.db.commit()
        second, second_debt = self.received()
        self.orphan(second_debt)
        self.db.delete(second_debt)
        debt.note = second.reference
        self.db.commit()
        self.assertFalse(purchase_links.automatic_pairs(self.db))
        debt.note = ""
        self.db.commit()
        self.assertEqual(purchase_links.automatic_pairs(self.db), [(debt.id, first.id)])

    def test_manual_choices_confirmation_permission_backup_failure_and_no_overwrite(self):
        purchase, debt = self.received()
        self.orphan(debt)
        debt.created_at -= timedelta(days=30)
        debt.supplier_id = None
        self.db.commit()
        self.assertFalse(purchase_links.automatic_pairs(self.db))
        choices = self.call(f"/api/debts/{debt.id}/purchase-candidates")
        self.assertEqual([row["id"] for row in choices], [purchase.id])
        self.assertFalse(choices[0]["reliable"])
        endpoint = f"/api/debts/{debt.id}/purchase"
        self.call(endpoint, "PUT", {"purchase_id": purchase.id}, 400)
        self.user.role = "vendeur"
        self.db.commit()
        self.call(endpoint, "PUT", {"purchase_id": purchase.id, "confirm": True}, 403)
        self.user.role = "admin"
        self.db.commit()
        with patch.object(purchase_links.backup, "create", side_effect=OSError("unwritable")):
            self.call(endpoint, "PUT", {"purchase_id": purchase.id, "confirm": True}, 503)
        self.db.expire_all()
        self.assertIsNone(debt.purchase_id)
        linked = self.call(endpoint, "PUT", {"purchase_id": purchase.id, "confirm": True})
        self.assertEqual(linked["purchase_reference"], purchase.reference)
        self.call(endpoint, "PUT", {"purchase_id": purchase.id, "confirm": True}, 409)
        self.assertEqual(self.call("/api/debts?orphan=true&kind=dette"), [])
        self.db.expire_all()
        detail = json.loads(self.db.query(SecurityLog).filter_by(event="comptabilite_liaison").one().detail)
        self.assertEqual((detail["mode"], self.user.id), ("manuel", self.user.id))
        self.assertIsNone(self.snapshot_debt(Path(self.temp.name) / detail["backup"], debt.id))

    def test_auto_backup_failure_and_manual_mismatch_do_not_change_sources(self):
        purchase, debt = self.received()
        self.orphan(debt)
        with patch.object(purchase_links.backup, "create", side_effect=OSError("unwritable")):
            with self.assertRaises(OSError):
                purchase_links.repair(self.db)
        self.assertIsNone(debt.purchase_id)
        debt.amount += 1
        self.db.commit()
        self.call(f"/api/debts/{debt.id}/purchase", "PUT", {"purchase_id": purchase.id, "confirm": True}, 400)
        self.assertEqual(self.call(f"/api/debts/{debt.id}/purchase-candidates"), [])
        self.assertEqual(self.db.query(SecurityLog).filter_by(event="comptabilite_liaison").count(), 0)

    def test_linked_deletion_archives_sources_other_supplier_and_all_payments_preserved(self):
        purchase, debt = self.received()
        foreign = Debt(kind="dette", party="Autre fournisseur", reference=purchase.reference, amount=1000000)
        self.db.add(foreign)
        self.db.commit()
        baseline = self.stock()
        self.call(f"/api/purchases/{purchase.id}", "DELETE", status=204)
        self.db.expire_all()
        log = json.loads(self.db.query(SecurityLog).filter_by(event="suppression_approvisionnement").one().detail)
        self.assertEqual(log["sources"]["purchase"]["total"], 1000000)
        self.assertEqual(log["accounting_snapshot"][0]["source_type"], "purchase")
        self.assertIsNotNone(self.db.get(Debt, foreign.id))
        self.assertEqual(self.stock(), baseline - 1)
        purchase, debt = self.received()
        payment = DebtPayment(debt_id=debt.id, amount=10, method="Espèces", receipt_reference="RP-KEEP",
            created_by_id=self.user.id, cancelled=True, cancelled_by_id=self.user.id,
            cancel_reason="Erreur documentée", cancelled_at=utcnow())
        self.db.add(payment)
        self.db.commit()
        before = self.stock()
        self.call(f"/api/purchases/{purchase.id}", "DELETE", status=409)
        self.db.expire_all()
        saved = self.db.get(DebtPayment, payment.id)
        self.assertEqual((saved.receipt_reference, saved.cancel_reason, saved.cancelled_by_id), ("RP-KEEP", "Erreur documentée", self.user.id))
        self.assertIsNotNone(self.db.get(Purchase, purchase.id))
        self.assertEqual(self.stock(), before)


if __name__ == "__main__":
    unittest.main()
