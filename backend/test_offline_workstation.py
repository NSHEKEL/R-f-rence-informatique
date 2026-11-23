import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


@unittest.skipUnless(sys.platform == "win32", "Scénario réel poste Windows / DPAPI")
class WorkstationRestartTests(unittest.TestCase):
    def setUp(self):
        self.root = Path.home() / "rapport" / ("21842-scenario-" + uuid.uuid4().hex[:8])
        self.root.mkdir(parents=True)
        self.ports = {}
        self.processes = {}
        for role in ("server", "poste"):
            (self.root / role).mkdir()
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                self.ports[role] = probe.getsockname()[1]
        self.nonce = ""
        self.addCleanup(self.shutdown)

    def shutdown(self):
        for role in list(self.processes):
            self.stop(role)

    def start(self, role):
        env = {**os.environ, "DATABASE_URL": "sqlite:///" + (self.root / role / "business.sqlite3").as_posix(),
               "EASYGEST_DATA_DIR": str(self.root / role), "EASYGEST_OFFLINE_HOME": str(self.root / role / "offline"),
               "EASYGEST_CENTRAL_URL": "", "SECRET_KEY": "offline-scenario-only-" + role, "PYTHONUNBUFFERED": "1"}
        output = open(self.root / (role + ".log"), "ab")
        self.addCleanup(output.close)
        self.processes[role] = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(self.ports[role]), "--log-level", "warning"], env=env, cwd=Path(__file__).parent, stdout=output, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            try:
                self.http(role, "/health")
                break
            except Exception:
                if self.processes[role].poll() is not None:
                    self.fail((self.root / (role + ".log")).read_text(errors="replace")[-5000:])
                time.sleep(0.1)
        else:
            self.fail("Démarrage non prêt : " + str(self.root / (role + ".log")))
        if role == "poste":
            self.nonce = self.http(role, "/local-offline/bootstrap", {})["nonce"]

    def stop(self, role):
        process = self.processes.pop(role, None)
        if process:
            process.terminate()
            process.wait(timeout=15)

    def http(self, role, path, data=None, token=None, method=None):
        origin = f"http://127.0.0.1:{self.ports[role]}"
        headers = {"Content-Type": "application/json", "Origin": origin}
        if token:
            headers["Authorization"] = "Bearer " + token
        if self.nonce:
            headers["X-Easygest-Offline"] = self.nonce
        request = urllib.request.Request(origin + "/api" + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        with urllib.request.urlopen(request, timeout=35) as response:
            return json.load(response)

    def command(self, action, **params):
        return self.http("poste", "/local-offline/command", {"action": action, "params": params})

    def test_offline_scan_resolves_primary_secondary_and_packaging_from_signed_catalogue(self):
        self.start("server")
        self.start("poste")
        server = f"http://127.0.0.1:{self.ports['server']}"
        admin = self.http("server", "/auth/login", {"email": "admin", "password": "admin123"})["access_token"]
        identity = self.http("server", "/offline/identity", token=admin)
        self.command("login", server=server, email="admin", password="admin123", trusted_fingerprint=identity["fingerprint"])
        self.http("server", "/users", {"email": "scanner@test.invalid", "name": "Vendeur scan", "password": "scanner-test-password", "role": "vendeur"}, admin)
        codes = ("1234567890123", "VAR/456", "PACK-789")
        product = self.http("server", "/products", {"name": "Article scan hors ligne", "sku": "SCAN-SKU", "barcode": codes[0], "quantity": 100, "sale_price": 1000,
            "barcodes": [{"code": codes[1], "label": "Variante", "active": True}, {"code": "INACTIVE-456", "active": False}],
            "packagings": [{"name": "Carton", "barcode": codes[2], "factor": 6, "price_detail": 5000, "active": True}]}, admin)
        self.command("login", server=server, email="scanner@test.invalid", password="scanner-test-password", trusted_fingerprint=identity["fingerprint"])
        snapshot = self.command("catalogue", images=True)
        cached = next(row for row in snapshot["data"] if row["id"] == product["id"])
        self.assertEqual(cached["barcode"], codes[0])
        self.assertTrue(any(row["code"] == codes[1] for row in cached["barcodes"]))
        self.assertTrue(any(row["barcode"] == codes[2] for row in cached["packagings"]))
        print("OFFLINE_SCAN_SNAPSHOT primary=True secondary=True packaging=True images_cache_only=True", flush=True)
        self.stop("server")
        self.command("sync")
        with self.assertRaises(urllib.error.HTTPError) as no_till:
            self.command("request", method="GET", path="/products/by-code/" + codes[0])
        self.assertEqual(no_till.exception.code, 409)
        self.command("request", method="POST", path="/cash-sessions/open", data={"opening_balance": 170000})
        statuses = []
        for code in codes:
            try:
                row = self.command("request", method="GET", path="/products/by-code/" + urllib.parse.quote(code, safe=""))
                statuses.append(200)
                self.assertEqual((row["id"], row["scanned_code"]), (product["id"], code))
                self.assertNotIn("quantity", row)
                if code == codes[1]:
                    self.assertEqual(row["scanned_label"], "Variante")
                if code == codes[2]:
                    self.assertEqual(row["packaging_id"], cached["packagings"][0]["id"])
            except urllib.error.HTTPError as error:
                statuses.append(error.code)
        print("OFFLINE_SCAN_HTTP " + json.dumps(dict(zip(codes, statuses))), flush=True)
        self.assertEqual(statuses, [200, 200, 200])
        for code in ("UNKNOWN-123", "INACTIVE-456"):
            with self.assertRaises(urllib.error.HTTPError) as missing:
                self.command("request", method="GET", path="/products/by-code/" + code)
            self.assertEqual(missing.exception.code, 404)

    def test_cold_start_two_sales_restarts_exactly_once_and_revocation(self):
        self.start("server")
        self.start("poste")
        server = f"http://127.0.0.1:{self.ports['server']}"
        original_device = self.http("poste", "/local-offline/bootstrap", {})["device_id"]
        admin = self.http("server", "/auth/login", {"email": "admin", "password": "admin123"})["access_token"]
        self.assertEqual(self.http("server", "/settings/company", token=admin)["offline_authorization_hours"], 24)
        self.http("server", "/settings/company", {"offline_authorization_hours": 168}, admin, "PUT")
        identity = self.http("server", "/offline/identity", token=admin)
        self.command("login", server=server, email="admin", password="admin123", trusted_fingerprint=identity["fingerprint"])
        self.http("server", "/users", {"email": "offline-seller@test.invalid", "name": "Vendeur hors ligne test", "password": "offline-test-password", "role": "vendeur"}, admin)
        product = self.http("server", "/products", {"name": "Lait test hors ligne", "sku": "OFFLINE-REAL-TEST", "quantity": 10, "base_unit": "kg", "sale_price": 3500}, admin)
        online = self.command("login", server=server, email="offline-seller@test.invalid", password="offline-test-password")
        self.assertTrue(online["offline_ready"])
        self.assertGreater(online["expires_at"] - time.time(), 167 * 3600)
        catalogue = self.command("catalogue", images=False)
        self.assertTrue(any(row["id"] == product["id"] for row in catalogue["data"]))
        self.stop("server")
        self.stop("poste")
        cold_at = time.monotonic()
        self.start("poste")
        self.assertTrue(self.http("poste", "/local-offline/bootstrap", {})["locked"])
        login = self.command("login", server=server, email="offline-seller@test.invalid", password="offline-test-password")
        self.assertTrue(login["offline"])
        self.assertLess(time.monotonic() - cold_at, 15)
        provisional = self.command("request", method="POST", path="/cash-sessions/open", data={"opening_balance": 500})
        self.assertLess(provisional["id"], 0)
        ids = []
        for method, quantity in (("Mobile Money", 1), ("Espèces", 0.5)):
            client_id = str(uuid.uuid4())
            ids.append(client_id)
            receipt = self.command("sale", payload={"client_id": client_id, "cash_session_id": provisional["id"], "payment_method": method, "status": "Payée", "items": [{"product_id": product["id"], "quantity": quantity, "unit_price": 3500}]}, snapshot={"reference": "ORIGINAL-RECEIPT", "total": quantity * 3500, "items": []})
            self.assertEqual(receipt["total"], quantity * 3500)
        self.stop("poste")
        self.start("poste")
        self.command("login", server=server, email="offline-seller@test.invalid", password="offline-test-password")
        before = self.command("request", method="GET", path="/cash-sessions/current")
        self.assertLess(before["id"], 0)
        self.assertEqual(len(self.command("state")["pending"]), 3)
        self.start("server")
        self.assertEqual(self.http("poste", "/local-offline/bootstrap", {})["device_id"], original_device)
        alias_login = self.command("login", server=server.replace("127.0.0.1", "localhost"), email="offline-seller@test.invalid", password="offline-test-password")
        self.assertTrue(alias_login["offline_ready"])
        self.assertEqual(self.command("state")["pending"], [])
        print("REAL_SELLER_UPGRADE_RECOVERY_OK same_device=True trusted_alias_reused=True replayed_before_login_returns=True")
        for _ in range(3):
            self.command("sync")
        admin = self.http("server", "/auth/login", {"email": "admin", "password": "admin123"})["access_token"]
        sales = self.http("server", "/sales", token=admin)
        self.assertEqual(len(sales), 2)
        with sqlite3.connect(self.root / "server" / "business.sqlite3") as db:
            self.assertEqual(db.execute("SELECT count(*) FROM sales WHERE client_id IN (?,?)", ids).fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT quantity FROM products WHERE id=?", (product["id"],)).fetchone()[0], 8.5)
            self.assertEqual(db.execute("SELECT count(*) FROM offline_sessions WHERE cash_session_id IS NOT NULL").fetchone()[0], 1)
        self.assertEqual(self.command("state")["pending"], [])
        adopted = self.command("request", method="GET", path="/cash-sessions/current")
        self.assertEqual(adopted["provisional_uuid"], before["provisional_uuid"])
        self.assertIsNone(adopted["closed_at"])
        self.assertEqual(adopted["opened_by"]["id"], online["user"]["id"])
        self.assertTrue(self.command("state")["journal_session"])
        with sqlite3.connect(self.root / "server" / "business.sqlite3") as db:
            self.assertEqual(db.execute("SELECT count(*), opening_balance FROM cash_sessions").fetchone(), (1, 500))
        self.stop("server")
        self.command("sync")
        third_id = str(uuid.uuid4())
        self.command("sale", payload={"client_id": third_id, "cash_session_id": adopted["id"], "payment_method": "Espèces", "status": "Payée", "items": [{"product_id": product["id"], "quantity": 0.5, "unit_price": 3500}]}, snapshot={"reference": "BEFORE-REVOCATION", "total": 1750})
        self.assertEqual(len(self.command("state")["pending"]), 1)
        with sqlite3.connect(self.root / "server" / "business.sqlite3") as db:
            db.execute("UPDATE users SET is_active=0 WHERE email=?", ("offline-seller@test.invalid",))
            db.commit()
        self.start("server")
        result = self.command("sync")
        self.assertTrue(result["locked"])
        self.assertTrue(any(row["id"] == third_id for row in result["pending"]))
        with sqlite3.connect(self.root / "server" / "business.sqlite3") as db:
            self.assertEqual(db.execute("SELECT count(*) FROM sales WHERE client_id=?", (third_id,)).fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT state FROM offline_events WHERE id=?", (third_id,)).fetchone()[0], "conflict")
        print("REAL_POSTE_COLD_START_OK server_off_during_entire_launch=True durable_sales=2 replay_count=3 final_sales=2 stock=8.5 provisional_sessions_reconciled=1 opening_float_preserved=500 no_reopen_prompt=True same_provisional_identity=True disabled_account_locked=True pending_sale_preserved=True")
        print("SCENARIO_EVIDENCE=" + str(self.root))

    def test_server_local_journal_recovers_before_login_with_changed_port_and_no_duplicates(self):
        from app.offline_broker import OfflineBroker

        self.start("server")
        old_server = f"http://127.0.0.1:{self.ports['server']}"
        admin = self.http("server", "/auth/login", {"email": "admin", "password": "admin123"})["access_token"]
        self.http("server", "/users", {"email": "hawa@test.invalid", "name": "HAWA", "password": "recovery-test-password", "role": "admin"}, admin)
        identity = self.http("server", "/offline/identity", token=admin)
        product = self.http("server", "/products", {"name": "Lait reprise locale", "sku": "LOCAL-RECOVERY", "quantity": 10, "base_unit": "kg", "sale_price": 3500}, admin)
        broker = OfflineBroker(self.root / "server" / "offline")
        account = broker.login(old_server, "hawa@test.invalid", "recovery-test-password", identity["fingerprint"])
        device = broker.bootstrap()["device_id"]
        broker.catalogue(False)
        self.stop("server")
        broker.login(old_server, "hawa@test.invalid", "recovery-test-password")
        till = broker.request("POST", "/cash-sessions/open", {"opening_balance": 170000})
        ids = [str(uuid.uuid4()), str(uuid.uuid4())]
        for client_id, quantity, payment in zip(ids, (1, 0.5), ("Mobile Money", "Espèces")):
            broker.sale({"client_id": client_id, "cash_session_id": till["id"], "payment_method": payment, "status": "Payée", "items": [{"product_id": product["id"], "quantity": quantity, "unit_price": 3500}]}, {"total": quantity * 3500})
        self.assertEqual(len(broker.state()["pending"]), 3)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.ports["server"] = probe.getsockname()[1]
        self.start("server")
        token = self.http("server", "/auth/login", {"email": "hawa@test.invalid", "password": "recovery-test-password"})["access_token"]
        self.assertIsNone(self.http("server", "/cash-sessions/current", token=token))
        self.assertEqual(self.http("server", "/sales", token=token), [])
        self.nonce = self.http("server", "/local-offline/bootstrap", {})["nonce"]
        self.assertEqual(self.http("server", "/local-offline/bootstrap", {})["device_id"], device)
        self.assertEqual(self.http("server", "/local-offline/recover", {}, token)["recovered"], 3)
        restored = self.http("server", "/cash-sessions/current", token=token)
        self.assertEqual(restored["opened_by"]["id"], account["user"]["id"])
        self.assertEqual(restored["opening_balance"], 170000)
        self.assertEqual(restored["sales_count"], 2)
        self.assertEqual(restored["total_sales"], 5250)
        self.assertIsNone(restored["closed_at"])
        self.assertEqual(self.http("server", "/local-offline/recover", {}, token)["recovered"], 0)
        with self.assertRaises(urllib.error.HTTPError) as duplicate:
            self.http("server", "/cash-sessions/open", {"opening_balance": 170000}, token)
        self.assertEqual(duplicate.exception.code, 400)
        detail = json.load(duplicate.exception)["detail"]
        self.assertEqual(detail, "Votre caisse est déjà ouverte")
        print("REAL_OPEN_EXISTING_HTTP status=400 detail=" + detail)
        with sqlite3.connect(self.root / "server" / "business.sqlite3") as db:
            self.assertEqual(db.execute("SELECT count(*) FROM sales WHERE client_id IN (?,?)", ids).fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT count(*), opening_balance FROM cash_sessions").fetchone(), (1, 170000))
            self.assertEqual(db.execute("SELECT quantity FROM products WHERE id=?", (product["id"],)).fetchone()[0], 8.5)
        self.assertEqual(broker.state()["pending"], [])
        with broker.store.connection() as journal:
            broker.store.append(journal, "another-shop", account["user"]["id"], str(uuid.uuid4()), "open", {"opening_balance": 1}, "not-a-grant")
            malformed = broker.store.append(journal, identity["shop_id"], account["user"]["id"], str(uuid.uuid4()), "open", {"opening_balance": 1}, "not-a-grant")
        with self.assertRaises(urllib.error.HTTPError) as invalid:
            self.http("server", "/local-offline/recover", {}, token)
        self.assertEqual(invalid.exception.code, 409)
        self.assertIn("ne rouvrez pas", json.load(invalid.exception)["detail"])
        with broker.store.connection() as journal:
            self.assertEqual(len(broker.store.events(journal, "another-shop", pending=True)), 1)
            self.assertTrue(any(row["envelope"]["event"]["id"] == malformed["event"]["id"] for row in broker.store.events(journal, identity["shop_id"], pending=True)))
        print("REAL_SERVER_UPGRADE_RECOVERY_OK old_url_unreachable=True restored_sales=2 stock=8.5 sessions=1 opening_float=170000 same_user=True same_device=True replayed_once=True foreign_shop_untouched=True invalid_event_retained=True")
        print("SCENARIO_EVIDENCE=" + str(self.root))

    def test_online_open_till_is_adopted_after_disconnect_and_sale_is_journaled(self):
        self.start("server")
        self.start("poste")
        server = f"http://127.0.0.1:{self.ports['server']}"
        admin = self.http("server", "/auth/login", {"email": "admin", "password": "admin123"})["access_token"]
        identity = self.http("server", "/offline/identity", token=admin)
        online = self.command("login", server=server, email="admin", password="admin123", trusted_fingerprint=identity["fingerprint"])
        product = self.http("server", "/products", {"name": "Lait caisse existante", "sku": "ADOPT-ONLINE-TILL", "quantity": 1, "base_unit": "kg", "sale_price": 3500}, admin)
        self.command("catalogue", images=False)
        device = self.http("poste", "/local-offline/bootstrap", {})["device_id"]
        request = urllib.request.Request(server + "/api/cash-sessions/open", data=json.dumps({"opening_balance": 500}).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + online["access_token"], "X-Workstation-Name": device}, method="POST")
        with urllib.request.urlopen(request, timeout=35) as response:
            original = json.load(response)
        self.assertGreater(original["id"], 0)
        self.assertTrue(self.command("remember", path="/cash-sessions/current", data=original, access_token=online["access_token"])["cached"])
        self.stop("server")
        operation = str(uuid.uuid4())
        receipt = self.command("sale", payload={"client_id": operation, "cash_session_id": original["id"], "payment_method": "Espèces", "status": "Payée", "items": [{"product_id": product["id"], "quantity": 0.5, "unit_price": 3500}]}, snapshot={"total": 1750})
        self.assertEqual(receipt["total"], 1750)
        self.assertTrue(any(row["id"] == operation for row in self.command("state")["pending"]))
        adopted = self.command("request", method="GET", path="/cash-sessions/current")
        self.assertLess(adopted["id"], 0)
        self.assertEqual(adopted["opening_balance"], 500)
        self.start("server")
        self.command("sync")
        self.command("sync")
        with sqlite3.connect(self.root / "server" / "business.sqlite3") as db:
            self.assertEqual(db.execute("SELECT count(*) FROM cash_sessions").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT cash_session_id, total FROM sales WHERE client_id=?", (operation,)).fetchone(), (original["id"], 1750))
            self.assertEqual(db.execute("SELECT quantity FROM products WHERE id=?", (product["id"],)).fetchone()[0], 0.5)
        print("REAL_ONLINE_TILL_DISCONNECT_OK positive_till_id_accepted=True sale_journaled=True total=1750 stock=0.5 same_server_session=True replayed_once=True opening_float_preserved=500")
        print("SCENARIO_EVIDENCE=" + str(self.root))
