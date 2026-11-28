import unittest
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.models import CashSession, Debt, DebtPayment, Expense, Sale, SalePayment, SaleReturn
from app.payment_totals import UNKNOWN_PAYMENT, group_payments
import test_cash_register as fixtures


class LegacyTillRowsTests(unittest.TestCase):
    setUpFixture = fixtures.CashRegisterTests.setUp
    call = fixtures.CashRegisterTests.call
    grant = fixtures.CashRegisterTests.grant

    def setUp(self):
        self.setUpFixture()
        self.user.name = "HAWA"
        self.user.role = "admin"
        self.db.commit()
        self.opened = self.call("/api/cash-sessions/open", "POST", {"opening_balance":170000}, status=201)
        self.client = TestClient(self.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)

    def recap(self):
        rows = []
        for path in ("current", "today"):
            response = self.client.get("/api/cash-sessions/" + path)
            self.assertEqual(response.status_code, 200, response.text)
            row = response.json()
            self.assertEqual(row["id"], self.opened["id"])
            self.assertEqual(row["opening_balance"], 170000)
            rows.append(row)
        return rows[0]

    def sale(self):
        row = Sale(reference="LEGACY-NULL", cash_session_id=self.opened["id"], total=100, payment_method="Espèces")
        self.db.add(row)
        self.db.flush()
        return row

    def test_missing_sale_payment_method_is_explicit_other_not_invented_cash(self):
        sale = self.sale()
        known = SalePayment(sale_id=sale.id, method="Espèces", amount=40)
        unknown = SalePayment(sale_id=sale.id, method="Espèces", amount=60)
        self.db.add_all([known, unknown])
        self.db.commit()
        for value in (None, ""):
            with self.subTest(method=value):
                self.db.execute(text("UPDATE sale_payments SET method=:method WHERE id=:id"), {"method":value, "id":unknown.id})
                self.db.commit()
                result = self.recap()
                self.assertEqual(result["payments"], {"Espèces":40,UNKNOWN_PAYMENT:60})
                self.assertEqual((result["total_sales"],result["cash_sales"],result["other_sales"],result["expected_cash"]), (100,40,60,170040))
                self.assertTrue(result["data_warnings"])
                self.assertEqual(self.db.execute(text("SELECT method FROM sale_payments WHERE id=:id"), {"id":unknown.id}).scalar(), value)

    def test_null_refund_method_and_amount_never_crash_or_become_cash(self):
        sale = self.sale()
        refund = SaleReturn(reference="LEGACY-RETURN", sale_id=sale.id, cash_session_id=self.opened["id"], total=10)
        self.db.add(refund)
        self.db.flush()
        self.db.execute(text("UPDATE sale_returns SET refund_method=NULL WHERE id=:id"), {"id":refund.id})
        self.db.commit()
        result = self.recap()
        self.assertEqual((result["expected_cash"],result["refunds_total"],result["cash_refunds"],result["net_sales"]), (170100,10,0,90))
        self.assertTrue(any("Retour #" in warning for warning in result["data_warnings"]))
        self.db.execute(text("UPDATE sale_returns SET total=NULL WHERE id=:id"), {"id":refund.id})
        self.db.commit()
        self.assertTrue(any("montant absent" in warning for warning in self.recap()["data_warnings"]))

    def test_deleted_parent_payment_is_preserved_unknown_not_silently_income(self):
        debt = Debt(kind="dette", party="Fournisseur", amount=20)
        self.db.add(debt)
        self.db.flush()
        payment = DebtPayment(debt_id=debt.id, amount=20, created_by_id=self.user.id, cash_session_id=None)
        self.db.add(payment)
        self.db.flush()
        debt_id, payment_id = debt.id, payment.id
        self.db.execute(text("DELETE FROM debts WHERE id=:id"), {"id":debt_id})
        self.db.commit()
        self.db.expire_all()
        for session_id in (None,self.opened["id"]):
            self.db.execute(text("UPDATE debt_payments SET cash_session_id=:sid WHERE id=:id"), {"sid":session_id,"id":payment_id})
            self.db.commit()
            result = self.recap()
            self.assertEqual((result["cash_settlements"],result["expected_cash"]), (0,170000))
            self.assertTrue(any(f"Règlement #{payment_id}" in warning and "sens inconnu" in warning for warning in result["data_warnings"]))
        original = self.db.get(DebtPayment, payment_id)
        self.assertEqual((original.debt_id,original.amount), (debt_id,20))
        self.assertIsNone(original.debt)
        print("ORPHAN_TILL_RECAP_OK current=200 today=200 same_till=True float=170000 original_kept=True unknown_not_cash=True")

    def test_supplier_settlement_keeps_historical_negative_sign_and_scoping(self):
        for kind, amount in (("dette",20),("creance",30)):
            debt = Debt(kind=kind, party="Test", amount=amount)
            self.db.add(debt)
            self.db.flush()
            self.db.add(DebtPayment(debt_id=debt.id, amount=amount, method="Espèces", cash_session_id=None, created_by_id=self.user.id))
        self.db.add(DebtPayment(debt_id=987654, amount=999, created_by_id=self.user.id, date=datetime(1980,1,1)))
        self.db.add(DebtPayment(debt_id=987654, amount=999, created_by_id=self.other.id))
        self.db.commit()
        result = self.recap()
        self.assertEqual((result["cash_settlements"],result["expected_cash"]), (10,170010))
        self.assertEqual(result["data_warnings"], [])

    def test_nullable_metadata_and_optional_expense_fields_are_read_only(self):
        self.db.execute(text("UPDATE cash_sessions SET note=NULL,business_day=NULL WHERE id=:id"), {"id":self.opened["id"]})
        self.db.add(Expense(label="Charge", category=None, payment_method=None, amount=10, created_by_id=self.user.id, date=datetime.now(timezone.utc)))
        self.db.flush()
        self.db.execute(text("UPDATE expenses SET category=NULL"))
        self.db.commit()
        result = self.recap()
        self.assertEqual((result["note"],result["business_day"],result["expected_cash"],result["expenses_total"],result["cash_expenses"]), ("","",170000,10,0))
        self.assertIsNone(self.db.execute(text("SELECT note FROM cash_sessions")).scalar())

    def test_missing_opening_bounds_are_actionable_not_guessed(self):
        for field in ("opening_balance","opened_at"):
            self.db.execute(text(f"UPDATE cash_sessions SET {field}=NULL WHERE id=:id"), {"id":self.opened["id"]})
            self.db.commit()
            for path in ("current","today"):
                response = self.client.get("/api/cash-sessions/"+path)
                self.assertEqual(response.status_code, 409, response.text)
                self.assertIn("absent", response.json()["detail"])
            self.assertEqual(self.db.query(CashSession).count(), 1)

    def test_valid_payment_groups_unchanged_and_null_is_other(self):
        self.assertEqual(group_payments({"Espèces":3,"Mobile Money":4,"Carte":5,"Crédit":6,"Autre":7}), {"cash":3,"mobile_money":4,"bank":5,"credit":6,"other":7})
        self.assertEqual(group_payments({None:10,"":2})["other"], 12)
        self.assertEqual(self.recap()["data_warnings"], [])
