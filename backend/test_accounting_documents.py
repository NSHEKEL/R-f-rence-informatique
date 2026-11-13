import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text

import test_wholesale as wholesale
from app import migrate as migration
from app.accounting_ledger import seed_accounts
from app.models import AccountingAccount, AccountingSetting, AppMigration, BankAccount, CompanySettings, Customer, Debt, Expense, Product, Purchase, RolePermission, Sale, SecurityLog
from app.profits import financials
from app.routers import accounting_documents


class AccountingDocumentsTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    grant = wholesale.WholesaleTests.grant
    open = wholesale.WholesaleTests.open
    sell = wholesale.WholesaleTests.sell

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        self.app.include_router(accounting_documents.router)
        self.db.add(CompanySettings(name="Test", vat_rate=0))
        self.customer = Customer(name="Client comptable")
        self.bank = BankAccount(bank_name="Banque comptable")
        self.db.add_all([self.customer, self.bank])
        self.db.commit()
        with self.engine.begin() as connection:
            seed_accounts(connection)

    def report(self, **filters):
        params = {"start": "2000-01-01", "end": "2099-12-31", **filters}
        response = self.client.get("/api/accounting/documents/report", params=params)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def mapping(self, key, account):
        self.call("/api/accounting/documents/mapping", "PUT", {"key": key, "account": account})

    def test_full_source_scenario_balances_cash_debts_and_profits(self):
        self.mapping("depense:Divers", "658")
        self.mapping("mouvement:in", "758")
        self.mapping("mouvement:out", "658")
        self.mapping(f"banque:{self.bank.id}", "521")
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Fournisseur comptable", "items": [{"product_id": self.product.id, "packaging_quantity": 10, "packaging_unit_cost": 960}]}, 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.db.expire_all()
        supplier_debt = self.db.query(Debt).filter_by(purchase_id=purchase["id"]).one()
        self.assertEqual(supplier_debt.amount, 9600)
        cash = self.sell([{"quantity": 2}])
        credit = self.call("/api/sales", "POST", {"customer_id": self.customer.id, "payment_method": "Crédit", "items": [{"product_id": self.product.id, "quantity": 3}]}, 201)
        self.db.expire_all()
        customer_debt = self.db.query(Debt).filter_by(sale_id=credit["id"]).one()
        self.call(f"/api/debts/{customer_debt.id}/paiements", "POST", {"amount": 50, "method": "Espèces"}, 201)
        self.call(f"/api/debts/{supplier_debt.id}/paiements", "POST", {"amount": 120, "method": "Espèces"}, 201)
        self.call("/api/returns", "POST", {"sale_reference": cash["reference"], "refund_method": "Espèces", "lines": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        self.call("/api/accounting/expenses", "POST", {"label": "Frais", "category": "Divers", "amount": 30, "payment_method": "Virement", "bank_account_id": self.bank.id}, 201)
        for kind, amount in (("in", 20), ("out", 10)):
            self.call("/api/cash-sessions/movements", "POST", {"type": kind, "amount": amount, "reason": "Pièce de test"})
        deposit = self.call("/api/bank/deposits", "POST", {"account_id": self.bank.id, "amount": 100, "method": "Espèces"}, 201)
        self.call(f"/api/bank/deposits/{deposit['id']}/decision", "POST", {"action": "valider"})
        result = self.report()
        self.assertEqual(result["unposted"], [])
        for entry in result["entries"]:
            self.assertAlmostEqual(sum(line["debit"] for line in entry["lines"]), sum(line["credit"] for line in entry["lines"]))
            self.assertTrue(entry["source_id"])
            self.assertEqual(entry["user_id"], self.user.id)
        self.assertEqual(result["totals"]["debit"], result["totals"]["credit"])
        balances = {row[0]: row[5] - row[6] for row in self.report(kind="balance")["rows"]}
        self.db.expire_all()
        self.assertEqual(balances["411"], customer_debt.remaining)
        self.assertEqual(-balances["401"], supplier_debt.remaining)
        self.assertEqual((balances["411"], balances["401"]), (250, -9480))
        self.assertEqual(sum(row[8] for row in self.report(kind="customers")["rows"]), 250)
        self.assertEqual(sum(row[8] for row in self.report(kind="suppliers")["rows"]), 9480)
        commercial = self.call("/api/accounting/summary")
        sales_journal = self.report(kind="sales")
        revenue = sum(line["credit"] - line["debit"] for line in sales_journal["lines"] if line["account"] in ("701", "709"))
        self.assertEqual(revenue, commercial["revenue"])
        self.assertEqual(revenue, 400)
        current = self.call("/api/cash-sessions/current")
        self.assertEqual(sum(line["debit"] for line in sales_journal["lines"] if line["account"] == "571"), current["cash_sales"])
        cash_flow = sum(line["debit"] - line["credit"] for line in self.report(kind="cash")["lines"])
        self.assertEqual(cash_flow + current["opening_balance"], current["expected_cash"])
        self.assertEqual(current["expected_cash"], 440)
        margins = self.report(kind="margins")
        expected = sum(financials(sale, item, {self.product.id: 40})["profit"] for sale in self.db.query(Sale) for item in sale.items)
        self.assertEqual(margins["summary"]["Bénéfice commercial"], expected)
        self.assertEqual(expected, 240)
        self.assertEqual(self.report()["entries"], result["entries"])

    def test_tax_snapshots_historical_declaration_and_opening(self):
        self.db.query(CompanySettings).update({"vat_rate": 18})
        self.db.commit()
        sale = self.sell([{"quantity": 2}], discount=20)
        journal = self.report(kind="sales")
        lines = journal["entries"][0]["lines"]
        self.assertAlmostEqual(next(l["credit"] for l in lines if l["account"] == "4431"), 27.46)
        self.assertTrue(any(l["account"] == "709" for l in lines))
        self.db.query(CompanySettings).update({"vat_rate": 0})
        self.db.commit()
        self.assertEqual(self.report(kind="sales")["entries"], journal["entries"])
        self.db.execute(text("UPDATE sales SET vat_rate_snapshot=NULL WHERE id=:id"), {"id": sale["id"]})
        self.db.commit()
        self.assertIn("TVA historique", self.report()["unposted"][0]["reason"])
        self.call("/api/accounting/documents/historical-tax", "PUT", {"rate": 0})
        self.assertEqual(self.report()["unposted"], [])
        self.assertIn(self.user.name, self.report()["footer"])
        self.assertIn("0.0 %", self.report()["footer"])
        self.db.expire_all()
        declared = self.db.get(AccountingSetting, "historical_tax")
        self.assertEqual(declared.changed_by_id, self.user.id)
        self.assertIsNotNone(declared.changed_at)
        future = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
        opening = self.report(kind="account", account="571", start=future)
        self.assertEqual(opening["rows"], [])
        self.assertEqual(opening["opening"]["571"], 180)
        self.call("/api/accounting/documents/historical-tax", "PUT", {"rate": None, "start": future})
        self.assertIn("date de début", self.report()["unposted"][0]["reason"])

    def test_missing_data_permissions_and_no_invented_payment(self):
        self.call("/api/accounting/expenses", "POST", {"label": "Ancienne dépense", "amount": 10}, 201)
        self.mapping("depense:Divers", "658")
        result = self.report()
        self.assertEqual(result["rows"], [])
        self.assertIn("Mode de paiement absent", result["unposted"][0]["reason"])
        self.db.add(Expense(label="Inconnu", category="Non liée", amount=20, payment_method="Crypto"))
        self.db.commit()
        self.assertEqual(len(self.report()["unposted"]), 2)
        self.mapping("depense:Non liée", "658")
        self.assertTrue(any("paiement:Crypto" in row["reason"] for row in self.report()["unposted"]))
        self.user.role = "vendeur"
        self.db.commit()
        self.call("/api/accounting/documents/report", status=403)
        self.call("/api/accounting/documents/config", status=403)
        self.grant("comptabilite_journaux_consulter")
        self.call("/api/accounting/documents/report")
        self.call("/api/accounting/documents/report?export=true", status=403)
        self.call("/api/accounting/documents/mapping", "PUT", {"key": "ventes", "account": "701"}, 403)
        self.grant("plan_comptable_modifier", "comptabilite_journaux_imprimer")
        self.call("/api/accounting/documents/report?export=true")
        self.call("/api/accounting/documents/historical-tax", "PUT", {"rate": 0}, 403)

    def test_accounts_immutable_history_and_manual_linking(self):
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Grossiste", "items": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.db.expire_all()
        debt = self.db.query(Debt).filter_by(purchase_id=purchase["id"]).one()
        debt.purchase_id = None
        self.db.commit()
        self.call(f"/api/accounting/documents/debts/{debt.id}/purchase", "PUT", {"purchase_id": purchase["id"]})
        self.call(f"/api/accounting/documents/debts/{debt.id}/purchase", "PUT", {"purchase_id": purchase["id"]}, 409)
        account = {"number": "6581", "label": "Charge test", "class_number": 6, "type": "charge"}
        self.call("/api/accounting/documents/accounts", "POST", account, 201)
        self.call("/api/accounting/documents/accounts", "POST", account, 409)
        self.call("/api/accounting/documents/accounts/6581", "PUT", {**account, "label": "Renommée", "active": False})
        self.call("/api/accounting/documents/mapping", "PUT", {"key": "depense:Divers", "account": "6581"}, 400)
        self.call("/api/accounting/documents/accounts/701", "DELETE", status=405)
        self.call("/api/accounting/documents/mapping", "PUT", {"key": "depense:Divers", "account": "701"}, 400)
        self.call("/api/accounting/documents/mapping", "PUT", {"key": "historical_tax", "account": "701"}, 400)
        self.db.expire_all()
        self.assertTrue(self.db.query(SecurityLog).filter(SecurityLog.event == "comptabilite_liaison").count())
        self.assertEqual(self.db.get(AccountingAccount, "6581").label, "Renommée")

    def test_empty_filters_cancelled_sources_and_stock_snapshot(self):
        self.assertEqual(self.report()["rows"], [])
        self.assertEqual(self.report()["totals"], {"debit": 0, "credit": 0})
        sale = self.sell([{"quantity": 1}])
        self.db.query(Sale).filter_by(id=sale["id"]).update({"status": "Annulée"})
        self.db.commit()
        self.assertEqual(self.report()["entries"], [])
        stock = self.report(kind="stock")
        self.assertEqual(stock["summary"]["Valeur totale du stock"], 199 * 40)
        self.assertIn("actuels", stock["footer"])
        self.call("/api/accounting/documents/report?start=2030-01-01&end=2000-01-01", status=400)
        self.call("/api/accounting/documents/report?kind=account", status=400)

    def test_seed_and_additive_migration_preserve_existing_rows_and_rights(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE expenses(id INTEGER PRIMARY KEY, label TEXT, amount FLOAT)"))
            connection.execute(text("INSERT INTO expenses VALUES(42, 'Historique', 125)"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        with engine.begin() as connection:
            self.assertEqual(connection.execute(text("SELECT id,label,amount,payment_method,bank_account_id FROM expenses")).one(), (42, "Historique", 125, None, None))
            self.assertEqual(connection.execute(text("SELECT COUNT(*) FROM app_migrations WHERE name='accounting_syscohada_v1'")).scalar(), 1)
        self.assertIn("accounting_accounts", inspect(engine).get_table_names())
        self.user.role = "gestionnaire"
        self.db.commit()
        self.call("/api/accounting/documents/report", status=403)
        self.call("/api/accounting/documents/accounts", "POST", {"number": "999", "label": "Non", "class_number": 9}, 403)

    def test_prepayments_store_credit_and_unknown_origins(self):
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Fournisseur", "paid": 10, "payment_method": "Espèces", "items": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        self.assertEqual([e["source_type"] for e in self.report()["entries"]], ["purchase_payment"])
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        balances = {r[0]: r[5] - r[6] for r in self.report(kind="balance")["rows"]}
        self.assertEqual(balances["4091"], 0)
        self.assertEqual(balances["401"], -30)
        sale = self.call("/api/sales", "POST", {"customer_id": self.customer.id, "payment_method": "Crédit", "items": [{"product_id": self.product.id, "quantity": 2}]}, 201)
        self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "refund_method": "Avoir", "lines": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        balances = {r[0]: r[5] - r[6] for r in self.report(kind="balance")["rows"]}
        self.assertEqual(balances["411"], 200)
        self.assertEqual(balances["4191"], -100)
        self.db.add(Debt(kind="creance", party="Solde ancien sans pièce", amount=123))
        self.db.commit()
        self.assertTrue(any(e["source_type"] == "debt" for e in self.report()["unposted"]))

    def test_missing_method_does_not_become_a_bank_payment_and_unknown_dates_are_visible(self):
        self.mapping("depense:Divers", "658")
        self.mapping(f"banque:{self.bank.id}", "521")
        self.call("/api/accounting/expenses", "POST", {"label": "Incomplet", "amount": 5, "bank_account_id": self.bank.id}, 201)
        result = self.report()
        self.assertEqual(result["entries"], [])
        self.assertIn("Mode de paiement absent", result["unposted"][0]["reason"])
        self.db.add(Purchase(reference="HISTORIQUE", status="Reçu", received_at=None, total=50))
        self.db.commit()
        self.assertTrue(any(e["reason"] == "Date source absente" for e in self.report()["unposted"]))
