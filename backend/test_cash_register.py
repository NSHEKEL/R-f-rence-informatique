import asyncio
import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text

import test_treasury_permissions as treasury
from app.models import BankAccount, BankDeposit, CashMovement, CashSession, Debt, DebtPayment, Product, Sale, SaleReturn
from app.routers import cash, returns, sales
from app import migrate as migration


class CashRegisterTests(unittest.TestCase):
    call = treasury.TreasuryPermissionsTests.call
    grant = treasury.TreasuryPermissionsTests.grant
    open = treasury.TreasuryPermissionsTests.open
    run_migration = treasury.TreasuryPermissionsTests.run_migration

    def setUp(self):
        treasury.TreasuryPermissionsTests.setUp(self)
        self.app.include_router(sales.router)
        self.app.include_router(returns.router)
        for target in (patch.object(sales, "_backup_after_sale"), patch.object(sales.remote_sales, "schedule")):
            target.start()
            self.addCleanup(target.stop)
        self.product = Product(name="Produit test", sku="CASH-TEST", quantity=20, sale_price=100)
        self.db.add(self.product)
        self.db.commit()

    def sale(self, client_id, client=("127.0.0.1", 1234), status=201):
        code, body = asyncio.run(treasury.request(self.app, "/api/sales", "POST", {
            "client_id": client_id, "items": [{"product_id": self.product.id, "quantity": 1}],
            "paid_amount": 100, "payment_method": "Espèces",
        }, client=client))
        self.assertEqual(code, status, body)
        return body

    def test_close_blocks_new_sale_and_offline_replay_but_existing_id_succeeds(self):
        first_session = self.open()
        recorded = self.sale("recorded")
        self.call("/api/cash-sessions/close", "POST", {"closing_balance": 600, "note": "Comptage"})
        for client in (("127.0.0.1", 1234), ("192.168.1.42", 1234)):
            self.sale("pending-offline", client, status=400)
            self.assertEqual(self.sale("recorded", client)["id"], recorded["id"])
        self.db.expire_all()
        frozen = self.db.get(CashSession, first_session["id"]).z_report
        self.user.role = "admin"
        self.db.commit()
        reopened = self.call(f"/api/cash-sessions/{first_session['id']}/reopen", "POST")
        self.assertNotEqual(reopened["id"], first_session["id"])
        new_sale = self.sale("pending-offline")
        self.assertEqual(self.db.get(Sale, new_sale["id"]).cash_session_id, reopened["id"])
        self.db.expire_all()
        self.assertEqual(self.db.get(CashSession, first_session["id"]).z_report, frozen)
        self.assertEqual(self.db.query(Sale).count(), 2)

    def test_secondary_workstation_sales_join_same_central_user_session(self):
        session = self.open()
        self.grant("soldes_consulter", "caisse_z")
        for client, client_id in [(("127.0.0.1", 1111), "main"), (("192.168.1.42", 2222), "secondary")]:
            created = self.sale(client_id, client)
            self.assertEqual(self.db.get(Sale, created["id"]).cash_session_id, session["id"])
        current = self.call("/api/cash-sessions/current")
        self.assertEqual(current["sales_count"], 2)
        self.assertEqual(current["expected_cash"], 700)
        self.assertEqual(self.call(f"/api/cash-sessions/{session['id']}/z")["expected_cash"], 700)

    def test_expected_and_z_include_only_session_cash_operations(self):
        session = self.open()
        self.grant("soldes_consulter", "caisse_z", "caisse_operations", "retours")
        sale = self.sale("cash-sale")
        other_session = CashSession(opened_by_id=self.other.id, opening_balance=999)
        self.db.add(other_session)
        self.db.flush()
        debt = Debt(kind="creance", party="Client", amount=200)
        self.db.add(debt)
        self.db.flush()
        self.db.add_all([
            DebtPayment(debt_id=debt.id, amount=40, method="Espèces", cash_session_id=session["id"], created_by_id=self.user.id),
            DebtPayment(debt_id=debt.id, amount=900, method="Espèces", cash_session_id=other_session.id, created_by_id=self.other.id),
            DebtPayment(debt_id=debt.id, amount=800, method="Espèces", created_by_id=self.other.id),
            CashMovement(session_id=other_session.id, type="in", amount=700, reason="Autre", user_id=self.other.id),
            Sale(reference="OTHER", cash_session_id=other_session.id, total=800, payment_method="Espèces"),
            SaleReturn(reference="OTHER-REFUND", sale_id=sale["id"], cash_session_id=other_session.id, refund_method="Espèces", total=600),
        ])
        self.db.commit()
        for kind, amount in [("in", 30), ("out", 10)]:
            self.call("/api/cash-sessions/movements", "POST", {"type": kind, "amount": amount, "reason": "Test"})
        self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "refund_method": "Espèces", "lines": [{"product_id": self.product.id, "quantity": 1}]}, status=201)
        current = self.call("/api/cash-sessions/current")
        z = self.call(f"/api/cash-sessions/{session['id']}/z")
        self.assertEqual(current["expected_cash"], 560)  # 500 + 100 + 40 + 30 - 10 - 100
        self.assertEqual(z["expected_cash"], current["expected_cash"])
        self.assertEqual(z["cash_refunds"], 100)
        closed = self.call("/api/cash-sessions/close", "POST", {"closing_balance": 560})
        self.assertEqual(closed["difference"], 0)
        self.assertEqual(closed["expected_balance"], z["expected_cash"])
        self.assertEqual(self.call(f"/api/cash-sessions/{session['id']}/z")["expected_cash"], 560)

    def test_movement_permissions_redaction_validation_and_closed_till(self):
        session = self.open()
        self.assertEqual(self.call(f"/api/cash-sessions/{session['id']}/movements"), [])
        for kind in ("in", "out"):
            self.call("/api/cash-sessions/movements", "POST", {"type": kind, "amount": 10, "reason": "Test"}, status=403)
        self.grant("recette_enregistrer")
        result = self.call("/api/cash-sessions/movements", "POST", {"type": "in", "amount": 10, "reason": "Recette"})
        self.assertIsNone(result["amount"])
        self.call("/api/cash-sessions/movements", "POST", {"type": "out", "amount": 10, "reason": "Test"}, status=403)
        self.grant("caisse_operations")
        self.call("/api/cash-sessions/movements", "POST", {"type": "out", "amount": 5, "reason": "Test"})
        for kind, amount, reason, status in [("invalid", 1, "Test", 422), ("in", 0, "Test", 422), ("out", -1, "Test", 422), ("in", 1, " ", 400)]:
            self.call("/api/cash-sessions/movements", "POST", {"type": kind, "amount": amount, "reason": reason}, status=status)
        rows = self.call(f"/api/cash-sessions/{session['id']}/movements")
        self.assertTrue(all(row["amount"] is None for row in rows))
        self.grant("soldes_consulter")
        self.assertEqual(sum(row["amount"] for row in self.call(f"/api/cash-sessions/{session['id']}/movements")), 15)
        self.call("/api/cash-sessions/close", "POST", {"closing_balance": 505})
        self.call("/api/cash-sessions/movements", "POST", {"type": "in", "amount": 1, "reason": "Test"}, status=400)

    def test_debt_payment_endpoint_binds_the_cashiers_current_session(self):
        session = self.open()
        self.grant("tresorerie_consulter", "soldes_consulter", "dettes_regler", "caisse_z")
        debt = Debt(kind="creance", party="Client", amount=100)
        self.db.add(debt)
        self.db.commit()
        self.call(f"/api/debts/{debt.id}/paiements", "POST", {"amount": 40, "method": "Espèces"}, status=201)
        self.db.expire_all()
        self.assertEqual(self.db.query(DebtPayment).one().cash_session_id, session["id"])
        self.assertEqual(self.call("/api/cash-sessions/current")["expected_cash"], 540)
        self.assertEqual(self.call(f"/api/cash-sessions/{session['id']}/z")["expected_cash"], 540)

    def test_only_validated_cash_bank_deposits_reduce_cash(self):
        session = self.open()
        self.grant("soldes_consulter", "caisse_z")
        account = BankAccount(bank_name="Banque")
        self.db.add(account)
        self.db.flush()
        for method, status, amount in [("Espèces", "validé", 20), ("Virement", "validé", 70), ("Espèces", "en attente", 300)]:
            self.db.add(BankDeposit(account_id=account.id, cash_session_id=session["id"], method=method, status=status, amount=amount))
        self.db.commit()
        self.assertEqual(self.call("/api/cash-sessions/current")["expected_cash"], 480)
        self.assertEqual(self.call(f"/api/cash-sessions/{session['id']}/z")["expected_cash"], 480)

    def test_additive_migration_preserves_legacy_tables_and_rows(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            for table in ("users", "cash_sessions", "sale_returns", "debt_payments"):
                conn.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)"))
                conn.execute(text(f"INSERT INTO {table} (id) VALUES (1)"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        inspector = inspect(engine)
        self.assertIn("cash_movements", inspector.get_table_names())
        for table in ("sale_returns", "debt_payments"):
            self.assertIn("cash_session_id", {col["name"] for col in inspector.get_columns(table)})
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT id, refund_method FROM sale_returns")).one(), (1, "Avoir"))
            self.assertEqual(conn.execute(text("SELECT COUNT(*) FROM debt_payments")).scalar(), 1)

    def test_corrupt_legacy_snapshot_is_not_overwritten(self):
        self.user.role = "admin"
        self.db.add(CashSession(id=1, opened_by_id=self.user.id, closed_at=datetime.now(timezone.utc), z_report="broken"))
        self.db.commit()
        self.call("/api/cash-sessions/1/z", status=409)
        self.db.expire_all()
        self.assertEqual(self.db.get(CashSession, 1).z_report, "broken")

    def test_legacy_frozen_z_is_returned_without_recalculation_or_extra_fields(self):
        self.user.role = "admin"
        self.db.commit()
        legacy = {"session_id": 1, "expected_cash": 4321, "difference": -12, "legacy_field": "inchangé"}
        session = CashSession(id=1, opened_by_id=self.user.id, closed_at=datetime.now(timezone.utc), z_report=json.dumps(legacy))
        self.db.add(session)
        self.db.commit()
        stored = session.z_report
        self.assertEqual(self.call("/api/cash-sessions/1/z"), legacy)
        self.run_migration()
        self.run_migration()
        self.assertEqual(self.call("/api/cash-sessions/1/z"), legacy)
        self.assertEqual(self.db.get(CashSession, 1).z_report, stored)
        self.db.add(CashSession(id=2, opened_by_id=self.user.id, closed_at=datetime.now(timezone.utc), expected_balance=789, z_report=""))
        self.db.commit()
        self.assertEqual(self.call("/api/cash-sessions/2/z")["expected_cash"], 789)
        self.db.expire_all()
        self.assertEqual(self.db.get(CashSession, 2).z_report, "")


if __name__ == "__main__":
    unittest.main()
