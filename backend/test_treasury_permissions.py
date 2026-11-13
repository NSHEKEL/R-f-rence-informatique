import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
    "EASYGEST_DATA_DIR": folder, "DATABASE_URL": "sqlite:///:memory:",
    "SECRET_KEY": "treasury-tests-only",
}):
    from app import migrate as migration
    from app.auth import get_current_user
    from app.database import Base, get_db
    from app.models import AppMigration, BankAccount, BankDeposit, CashSession, RolePermission, Sale, User
    from app.permissions import DEFAULTS, PERMISSIONS, allowed_keys, role_matrix, save_matrix
    from app.routers import accounting, bank, cash, dashboard, debts, reports


NEW_KEYS = {"tresorerie_consulter", "soldes_consulter", "recette_enregistrer", "caisse_operations", "clotures_consulter"}
FINANCIAL_PATHS = [
    "/api/bank/accounts", "/api/bank/deposits", "/api/accounting/summary",
    "/api/accounting/expenses", "/api/reports/sales", "/api/dashboard",
    "/api/debts", "/api/debts/resume", "/api/debts/reglements", "/api/debts/soldes",
    "/api/debts/echeancier", "/api/debts/alertes", "/api/debts/1/paiements",
]


async def request(app, path, method="GET", payload=None, client=("127.0.0.1", 1234)):
    messages = []
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            await asyncio.Event().wait()
        sent = True
        return {"type": "http.request", "body": json.dumps(payload or {}).encode(), "more_body": False}

    async def send(message):
        messages.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": b"", "headers": [(b"content-type", b"application/json")],
             "server": ("127.0.0.1", 8000), "client": client}
    await asyncio.wait_for(app(scope, receive, send), 10)
    status = next(m["status"] for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return status, json.loads(body) if body else None


class TreasuryPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.engine = create_engine(f"sqlite:///{Path(self.temp.name) / 'shop.db'}", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.user = User(name="Vendeur", email="seller@test.invalid", hashed_password="unused", role="vendeur")
        self.other = User(name="Autre", email="other@test.invalid", hashed_password="unused", role="vendeur")
        self.db.add_all([self.user, self.other])
        self.db.commit()
        self.app = FastAPI()
        for router in (accounting.router, bank.router, cash.router, dashboard.router, debts.router, reports.router):
            self.app.include_router(router)

        def db_dependency():
            with self.sessions() as session:
                yield session

        self.app.dependency_overrides[get_db] = db_dependency
        self.app.dependency_overrides[get_current_user] = lambda: self.user

    def call(self, path, method="GET", payload=None, status=200):
        code, body = asyncio.run(request(self.app, path, method, payload))
        self.assertEqual(code, status, (path, body))
        return body

    def grant(self, *keys):
        save_matrix(self.db, {"vendeur": {key: True for key in keys}})

    def open(self):
        return self.call("/api/cash-sessions/open", "POST", {"opening_balance": 500}, status=201)

    def assert_redacted(self, data):
        for key in ("opening_balance", "closing_balance", "expected_balance", "difference",
                    "cash_sales", "other_sales", "deposits_total", "expected_cash", "sales_count"):
            self.assertIsNone(data.get(key), key)
        self.assertEqual(data.get("sales", []), [])

    def test_seller_denied_all_treasury_reads_and_writes(self):
        for path in [*FINANCIAL_PATHS, "/api/cash-sessions", "/api/cash-sessions/1/z"]:
            with self.subTest(path=path):
                self.call(path, status=403)
        for path, method, payload in [
            ("/api/bank/accounts", "POST", {"bank_name": "Test"}),
            ("/api/bank/accounts/1", "PUT", {"bank_name": "Test"}),
            ("/api/bank/deposits", "POST", {"account_id": 1, "amount": 10}),
            ("/api/bank/deposits/1/decision", "POST", {"action": "valider"}),
            ("/api/bank/deposits/1/reconcile", "POST", {"reconciled": True}),
            ("/api/accounting/expenses", "POST", {"label": "Test", "amount": 10}),
            ("/api/accounting/expenses/1", "DELETE", {}),
            ("/api/debts", "POST", {}),
            ("/api/debts/1", "PUT", {}),
            ("/api/debts/1", "DELETE", {}),
            ("/api/debts/1/paiements", "POST", {"amount": 10}),
            ("/api/debts/1/paiements/1/annuler", "POST", {"reason": "Test"}),
            ("/api/cash-sessions/1/reopen", "POST", {}),
        ]:
            with self.subTest(path=path, method=method):
                self.call(path, method, payload, status=403)

    def test_cash_state_empty_open_close_and_blind_close_error(self):
        self.assertIsNone(self.call("/api/cash-sessions/current"))
        opened = self.open()
        self.assert_redacted(opened)
        self.assertIsNone(opened["closed_at"])
        self.db.add(Sale(reference="TEST-1", cash_session_id=opened["id"], total=120,
                         payment_method="Espèces", status="Payée", created_by_id=self.user.id))
        self.db.commit()
        for path in ("/api/cash-sessions/current", "/api/cash-sessions/today"):
            self.assert_redacted(self.call(path))
        self.call("/api/cash-sessions/close", "POST", {"closing_balance": 500}, status=400)
        closed = self.call("/api/cash-sessions/close", "POST", {"closing_balance": 500, "note": "Comptage remis au gérant"})
        self.assertIsNotNone(closed["closed_at"])
        self.assert_redacted(closed)
        self.assert_redacted(self.call("/api/cash-sessions/today"))
        self.call(f"/api/cash-sessions/{opened['id']}/z", status=403)

    def test_each_new_key_is_independent(self):
        self.open()
        for key in NEW_KEYS:
            save_matrix(self.db, {"vendeur": {other: other == key for other in NEW_KEYS}})
            with self.subTest(key=key):
                data = self.call("/api/cash-sessions/current")
                if key == "soldes_consulter":
                    self.assertEqual(data["expected_cash"], 500)
                else:
                    self.assert_redacted(data)
                self.call("/api/cash-sessions", status=200 if key == "clotures_consulter" else 403)
                for path in FINANCIAL_PATHS:
                    self.call(path, status=403)

    def test_bank_specific_permissions_and_balance_redaction(self):
        account = BankAccount(bank_name="Test")
        self.db.add(account)
        self.db.flush()
        self.db.add(BankDeposit(account_id=account.id, amount=75, status="validé"))
        self.db.commit()
        self.grant("tresorerie_consulter")
        self.call("/api/bank/accounts", status=403)
        self.grant("versements_valider")
        self.assertIsNone(self.call("/api/bank/accounts")[0]["balance"])
        self.call("/api/bank/deposits")
        self.call("/api/bank/deposits", "POST", {"account_id": account.id, "amount": 10}, status=403)
        self.grant("soldes_consulter")
        self.assertEqual(self.call("/api/bank/accounts")[0]["balance"], 75)
        self.grant("versements_gerer")
        self.call("/api/bank/deposits", "POST", {"account_id": account.id, "amount": 10}, status=201)

    def test_expense_permission_does_not_grant_reports_or_reads(self):
        self.grant("depenses_gerer")
        self.call("/api/accounting/expenses", "POST", {"label": "Test", "amount": 10}, status=403)
        self.grant("tresorerie_consulter")
        expense = self.call("/api/accounting/expenses", "POST", {"label": "Test", "amount": 10}, status=201)
        self.call("/api/accounting/expenses", status=403)
        self.call("/api/accounting/summary", status=403)
        self.call(f"/api/accounting/expenses/{expense['id']}", "DELETE", status=204)

    def test_financial_reports_require_page_and_both_financial_rights(self):
        self.grant("tresorerie_consulter", "comptabilite", "tableau_bord", "rapports", "dettes")
        self.call("/api/accounting/expenses")
        paths = ["/api/accounting/summary", "/api/reports/sales", "/api/dashboard", "/api/debts/soldes"]
        for path in paths:
            self.call(path, status=403)
        self.grant("rapports_financiers")
        for path in paths:
            self.call(path, status=403)
        self.grant("soldes_consulter")
        for path in paths:
            self.call(path)
        self.call("/api/debts")
        save_matrix(self.db, {"vendeur": {"tableau_bord": False}})
        self.call("/api/dashboard", status=403)

    def test_debt_actions_cannot_return_balances_without_balance_right(self):
        self.grant("tresorerie_consulter", "dettes_gerer")
        payload = {"kind": "creance", "party": "Client test", "amount": 100}
        self.call("/api/debts", "POST", payload, status=403)
        self.grant("soldes_consulter")
        created = self.call("/api/debts", "POST", payload, status=201)
        self.assertEqual(created["remaining"], 100)
        self.call("/api/debts", status=403)

    def test_z_requires_balances_and_explicit_own_or_global_closure_right(self):
        opened = self.open()
        other_session = CashSession(opened_by_id=self.other.id, opening_balance=900, business_day=cash.business_day())
        self.db.add(other_session)
        self.db.commit()
        own_path = f"/api/cash-sessions/{opened['id']}/z"
        other_path = f"/api/cash-sessions/{other_session.id}/z"
        self.grant("soldes_consulter")
        self.call(own_path, status=403)
        self.grant("caisse_z")
        self.call(own_path)
        self.call(other_path, status=403)
        self.call("/api/cash-sessions", status=403)
        self.grant("clotures_consulter")
        self.call(other_path)
        self.call("/api/cash-sessions/close", "POST", {"closing_balance": 500, "note": "Comptage vérifié"})
        self.assertEqual(self.call(own_path)["expected_cash"], 500)
        save_matrix(self.db, {"vendeur": {"caisse_z": False, "clotures_consulter": False}})
        self.assert_redacted(self.call("/api/cash-sessions/today"))
        self.call(own_path, status=403)
        self.grant("clotures_consulter")
        save_matrix(self.db, {"vendeur": {"soldes_consulter": False}})
        self.call(own_path, status=403)
        self.call(other_path, status=403)
        for session in self.call("/api/cash-sessions"):
            self.assert_redacted(session)

    def test_admin_keeps_all_reads(self):
        self.user.role = "admin"
        self.db.commit()
        for path in FINANCIAL_PATHS:
            self.call(path, status=404 if path == "/api/debts/1/paiements" else 200)
        account = self.call("/api/bank/accounts", "POST", {"bank_name": "Test"}, status=201)
        updated = self.call(f"/api/bank/accounts/{account['id']}", "PUT", {"bank_name": "Modifié"})
        self.assertEqual(updated["bank_name"], "Modifié")
        self.assertEqual(self.open()["expected_cash"], 500)

    def run_migration(self):
        with patch.object(migration, "engine", self.engine):
            migration.migrate()
        self.db.expire_all()

    def test_upgrade_never_grants_rights_and_preserves_nonfinancial_rights(self):
        for saved in (False, True):
            with self.subTest(saved=saved):
                self.db.query(AppMigration).delete()
                self.db.query(RolePermission).delete()
                self.db.commit()
                if saved:
                    save_matrix(self.db, {"vendeur": {"tableau_bord": True, "caisse": False, "depenses_gerer": True},
                                          "gestionnaire": {"rapports": True, "produits": False}})
                stored = {(r.role, r.permission): r.allowed for r in self.db.query(RolePermission)}
                old_defaults = {
                    "vendeur": {"caisse", "caisse_fermer", "caisse_z", "vente_nouvelle", "assistance"},
                    "gestionnaire": {"produits", "inventaire", "fournisseurs", "categories", "approvisionnements", "assistance"},
                }
                before = {role: {key for key in PERMISSIONS if key not in NEW_KEYS and stored.get((role, key), key in old_defaults[role])}
                          for role in DEFAULTS}
                self.run_migration()
                after = role_matrix(self.db)
                removed = {"versements_gerer", "versements_valider", "depenses_gerer", "comptabilite", "dettes", "dettes_gerer", "dettes_regler"}
                for role in DEFAULTS:
                    effective = {key for key, value in after[role].items() if value}
                    self.assertFalse(effective - before[role])
                    self.assertFalse(effective & NEW_KEYS)
                    for key in set(PERMISSIONS) - NEW_KEYS - removed:
                        self.assertEqual(after[role][key], key in before[role], (role, key))

    def test_grants_survive_repeated_full_migration(self):
        self.run_migration()
        keys = ["tresorerie_consulter", "comptabilite", "depenses_gerer", "versements_gerer", "dettes", "soldes_consulter"]
        self.grant(*keys)
        self.run_migration()
        self.run_migration()
        self.assertTrue(set(keys) <= set(allowed_keys(self.db, self.user)))
        self.assertEqual(self.db.query(AppMigration).filter_by(name="treasury_permissions_v1").count(), 1)

    def test_new_install_defaults_and_french_sections(self):
        self.db.query(User).delete()
        self.db.commit()
        self.run_migration()
        self.assertFalse(role_matrix(self.db)["vendeur"]["caisse_z"])
        self.assertEqual(DEFAULTS["vendeur"], {"caisse", "caisse_fermer", "vente_nouvelle", "assistance"})
        for key in NEW_KEYS | {"rapports_financiers", "depenses_gerer"}:
            self.assertEqual(PERMISSIONS[key][1], "Trésorerie")


if __name__ == "__main__":
    unittest.main()
