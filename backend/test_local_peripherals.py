import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from fastapi import Depends, FastAPI
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import ALGORITHM, SECRET_KEY, create_access_token
from app.database import Base, get_db
from app.models import User
from app.permissions import require_any_permission
from app.routers import settings


class LocalPeripheralTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.addCleanup(engine.dispose)
        self.addCleanup(self.db.close)
        self.user = User(name="Local", email="local@example.test", role="admin", hashed_password="local-password-hash", is_active=True)
        self.db.add(self.user)
        self.db.commit()
        self.app = FastAPI()
        self.app.dependency_overrides[get_db] = lambda: self.db
        self.app.include_router(settings.router)

        @self.app.get("/before")
        def before(_=Depends(require_any_permission("imprimantes_consulter"))):
            return {"ok": True}

        self.foreign = jwt.encode({"sub": "1", "pwv": "central-hash", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, "independent-central-signing-key", algorithm=ALGORITHM)
        self.local = create_access_token(self.user)

    def call(self, path, method="GET", payload=None, host="127.0.0.1", token=None, **headers):
        headers = {**({"Authorization": f"Bearer {self.foreign if token is None else token}"} if token != "" else {}), **headers}

        async def request():
            transport = httpx.ASGITransport(app=self.app, client=(host, 12345))
            async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000") as client:
                return await client.request(method, path, json=payload, headers=headers)

        return asyncio.run(request())

    def test_foreign_token_reproduces_old_failure_but_local_identity_does_not(self):
        self.assertEqual(self.call("/before").status_code, 401)
        self.assertEqual(self.call("/before", token=self.local).status_code, 200)

    def test_loopback_desktop_lists_empty_printers_and_diagnoses(self):
        with patch.object(settings.printing, "printer_devices", return_value=[]), patch.object(settings.printing, "default_printer", return_value=""), patch.object(settings.printing, "diagnose", return_value={"stage": "OK"}):
            for host in ("127.0.0.1", "::1"):
                response = self.call("/api/settings/printers", host=host, Referer="http://127.0.0.1:8000/", **{"sec-fetch-site": "same-origin", "sec-fetch-mode": "cors"})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["devices"], [])
            self.assertEqual(self.call("/api/settings/printers/diagnose").json(), {"stage": "OK"})

    def test_anonymous_loopback_discovery_allowed_but_remote_refused(self):
        with patch.object(settings.printing, "printer_devices", return_value=[]), patch.object(settings.printing, "default_printer", return_value=""), patch.object(settings.printing, "diagnose", return_value={"stage": "OK"}):
            for path in ("/api/settings/printers", "/api/settings/printers/diagnose"):
                for host in ("127.0.0.1", "::1"):
                    self.assertEqual(self.call(path, token="", host=host).status_code, 200)
                self.assertEqual(self.call(path, token="", host="192.168.1.50").status_code, 401)

    def test_remote_and_untrusted_browser_sources_cannot_use_local_fallback(self):
        with patch.object(settings.printing, "diagnose") as diagnose:
            for headers in ({"Origin": "http://127.0.0.1:8000"}, {"X-Forwarded-For": "127.0.0.1"}):
                response = self.call("/api/settings/printers/diagnose", host="192.168.1.50", **headers)
                self.assertEqual(response.status_code, 401)
            for headers in ({"Origin": "https://evil.example"}, {"Origin": "null"}, {"Origin": "http://127.0.0.1:8001"}, {"Referer": "http://192.168.1.20:8000/"}, {"Origin": "http://[invalid"}, {"sec-fetch-site": "cross-site"}, {"sec-fetch-mode": "cors"}):
                self.assertEqual(self.call("/api/settings/printers/diagnose", **headers).status_code, 401, headers)
            diagnose.assert_not_called()

    def test_actions_require_local_authentication_even_on_loopback(self):
        cases = [("/api/settings/printers/test", "POST", {"printer_name": "Test"}), ("/api/settings/printers/default", "POST", {"name": "Test"}), ("/api/settings/printers/preferences", "POST", {"name": "Test"}), ("/api/settings/printers/status?name=Test", "GET", None), ("/api/settings/company/open-drawer", "POST", {"drawer_port": "COM1"})]
        with patch("app.escpos.send") as send, patch.object(settings.printing, "queue_status", return_value=None), patch.object(settings.printing, "set_default_printer", return_value=True), patch.object(settings.printing, "open_preferences"), patch.object(settings.drawer, "open_drawer", return_value="COM1") as drawer:
            for path, method, payload in cases:
                with self.subTest(path=path):
                    self.assertEqual(self.call(path, method, payload, host="192.168.1.50").status_code, 401)
                    for token in ("", self.foreign):
                        self.assertEqual(self.call(path, method, payload, token=token).status_code, 401)
                        self.assertEqual(self.call(path, method, payload, token=token, Origin="http://127.0.0.1:8000", **{"sec-fetch-site": "same-origin"}).status_code, 401)
                    response = self.call(path, method, payload, token=self.local)
                    self.assertEqual(response.status_code, 404 if method == "GET" or path.endswith("preferences") else 200, response.text)
            send.assert_called_once()
            drawer.assert_called_once()
            self.user.role = "gestionnaire"
            self.db.commit()
            for path, method, payload in cases:
                self.assertEqual(self.call(path, method, payload, token=self.local).status_code, 403)

    def test_verified_local_permissions_and_revocations_are_not_bypassed(self):
        with patch.object(settings.printing, "diagnose", return_value={"ok": True}):
            self.assertEqual(self.call("/api/settings/printers/diagnose", token=self.local, host="192.168.1.50").status_code, 200)
            self.user.role = "gestionnaire"
            self.db.commit()
            self.assertEqual(self.call("/api/settings/printers/diagnose", token=self.local).status_code, 403)
            self.assertEqual(self.call("/api/settings/company/open-drawer", "POST", {}, token=self.local).status_code, 403)
            self.user.is_active = False
            self.db.commit()
            self.assertEqual(self.call("/api/settings/printers/diagnose", token=self.local).status_code, 403)
            self.user.is_active = True
            self.user.hashed_password = "changed-password-hash"
            self.db.commit()
            self.assertEqual(self.call("/api/settings/printers/diagnose", token=self.local).status_code, 401)
            expired = jwt.encode({"sub": str(self.user.id), "pwv": self.user.hashed_password[:16], "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}, SECRET_KEY, algorithm=ALGORITHM)
            self.assertEqual(self.call("/api/settings/printers/diagnose", token=expired).status_code, 401)

    def test_detection_errors_keep_the_actual_reason(self):
        with patch.object(settings.printing, "printer_devices", side_effect=OSError("Spouleur indisponible")):
            response = self.call("/api/settings/printers")
            self.assertEqual(response.status_code, 502)
            self.assertIn("Spouleur indisponible", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
