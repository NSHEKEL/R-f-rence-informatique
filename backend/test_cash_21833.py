import json
import unittest
from datetime import date

import test_wholesale as wholesale
from app import accounting_ledger, remote_sales, stock
from app.models import (CashMovement, CashSession, CompanySettings, Debt, DebtPayment, PriceHistory,
    Product, Purchase, SecurityLog, StockLot, StockMovement)


class Cash21833Tests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    open = wholesale.WholesaleTests.open
    stock = wholesale.WholesaleTests.stock

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        self.company = CompanySettings(name="Test")
        self.db.add(self.company)
        self.session_id = self.call("/api/cash-sessions/current")["id"]
        self.db.get(CashSession, self.session_id).opening_balance = 0
        self.db.commit()

    def sale(self, method="Espèces", quantity=1, payments=None):
        return self.call("/api/sales", "POST", {"payment_method": method, "payments": payments,
            "items": [{"product_id": self.product.id, "quantity": quantity}]}, 201)

    def current(self):
        return self.call("/api/cash-sessions/current")

    def close(self, counted, kept=0):
        return self.call("/api/cash-sessions/close", "POST", {"closing_balance": counted, "kept_balance": kept, "note": "Test"})

    def refund(self, sale, method="Espèces"):
        return self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "refund_method": method,
            "lines": [{"product_id": self.product.id, "quantity": 1}]}, 201)

    def test_A_conversion_and_kept_remittance_frozen_global_remote(self):
        self.assertTrue(self.db.get(CompanySettings, self.company.id).mobile_money_to_cash)
        self.product.sale_price = 479000
        self.db.commit()
        self.sale("Mixte", payments=[{"method": "Espèces", "amount": 465000}, {"method": "Mobile Money", "amount": 14000}])
        before = self.current()
        self.assertEqual((before["total_sales"], before["cash_sales"], before["expected_cash"]), (479000, 465000, 479000))
        self.call("/api/accounting/expenses", "POST", {"label": "Transport", "amount": 40000, "payment_method": "Espèces"}, 201)
        current = self.current()
        self.assertEqual(current["expected_cash"], 439000)
        self.assertEqual(current["mobile_money_sales"], 14000)
        self.call("/api/cash-sessions/close", "POST", {"closing_balance": 439000, "kept_balance": 440000}, 400)
        self.call("/api/cash-sessions/close", "POST", {"closing_balance": 439000, "kept_balance": -1}, 422)
        closed = self.close(439000, 10000)
        self.assertEqual((closed["remitted_amount"], closed["kept_balance"], closed["difference"]), (429000, 10000, 0))
        self.db.expire_all()
        frozen = self.db.get(CashSession, self.session_id).z_report
        self.company.mobile_money_to_cash = False
        self.db.commit()
        report = self.call(f"/api/cash-sessions/{self.session_id}/z")
        self.assertTrue(report["mobile_money_to_cash"])
        self.assertEqual(report["expected_cash"], 439000)
        self.assertEqual(self.db.get(CashSession, self.session_id).z_report, frozen)
        glob = self.call("/api/cash-sessions/global")
        self.assertEqual((glob["total_sales"], glob["expected_cash"], glob["remitted_amount"], glob["kept_balance"]), (479000, 439000, 429000, 10000))
        snapshot = remote_sales._cash_balances(self.db)["sessions"][0]
        self.assertEqual((snapshot["expected_cash"], snapshot["remitted_amount"], snapshot["kept_balance"]), (439000, 429000, 10000))
        reopened = self.call(f"/api/cash-sessions/{self.session_id}/reopen", "POST")
        self.assertEqual(reopened["opening_balance"], 10000)

    def test_B_admin_return_original_open_then_closed_and_linked_movement(self):
        original = self.sale(quantity=2)
        seller_id = self.user.id
        self.db.get(CashSession, self.session_id).opened_by_id = self.other.id
        self.db.get(wholesale.Sale, original["id"]).created_by_id = self.other.id
        self.db.commit()
        admin_session = self.open()
        refund = self.refund(original)
        seller = self.call(f"/api/cash-sessions/{self.session_id}/z")
        self.assertEqual((seller["cash_refunds"], seller["expected_cash"]), (100, 100))
        self.assertEqual(self.current()["cash_refunds"], 0)
        self.db.expire_all()
        self.assertEqual(self.db.query(CashMovement).count(), 0)
        self.db.add(CashMovement(session_id=self.session_id, type="out", amount=100, reason="Remboursement", user_id=seller_id, return_id=refund["id"]))
        self.db.commit()
        self.assertEqual(self.call(f"/api/cash-sessions/{self.session_id}/z")["expected_cash"], 100)
        entries, missing, _ = accounting_ledger.derive(self.db)
        self.assertFalse(any(row["source_type"] == "cash_movement" for row in entries + missing))
        original_session = self.db.get(CashSession, self.session_id)
        from app.routers.cash import session_amounts
        original_session.z_report = session_amounts(self.db, original_session).model_dump_json()
        original_session.closed_at = original_session.opened_at
        original_session.closing_balance = 100
        self.db.commit()
        frozen = original_session.z_report
        second_refund = self.refund(original)
        self.assertEqual(self.current()["id"], admin_session["id"])
        self.assertEqual(self.current()["cash_refunds"], 100)
        self.assertEqual(self.current()["expected_cash"], 400)
        movement = {"type": "out", "amount": 100, "reason": "Remboursement", "return_id": second_refund["id"]}
        self.call("/api/cash-sessions/movements", "POST", {**movement, "amount": 99}, 400)
        self.call("/api/cash-sessions/movements", "POST", movement)
        self.call("/api/cash-sessions/movements", "POST", movement, 409)
        self.assertEqual(self.current()["expected_cash"], 400)
        self.db.expire_all()
        self.assertEqual(self.db.get(CashSession, self.session_id).z_report, frozen)
        self.assertEqual(self.stock(), 200)

    def test_conversion_off_mobile_refunds_expenses_and_empty(self):
        self.assertEqual(self.current()["expected_cash"], 0)
        self.company.mobile_money_to_cash = False
        self.db.commit()
        sale = self.sale("Mobile Money")
        self.assertEqual(self.current()["expected_cash"], 0)
        self.company.mobile_money_to_cash = True
        self.db.commit()
        self.assertEqual(self.current()["expected_cash"], 100)
        self.refund(sale, "Mobile Money")
        self.assertEqual(self.current()["expected_cash"], 0)
        self.sale("Wave")
        self.call("/api/accounting/expenses", "POST", {"label": "Transport MM", "amount": 10, "payment_method": "Mobile Money"}, 201)
        self.assertEqual(self.current()["expected_cash"], 90)
        self.assertEqual(self.current()["total_sales"], 200)

    def purchase(self, quantity=100, cost=1000):
        return self.call("/api/purchases", "POST", {"supplier_name": "Fournisseur", "items": [{"product_id": self.product.id, "quantity": quantity, "unit_cost": cost}]}, 201)

    def test_C_delete_received_purchase_stock_value_debt_prices_audit_only_own(self):
        other = self.purchase(2, 40)
        self.call(f"/api/purchases/{other['id']}/receive", "POST", {})
        baseline = self.stock()
        before_cost = self.db.get(Product, self.product.id).purchase_price
        target = self.purchase()
        self.assertEqual(target["total"], 100000)
        self.call(f"/api/purchases/{target['id']}/receive", "POST", {"update_cost": True})
        self.assertEqual(self.stock(), baseline + 100)
        self.assertEqual(self.db.get(Product, self.product.id).purchase_price, 1000)
        self.assertEqual(self.db.query(Debt).filter_by(purchase_id=target["id"]).count(), 1)
        other_debt = self.db.query(Debt).filter_by(purchase_id=other["id"]).one()
        other_debt.reference = target["reference"]
        self.db.commit()
        self.call(f"/api/purchases/{target['id']}", "DELETE", status=204)
        self.assertEqual(self.stock(), baseline)
        self.assertEqual(self.db.get(Product, self.product.id).purchase_price * baseline, before_cost * baseline)
        self.assertIsNone(self.db.get(Purchase, target["id"]))
        self.assertIsNotNone(self.db.get(Purchase, other["id"]))
        self.assertEqual(self.db.query(Debt).filter_by(purchase_id=other["id"]).count(), 1)
        self.assertEqual(self.db.query(Debt).filter_by(purchase_id=target["id"]).count(), 0)
        self.assertEqual(self.db.query(PriceHistory).filter_by(purchase_reference=target["reference"]).count(), 0)
        movements = self.db.query(StockMovement).filter(StockMovement.reason.in_([f"Approvisionnement {target['reference']}", f"Suppression {target['reference']}"])).all()
        self.assertEqual(sum(row.quantity for row in movements), 0)
        log = self.db.query(SecurityLog).filter_by(event="suppression_approvisionnement").one()
        self.assertEqual(json.loads(log.detail)["reference"], target["reference"])
        entries, missing, _ = accounting_ledger.derive(self.db)
        self.assertFalse(any(row["reference"] == target["reference"] for row in entries + missing))
        self.call(f"/api/purchases/{target['id']}", "DELETE", status=404)
        pending = self.purchase(1, 40)
        self.call(f"/api/purchases/{pending['id']}", "DELETE", status=204)
        self.assertEqual(self.stock(), baseline)

    def test_purchase_deletion_specific_safety_guards_rollback_and_permission(self):
        target = self.purchase()
        self.call(f"/api/purchases/{target['id']}/receive", "POST", {})
        debt = self.db.query(Debt).filter_by(purchase_id=target["id"]).one()
        payment = DebtPayment(debt_id=debt.id, amount=1, method="Espèces", created_by_id=self.user.id)
        self.db.add(payment)
        self.db.commit()
        self.call(f"/api/purchases/{target['id']}", "DELETE", status=409)
        payment.cancelled = True
        self.db.commit()
        stock.adjust(self.db, self.product, -290)
        self.db.commit()
        self.call(f"/api/purchases/{target['id']}", "DELETE", status=400)
        self.assertEqual(self.stock(), 10)
        stock.adjust(self.db, self.product, 290)
        self.db.add(StockLot(product_id=self.product.id, depot_id=stock.resolve(self.db), quantity=250))
        self.db.commit()
        self.call(f"/api/purchases/{target['id']}", "DELETE", status=409)
        self.assertEqual(self.stock(), 300)
        self.user.role = "vendeur"
        self.db.commit()
        self.call(f"/api/purchases/{target['id']}", "DELETE", status=403)

    def test_D_two_tills_cash_mobile_split_expense_return_dashboard_global_close(self):
        self.sale()
        self.sale("Mobile Money")
        self.sale("Mixte", payments=[{"method": "Espèces", "amount": 25}, {"method": "Wave", "amount": 75}])
        self.call("/api/accounting/expenses", "POST", {"label": "Transport", "amount": 20, "payment_method": "Espèces"}, 201)
        original = self.sale()
        self.refund(original)
        for kind, amount in [("in", 10), ("out", 5)]:
            self.call("/api/cash-sessions/movements", "POST", {"type": kind, "amount": amount, "reason": "Test"})
        self.assertEqual(self.current()["expected_cash"], 285)
        self.close(285, 10)
        self.db.get(CashSession, self.session_id).opened_by_id = self.other.id
        self.db.commit()
        self.open()
        self.sale()
        glob = self.call("/api/cash-sessions/global")
        self.assertEqual((glob["total_sales"], glob["expected_cash"], len(glob["cashiers"])), (500, 885, 2))
        self.assertEqual(glob["payment_groups"]["mobile_money"], 175)
        self.assertEqual(self.call("/api/dashboard")["total_revenue"], 500)
        self.close(600, 100)
        glob = self.call("/api/cash-sessions/global")
        result = self.call("/api/cash-sessions/global/close", "POST", {"date_from": date.today().isoformat(), "date_to": date.today().isoformat(),
            "session_ids": [row["session_id"] for row in glob["sessions"]], "closing_balance": 885}, 201)
        self.assertEqual((result["expected_cash"], result["kept_balance"], result["remitted_amount"]), (885, 110, 775))


if __name__ == "__main__":
    unittest.main()
