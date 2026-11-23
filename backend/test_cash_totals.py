import unittest
from datetime import datetime, timedelta, timezone

import test_cash_register as fixtures
from app.models import CashMovement, Expense


class CashTotalsTests(unittest.TestCase):
    setUp = fixtures.CashRegisterTests.setUp
    call = fixtures.CashRegisterTests.call
    grant = fixtures.CashRegisterTests.grant

    def prepare(self):
        self.grant("tresorerie_consulter", "soldes_consulter", "caisse_z", "caisse_operations", "retours", "depenses_gerer")
        session = self.call("/api/cash-sessions/open", "POST", {"opening_balance": 0}, status=201)
        self.product.sale_price = 15000
        self.db.commit()
        sale = self.call("/api/sales", "POST", {
            "client_id": "wave-one", "items": [{"product_id": self.product.id, "quantity": 10}],
            "paid_amount": 150000, "payment_method": "Espèces",
        }, status=201)
        self.refund(sale, "Espèces")
        expense = self.call("/api/accounting/expenses", "POST", {
            "label": "Transport entrepôt", "amount": 10000, "payment_method": "Espèces",
            "category": "Transport", "note": "Fret livré",
        }, status=201)
        return session, sale, expense

    def refund(self, sale, method):
        return self.call("/api/returns", "POST", {
            "sale_reference": sale["reference"], "refund_method": method,
            "lines": [{"product_id": self.product.id, "quantity": 1}],
        }, status=201)

    def test_example_and_expense_metadata_then_frozen_closure(self):
        session, _, expense = self.prepare()
        current = self.call("/api/cash-sessions/current")
        z = self.call(f"/api/cash-sessions/{session['id']}/z")
        for report in (current, z):
            self.assertEqual(report["total_sales"], 150000)
            self.assertEqual(report["refunds_total"], 15000)
            self.assertEqual(report["net_sales"], 135000)
            self.assertEqual(report["cash_expenses"], 10000)
            self.assertEqual(report["expected_cash"], 125000)
            self.assertEqual(report["expenses"][0]["label"], "Transport entrepôt")
            self.assertEqual(report["expenses"][0]["note"], "Fret livré")
            self.assertEqual(report["expenses"][0]["user"], self.user.name)
            self.assertTrue(report["expenses"][0]["date"])
        closed = self.call("/api/cash-sessions/close", "POST", {"cash_session_id": self.call("/api/cash-sessions/current")["id"], "closing_balance": 125000})
        self.assertEqual(closed["difference"], 0)
        self.db.get(Expense, expense["id"]).amount = 99999
        self.db.commit()
        self.assertEqual(self.call(f"/api/cash-sessions/{session['id']}/z")["expected_cash"], 125000)

    def test_non_cash_refund_and_expenses_cash_movements_and_scope(self):
        session, sale, _ = self.prepare()
        self.refund(sale, "Avoir")
        self.call("/api/sales", "POST", {
            "client_id": "wave-one-non-cash", "items": [{"product_id": self.product.id, "quantity": 1}],
            "paid_amount": 15000, "payment_method": "Mobile Money",
        }, status=201)
        now = datetime.now(timezone.utc)
        self.db.add_all([
            Expense(label="Carte", amount=1200, payment_method="Carte bancaire", created_by_id=self.user.id),
            Expense(label="Mode inconnu", amount=700, created_by_id=self.user.id),
            Expense(label="Autre caissier", amount=9000, payment_method="Espèces", created_by_id=self.other.id),
            Expense(label="Hier", amount=8000, payment_method="Espèces", created_by_id=self.user.id, date=now-timedelta(days=1)),
            Expense(label="Demain", amount=8000, payment_method="Espèces", created_by_id=self.user.id, date=now+timedelta(days=1)),
            CashMovement(session_id=session["id"], type="in", amount=2000, reason="Appoint", user_id=self.user.id),
            CashMovement(session_id=session["id"], type="out", amount=500, reason="Retrait", user_id=self.user.id),
        ])
        self.db.commit()
        report = self.call("/api/cash-sessions/today")
        self.assertEqual(report["refunds_total"], 30000)
        self.assertEqual(report["cash_refunds"], 15000)
        self.assertEqual(report["net_sales"], 135000)
        self.assertEqual(report["other_sales"], 15000)
        self.assertEqual(report["cash_expenses"], 10000)
        self.assertEqual(report["expenses_total"], 11900)
        self.assertEqual(report["expected_cash"], 126500)
        self.assertEqual(len(report["expenses"]), 3)

    def test_empty_session_and_financial_permissions(self):
        self.call("/api/cash-sessions/open", "POST", {"opening_balance": 0}, status=201)
        hidden = self.call("/api/cash-sessions/current")
        self.assertIsNone(hidden["net_sales"])
        self.assertIsNone(hidden["cash_expenses"])
        self.assertEqual(hidden["expenses"], [])
        self.grant("soldes_consulter")
        visible = self.call("/api/cash-sessions/current")
        self.assertEqual(visible["net_sales"], 0)
        self.assertEqual(visible["expected_cash"], 0)


if __name__ == "__main__":
    unittest.main()
