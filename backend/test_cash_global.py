import json
import unittest
import sqlite3
import time
from unittest.mock import patch
from datetime import date, timedelta

from sqlalchemy import inspect, text
from fastapi.testclient import TestClient

import test_cash_register as register
import test_wholesale as wholesale
from app.models import BankAccount, BankDeposit, CashClosure, CashSession, Debt, DebtPayment, OfflineEvent, OfflineSession, Sale
from app.payment_totals import group_payments


class CashGlobalTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    grant = register.CashRegisterTests.grant
    open = register.CashRegisterTests.open
    run_migration = register.CashRegisterTests.run_migration

    def setUp(self):
        register.CashRegisterTests.setUp(self)
        local = patch("app.offline_store.local_events_pending", return_value=False)
        local.start()
        self.addCleanup(local.stop)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def prepare(self):
        self.user.role = "admin"
        self.db.commit()
        return self.open()

    def sell(self, key, method="Espèces", quantity=1, payments=None):
        return self.call("/api/sales", "POST", {"client_id": key, "payment_method": method,
            "items": [{"product_id": self.product.id, "quantity": quantity}], "payments": payments}, 201)

    def close(self, counted):
        return self.call("/api/cash-sessions/close", "POST", {"cash_session_id": self.call("/api/cash-sessions/current")["id"], "closing_balance": counted, "note": "Comptage"})

    def global_close(self, preview, counted, status=201, **changes):
        return self.call("/api/cash-sessions/global/close", "POST", {
            "date_from": preview["date_from"], "date_to": preview["date_to"],
            "session_ids": [s["session_id"] for s in preview["sessions"]], "closing_balance": counted, **changes,
        }, status)

    def test_admin_and_seller_payments_movements_closures_and_exactly_once(self):
        own = self.prepare()
        self.sell("admin-cash")
        self.close(600)
        admin = self.user
        self.grant("caisse", "caisse_fermer", "vente_nouvelle", "soldes_consulter", "clotures_consulter", "caisse_operations", "retours", "depenses_gerer", "tresorerie_consulter")
        self.user = self.other
        seller = self.open()
        refunded = self.sell("seller-cash")
        self.sell("seller-mobile", "Mobile Money")
        self.sell("seller-bank", "Carte bancaire")
        duplicate = self.sell("seller-mixed", "Mixte", 3, [{"method": "Espèces", "amount": 50}, {"method": "Wave", "amount": 100}, {"method": "Virement", "amount": 150}])
        self.sell("seller-credit", "Crédit (à régler plus tard)")
        self.call("/api/returns", "POST", {"sale_reference": refunded["reference"], "refund_method": "Espèces", "lines": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        self.call("/api/cash-sessions/movements", "POST", {"type": "in", "amount": 20, "reason": "Entrée"})
        self.call("/api/cash-sessions/movements", "POST", {"type": "out", "amount": 10, "reason": "Sortie"})
        self.call("/api/accounting/expenses", "POST", {"label": "Transport", "amount": 5, "payment_method": "Espèces"}, 201)
        current = self.call("/api/cash-sessions/current")
        self.assertEqual(current["payment_groups"], {"cash": 150, "mobile_money": 200, "bank": 250, "credit": 100, "other": 0})
        self.assertEqual(current["expected_cash"], 555)
        self.close(555)
        self.assertEqual(self.sell("seller-mixed", "Mixte", 3, [{"method": "Espèces", "amount": 50}, {"method": "Wave", "amount": 100}, {"method": "Virement", "amount": 150}])["id"], duplicate["id"])
        self.user = admin
        preview = self.call("/api/cash-sessions/global")
        self.assertEqual(preview["total_sales"], 800)
        self.assertEqual(preview["payment_groups"], {"cash": 250, "mobile_money": 200, "bank": 250, "credit": 100, "other": 0})
        self.assertEqual((preview["expected_cash"], preview["refunds_total"], preview["entries_total"], preview["exits_total"], preview["cash_expenses"]), (1155, 100, 20, 10, 5))
        self.assertEqual(preview["inflow_groups"], {"cash": 270, "mobile_money": 200, "bank": 250, "credit": 0, "other": 0})
        self.assertEqual(preview["outflow_groups"], {"cash": 115, "mobile_money": 0, "bank": 0, "credit": 0, "other": 0})
        self.assertEqual(len(preview["cashiers"]), 2)
        self.assertEqual(sum(r["total_sales"] for r in preview["cashiers"]), 800)
        frozen = self.global_close(preview, 1155)
        self.assertEqual(len(frozen["sessions"]), 2)
        self.assertEqual(frozen["difference"], 0)
        self.assertEqual(self.call("/api/cash-sessions/global")["total_sales"], 0)
        self.assertEqual(sum(self.call("/api/cash-sessions/global")["inflow_groups"].values()), 0)
        self.global_close(preview, 1155, 409)
        self.db.expire_all()
        self.assertEqual(self.db.query(CashClosure).count(), 1)
        self.assertEqual(self.db.query(Sale).count(), 6)
        for session in (own, seller):
            self.assertEqual(self.db.get(CashSession, session["id"]).global_closure_id, frozen["id"])
        self.assertEqual(self.call("/api/cash-sessions/global/closures")[0]["total_sales"], 800)
        self.assertEqual(json.loads(self.db.query(CashClosure).one().report)["total_sales"], 800)

    def test_open_sessions_changed_selection_empty_period_permissions_and_gap(self):
        self.call("/api/cash-sessions/global", status=403)
        self.call("/api/cash-sessions/global/closures", status=403)
        self.call("/api/cash-sessions/global/close", "POST", {"date_from": str(date.today()), "date_to": str(date.today()), "session_ids": [1], "closing_balance": 0}, 403)
        self.prepare()
        preview = self.call("/api/cash-sessions/global")
        self.assertEqual(preview["sessions"][0]["user_id"], self.user.id)
        self.assertEqual(preview["open_sessions"], 1)
        self.global_close(preview, 500, 409)
        self.close(500)
        preview = self.call("/api/cash-sessions/global")
        self.global_close(preview, 500, 409, session_ids=[999])
        self.global_close(preview, 490, 400)
        self.assertEqual(self.db.query(CashClosure).count(), 0)
        closed = self.global_close(preview, 490, note="Écart déclaré")
        self.assertEqual(closed["difference"], -10)
        self.call(f"/api/cash-sessions/global?date_from={date.today()}&date_to={date.today() - timedelta(days=1)}", status=400)
        self.call("/api/cash-sessions/global/close", "POST", {"date_from": str(date.today()), "date_to": str(date.today()), "session_ids": [], "closing_balance": 0}, 422)

    def test_unrecovered_events_provisional_sessions_and_local_journal_block_global_close(self):
        opened = self.prepare()
        self.close(500)
        preview = self.call("/api/cash-sessions/global")
        event = OfflineEvent(id="pending-event", device_id="device", user_id=self.user.id, session_id="provisional",
                             sequence=1, kind="open", occurred_at=time.time(), hash="hash", envelope="{}")
        self.db.add(event)
        for state in ("received", "conflict"):
            event.state = state
            self.db.commit()
            self.global_close(preview, 500, 409)
            self.assertEqual(self.db.query(CashClosure).count(), 0)
        event.state = "applied"
        provisional = OfflineSession(id="provisional", device_id="device", user_id=self.user.id, opening_event_id=event.id)
        self.db.add(provisional)
        self.db.commit()
        self.global_close(preview, 500, 409)
        provisional.status = "open"
        provisional.cash_session_id = opened["id"]
        self.db.commit()
        with patch("app.offline_store.local_events_pending", return_value=True):
            self.global_close(preview, 500, 409)
        with patch("app.offline_store.local_events_pending", side_effect=sqlite3.OperationalError("locked")):
            self.global_close(preview, 500, 503)
        self.assertEqual(self.db.query(CashClosure).count(), 0)
        self.global_close(preview, 500)
        print("GLOBAL_PENDING_GUARD_OK received=True conflict=True provisional=True local_journal=True unreadable=True recovered_close_once=True")

    def test_frozen_z_old_payment_modes_period_scope_and_additive_migration(self):
        opened = self.prepare()
        self.sell("mobile", "Mobile Money")
        self.close(500)
        row = self.db.get(CashSession, opened["id"])
        stored = json.loads(row.z_report)
        stored.pop("payment_groups")
        row.z_report = json.dumps(stored)
        row.business_day = str(date.today() - timedelta(days=1))
        self.db.commit()
        self.assertEqual(self.call("/api/cash-sessions/global")["sessions"], [])
        earlier = str(date.today() - timedelta(days=1))
        report = self.call(f"/api/cash-sessions/global?date_from={earlier}&date_to={earlier}")
        self.assertEqual(report["payment_groups"]["mobile_money"], 100)
        legacy_z = self.call(f"/api/cash-sessions/{row.id}/z")
        self.assertNotIn("payment_groups", legacy_z)
        self.assertEqual(legacy_z["payments"], stored["payments"])
        with self.engine.begin() as conn:
            columns = ", ".join(f'"{c["name"]}"' for c in inspect(self.engine).get_columns("cash_sessions") if c["name"] != "global_closure_id")
            conn.execute(text(f"CREATE TABLE legacy_cash_sessions AS SELECT {columns} FROM cash_sessions"))
            conn.execute(text("DROP TABLE cash_sessions"))
            conn.execute(text("ALTER TABLE legacy_cash_sessions RENAME TO cash_sessions"))
            conn.execute(text("ALTER TABLE sale_items DROP COLUMN packaging_divisor"))
        self.run_migration()
        self.assertIn("global_closure_id", {c["name"] for c in inspect(self.engine).get_columns("cash_sessions")})
        self.assertIn("packaging_divisor", {c["name"] for c in inspect(self.engine).get_columns("sale_items")})

    def test_payment_classification_empty_known_and_unknown(self):
        self.assertEqual(sum(group_payments({}).values()), 0)
        self.assertEqual(group_payments({"Espèces": 1, "Orange Money": 2, "MTN Money": 3, "Moov": 4, "Wave": 5, "Carte bancaire": 6, "Chèque": 7, "Virement": 8, "Crédit": 9, "Autre": 10}), {"cash": 1, "mobile_money": 14, "bank": 21, "credit": 9, "other": 10})

    def test_global_flows_separate_receipts_disbursements_transfers_and_legacy_z(self):
        self.prepare()
        admin = self.user
        self.sell("admin-inflow")
        self.call("/api/accounting/expenses", "POST", {"label": "Admin", "amount": 5, "payment_method": "Espèces"}, 201)
        self.close(595)
        self.grant("caisse", "caisse_fermer", "vente_nouvelle", "soldes_consulter", "clotures_consulter", "caisse_operations", "retours", "depenses_gerer", "tresorerie_consulter")
        self.user = self.other
        seller = self.open()
        self.sell("cash-inflow")
        mobile = self.sell("mobile-inflow", "Wave")
        bank = self.sell("bank-inflow", "Virement")
        self.sell("credit-not-collected", "Crédit (à régler plus tard)")
        for sale, method in ((mobile, "Avoir"), (bank, "Avoir")):
            self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "refund_method": method, "lines": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        account = BankAccount(bank_name="Banque")
        self.db.add(account)
        self.db.flush()
        for method, amount, kind in (("Espèces", 40, "creance"), ("Espèces", 15, "dette"), ("Wave", 20, "creance"), ("Wave", 8, "dette"), ("Virement", 30, "creance"), ("Virement", 10, "dette")):
            debt = Debt(kind=kind, party="Tiers", amount=100)
            self.db.add(debt)
            self.db.flush()
            self.db.add(DebtPayment(debt_id=debt.id, cash_session_id=seller["id"], amount=amount, method=method, created_by_id=self.user.id))
        self.db.add(DebtPayment(debt_id=debt.id, cash_session_id=seller["id"], amount=1000, method="Espèces", cancelled=True))
        for method, status, amount in (("Espèces", "validé", 25), ("Espèces", "en attente", 500), ("Espèces", "annulé", 900), ("Virement", "validé", 1000)):
            self.db.add(BankDeposit(account_id=account.id, cash_session_id=seller["id"], method=method, status=status, amount=amount))
        self.db.commit()
        for method, amount, bank_id in (("Espèces", 7, None), ("Wave", 11, None), ("Virement", 13, None), ("Espèces", 17, account.id)):
            self.call("/api/accounting/expenses", "POST", {"label": "Vendeur", "amount": amount, "payment_method": method, "bank_account_id": bank_id}, 201)
        for kind, amount in (("in", 20), ("out", 10)):
            self.call("/api/cash-sessions/movements", "POST", {"type": kind, "amount": amount, "reason": "Flux"})
        self.user = admin
        preview = self.call("/api/cash-sessions/global")
        self.assertEqual(preview["inflow_groups"], {"cash": 260, "mobile_money": 120, "bank": 130, "credit": 0, "other": 0})
        self.assertEqual(preview["outflow_groups"], {"cash": 62, "mobile_money": 19, "bank": 40, "credit": 0, "other": 200})
        self.assertEqual(preview["expected_cash"], 1198)
        self.assertEqual(preview["opening_balance"] + preview["inflow_groups"]["cash"] - preview["outflow_groups"]["cash"], preview["expected_cash"])
        self.user = self.other
        self.close(603)
        self.user = admin
        frozen = self.call("/api/cash-sessions/global")
        for key in ("inflow_groups", "outflow_groups", "expected_cash"):
            self.assertEqual(frozen[key], preview[key])
        seller_row = next(row for row in frozen["sessions"] if row["session_id"] == seller["id"])
        self.assertEqual((seller_row["counted_cash"], seller_row["difference"]), (603, 0))
        row = self.db.get(CashSession, seller["id"])
        legacy = json.loads(row.z_report)
        legacy.pop("inflow_groups")
        legacy.pop("outflow_groups")
        for refund in legacy["refunds"]:
            refund.pop("refund_method")
        row.z_report = json.dumps(legacy)
        self.db.commit()
        stored = row.z_report
        legacy_global = self.call("/api/cash-sessions/global")
        self.assertEqual(legacy_global["outflow_groups"]["other"], 200)
        self.assertEqual(legacy_global["expected_cash"], 1198)
        self.assertEqual(legacy_global["opening_balance"] + legacy_global["inflow_groups"]["cash"] - legacy_global["outflow_groups"]["cash"], 1198)
        self.assertEqual(self.db.get(CashSession, row.id).z_report, stored)

    def test_global_closure_ownership_follows_viewer_without_rewriting_snapshot(self):
        self.prepare()
        creator = self.user
        self.sell("creator-cash")
        self.close(600)
        self.other.role = "admin"
        self.db.commit()
        self.user = self.other
        self.assertEqual(self.call("/api/cash-sessions/global/closures"), [])
        self.open()
        self.sell("viewer-mobile", "Mobile Money")
        self.close(500)
        self.user = creator
        preview = self.call("/api/cash-sessions/global")
        closed = self.global_close(preview, preview["expected_cash"])
        stored = self.db.get(CashClosure, closed["id"]).report
        for viewer in (creator, self.other):
            self.user = viewer
            report = self.call("/api/cash-sessions/global/closures")[0]
            self.assertEqual([c["user_id"] for c in report["cashiers"] if c["own"]], [viewer.id])
            self.assertEqual(report["payment_groups"], closed["payment_groups"])
            self.assertEqual(report["total_sales"], 200)
            self.db.expire_all()
            self.assertEqual(self.db.get(CashClosure, closed["id"]).report, stored)
