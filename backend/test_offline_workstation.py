import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
import unittest
import urllib.error
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

    def test_cold_start_two_sales_restarts_exactly_once_and_revocation(self):
        self.start("server")
        self.start("poste")
        server = f"http://127.0.0.1:{self.ports['server']}"
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
