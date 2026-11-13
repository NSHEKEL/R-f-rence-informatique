import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

import test_treasury_permissions as treasury
from app import migrate as migration
from app.auth import get_current_user, create_access_token
from app.database import get_db
from app.models import CompanySettings, Product, SecurityLog, User
from app.permissions import PERMISSIONS, role_matrix, save_matrix
from app.routers import backups, fne, permissions, security, settings, updates, users
from app import network


class SettingsPermissionTests(unittest.TestCase):
    grant = treasury.TreasuryPermissionsTests.grant

    def setUp(self):
        treasury.TreasuryPermissionsTests.setUp(self)
        user_id = self.user.id

        def request_user(db=Depends(get_db)):
            return db.get(User, user_id)

        self.app.dependency_overrides[get_current_user] = request_user
        for router in (settings.router, backups.router, fne.router, permissions.router, users.router, updates.router, security.router, network.router):
            self.app.include_router(router)
        self.client = TestClient(self.app)
        self.client.headers["Authorization"] = "Bearer " + create_access_token(self.user)
        self.addCleanup(self.client.close)
        self.features = patch("app.licensing.effective", return_value=SimpleNamespace(blocked=False, allows=lambda code: True, message="", plan_name="Test")).start()
        self.addCleanup(patch.stopall)
        self.company = CompanySettings(name="Boutique", smtp_host="smtp.invalid", smtp_user="private", smtp_password="private-password", backup_dir="private-backup", drive_account_email="private-drive", drawer_enabled=True, drawer_port="COM1", drawer_code="27,112,0,25,250")
        self.db.add(self.company)
        self.product = Product(name="Article", sku="SETTINGS", sale_price=100, purchase_price=40)
        self.db.add(self.product)
        self.db.commit()

    def check(self, method, path, status=200, **kwargs):
        result = self.client.request(method, "/api" + path, **kwargs)
        self.assertEqual(result.status_code, status, (path, result.text))
        return result

    def test_poste_seller_and_sensitive_redaction(self):
        self.grant("poste_consulter", "poste_modifier", "peripheriques_consulter", "peripheriques_modifier")
        save_matrix(self.db, {"vendeur": {"vente_nouvelle": False}})
        public = self.check("GET", "/settings/company").json()
        self.assertEqual(public["name"], "Boutique")
        for key in ("smtp_host", "smtp_user", "backup_dir", "drive_account_email"):
            self.assertEqual(public[key], "", key)
        self.assertNotIn("smtp_password", public)
        with patch.object(settings.printing, "printer_devices", return_value=[]), patch.object(settings.printing, "default_printer", return_value=""):
            self.check("GET", "/settings/printers")
        with patch.object(settings.printing, "queue_status", return_value={"name": "Ticket"}), patch.object(settings.printing, "open_preferences") as prefs:
            self.check("POST", "/settings/printers/preferences", json={"name": "Ticket"})
            prefs.assert_called_once_with("Ticket")
        with patch.object(settings.printing, "queue_status", return_value=SimpleNamespace(available=True, status="Prête", jobs=0)), patch("app.escpos.send") as send:
            self.check("POST", "/settings/printers/test", json={"printer_name": "Ticket"})
            self.assertEqual(send.call_args.args[1], "Ticket")
        with patch.object(settings.drawer, "open_drawer", return_value="COM2") as drawer:
            self.check("POST", "/settings/company/open-drawer", json={"drawer_port": "COM2", "drawer_code": "27,112,0,1,1"})
            self.assertEqual(drawer.call_args.args[0].drawer_port, "COM2")
            self.assertEqual(drawer.call_args.args[0].drawer_code, "27,112,0,1,1")
        self.db.expire_all()
        self.assertEqual(self.db.get(CompanySettings, self.company.id).drawer_port, "COM1")
        for method, path, payload in [("PUT", "/settings/company", {"name": "Forbidden"}), ("GET", "/fne/settings", None), ("PUT", "/fne/settings", {}), ("GET", "/backups", None), ("POST", "/backups", None), ("GET", "/backups/drive/status", None), ("POST", "/backups/drive/client", {}), ("GET", "/users", None), ("POST", "/users", {}), ("GET", "/permissions", None), ("PUT", "/permissions", {"matrix": {}}), ("PUT", "/settings/printing", {}), ("POST", "/settings/printers/default", {"name": "Ticket"}), ("PUT", "/settings/pos-display", {}), ("GET", "/updates", None), ("POST", "/updates/install", None)]:
            with self.subTest(path=path, method=method):
                self.check(method, path, 403, json=payload)

    def test_manager_denied_and_legacy_sales_exception_drawer_permission(self):
        self.user.role = "gestionnaire"
        self.db.commit()
        for path in ("/settings/printing", "/settings/pos-display", "/settings/printers", "/settings/catalog", "/fne/settings", "/backups", "/backups/drive/files", "/users", "/permissions", "/updates"):
            self.check("GET", path, 403)
        self.check("POST", "/settings/company/open-drawer", 403)
        self.user.role = "vendeur"
        self.db.commit()
        self.check("GET", "/settings/printing")
        self.check("GET", "/settings/pos-display")
        self.check("POST", "/settings/company/open-drawer", 403)
        self.grant("caisse_operations")
        with patch.object(settings.drawer, "open_drawer", return_value="COM1") as drawer:
            self.check("POST", "/settings/company/open-drawer")
            self.assertEqual(drawer.call_args.args[0].drawer_port, "COM1")

    def test_category_writes_are_atomic_and_do_not_cross_boundaries(self):
        self.grant("generaux_consulter", "generaux_modifier")
        self.check("PUT", "/settings/company", json={"name": "Authorized"})
        for foreign in ({"vat_rate": 18}, {"drawer_port": "COM9"}, {"backup_dir": "no"}, {"receipt_header": "no"}, {"network_restrict_workstations": True}, {"expiry_alert_days": 99}):
            self.check("PUT", "/settings/company", 403, json={"name": "Must rollback", **foreign})
        self.db.expire_all()
        self.assertEqual(self.db.get(CompanySettings, self.company.id).name, "Authorized")
        output = self.check("GET", "/settings/company").json()
        self.assertEqual(output["smtp_user"], "private")
        self.assertNotIn("smtp_password", output)
        self.assertEqual(output["backup_dir"], "")

    def test_admin_and_permission_audit_and_plan_gates(self):
        self.user.role = "admin"
        self.db.commit()
        output = self.check("GET", "/settings/company").json()
        self.assertEqual(output["backup_dir"], "private-backup")
        self.check("PUT", "/settings/company", json={"name": "Admin", "vat_rate": 18, "receipt_header": "Ticket", "backup_keep": 5})
        self.check("GET", "/settings/printing")
        self.check("GET", "/fne/settings")
        self.check("GET", "/users")
        self.check("GET", "/permissions")
        payload = {"matrix": {"vendeur": {"poste_consulter": True, "generaux_modifier": False}}}
        self.check("PUT", "/permissions", json=payload)
        self.check("PUT", "/permissions", json=payload)
        rows = self.db.query(SecurityLog).filter_by(event="permission_modifiee").all()
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0].user_id, rows[0].identifier), (self.user.id, self.user.email))
        self.assertIn("role=vendeur; key=poste_consulter; false → true", rows[0].detail)
        self.check("PUT", "/permissions", json={"matrix": {"vendeur": {"poste_consulter": False}}})
        self.assertEqual(self.db.query(SecurityLog).filter_by(event="permission_modifiee").count(), 2)
        self.features.return_value.allows = lambda code: False
        self.check("GET", "/permissions", 403)
        self.check("GET", "/users", 403)
        self.check("POST", "/backups/restore", 403)

    def test_restore_requires_both_modify_and_restore(self):
        self.grant("sauvegarde_consulter", "sauvegarde_modifier")
        self.check("POST", "/backups/restore", 403)
        self.grant("parametres_sauvegarde_restaurer")
        with patch.object(backups.backup, "schedule_restore") as restore:
            self.check("POST", "/backups/restore", 400)
            restore.assert_not_called()
        self.features.return_value.allows = lambda code: False
        self.check("POST", "/backups/restore", 403)

    def test_catalog_price_normal_empty_invalid_and_permission(self):
        path = f"/settings/catalog/{self.product.id}"
        self.check("PUT", path, 403, json={"sale_price": 120})
        self.grant("tarifs_consulter", "tarifs_modifier")
        self.assertIsNone(self.check("GET", "/settings/catalog").json()[0]["quantity"])
        self.assertIsNone(self.check("PUT", path, json={"sale_price": 120, "semi_wholesale_min_qty": 24}).json()["quantity"])
        self.check("PUT", path, json={})
        for payload in ({"sale_price": -1}, {"sale_price": None}, {"wholesale_min_qty": 1.5}, {"wholesale_min_qty": 0}, {"quantity": 99}, {"sale_price": 130, "purchase_price": -1}):
            self.check("PUT", path, 400, json=payload)
        self.check("PUT", "/settings/catalog/999999", 404, json={})
        self.db.expire_all()
        self.assertEqual(self.db.get(Product, self.product.id).sale_price, 120)

    def test_shared_printing_and_cash_settings_do_not_bypass_categories(self):
        self.grant("imprimantes_consulter", "imprimantes_modifier")
        config = self.check("GET", "/settings/printing").json()
        config["receipt"]["font_size"] = 12
        self.check("PUT", "/settings/printing", json=config)
        config["receipt"]["auto_print"] = False
        self.check("PUT", "/settings/printing", 403, json=config)
        self.grant("caisse_modifier")
        for enabled in (False, True):
            self.check("PUT", "/settings/company", json={"auto_print_cash": enabled, "drawer_open_after_sale": enabled})
            saved = self.check("GET", "/settings/printing").json()
            self.assertEqual(saved["receipt"]["auto_print"], enabled)
            self.assertEqual(saved["receipt"]["open_drawer"], enabled)

    def test_native_loopback_updates_and_browser_remote_guards(self):
        with TestClient(self.app, client=("127.0.0.1", 1234)) as local, patch.object(updates, "latest_release", side_effect=updates.UpdateError("offline")):
            self.assertEqual(local.get("/api/updates").status_code, 200)
            for headers in ({"Origin": "http://localhost:8000"}, {"Sec-Fetch-Site": "same-origin"}):
                self.assertEqual(local.get("/api/updates", headers=headers).status_code, 401)
            self.assertEqual(self.client.get("/api/updates").status_code, 403)
            self.grant("generaux_consulter")
            self.assertEqual(self.client.get("/api/updates").status_code, 200)
        with TestClient(self.app, client=("::1", 1234)) as local, patch.object(updates, "latest_release", return_value=SimpleNamespace(version="v9")), patch.object(updates, "update_available", return_value=True), patch.object(updates.backup, "create"), patch.object(updates, "install") as install, patch.object(updates, "shutdown_soon"):
            self.assertEqual(local.post("/api/updates/install").status_code, 200)
            install.assert_called_once()
            self.assertEqual(local.post("/api/updates/install", headers={"Origin": "http://localhost:8000"}).status_code, 401)
            self.assertEqual(self.client.post("/api/updates/install").status_code, 403)

    def test_consult_only_users_and_admin_only_network_security(self):
        self.grant("utilisateurs_consulter")
        self.check("GET", "/users")
        self.check("GET", "/permissions")
        self.check("POST", "/users", 403, json={})
        self.check("PUT", "/permissions", 403, json={"matrix": {}})
        self.check("PUT", "/users/me/photo", json={"photo": ""})
        self.grant(*(key for key, (_, section) in PERMISSIONS.items() if section == "Paramètres"))
        self.check("GET", "/network/workstations", 403)
        self.check("GET", "/securite/journal", 403)
        self.check("PUT", "/settings/company", 403, json={"network_restrict_workstations": True})

    def test_legacy_database_grants_none_of_the_settings_rights(self):
        engine = create_engine(f"sqlite:///{self.temp.name}/old.db")
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE role_permissions (id INTEGER PRIMARY KEY, role VARCHAR NOT NULL, permission VARCHAR NOT NULL, allowed BOOLEAN)"))
            conn.execute(text("INSERT INTO role_permissions (role,permission,allowed) VALUES ('vendeur','vente_nouvelle',1)"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        from sqlalchemy.orm import Session
        with Session(engine) as db:
            matrix = role_matrix(db)
            keys = [key for key, (_, section) in PERMISSIONS.items() if section == "Paramètres"]
            self.assertEqual(len(keys), 21)
            for role in ("vendeur", "gestionnaire"):
                self.assertFalse(any(matrix[role][key] for key in keys))
            self.assertTrue(matrix["vendeur"]["vente_nouvelle"])


if __name__ == "__main__":
    unittest.main()
