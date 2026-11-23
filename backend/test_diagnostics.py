import logging
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import diagnostics, paths
from app.auth import require_admin
from app.routers import settings


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.file = self.folder / "easygest.log"
        self.addCleanup(patch.stopall)
        patch.object(diagnostics, "log_path", return_value=self.file).start()
        self.app = FastAPI()
        diagnostics.install_exception_handler(self.app)
        self.addCleanup(self.close_handlers)

    def close_handlers(self):
        logger = logging.getLogger("easygest.api")
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()

    def test_unhandled_error_logs_traceback_but_only_type_and_step_in_response(self):
        @self.app.middleware("http")
        async def middleware(request, call_next):
            return await call_next(request)

        @self.app.get("/probe/{item}")
        @diagnostics.diagnosed("cash.session_amounts.test")
        def probe(item: str):
            diagnostics.mark_step("cash.session_amounts.settlements")
            raise ValueError("private-error-message")

        with TestClient(self.app, raise_server_exceptions=False) as client:
            response = client.get("/probe/value?access_token=not-a-real-token", headers={"Authorization":"Bearer not-a-real-token"})
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], "Erreur interne : ValueError — étape cash.session_amounts.settlements")
        self.assertNotIn("private-error-message", response.text)
        logged = self.file.read_text(encoding="utf-8")
        self.assertIn("Traceback", logged)
        self.assertIn("ValueError", logged)
        self.assertIn("/probe/{item}", logged)
        self.assertNotIn("not-a-real-token", logged)
        print("API_500_DIAGNOSTIC_OK traceback_in_file=True response_type_and_step=True no_headers_query_or_message_in_response=True")

    def test_log_folder_is_authenticated_and_remote_open_is_denied(self):
        self.app.include_router(settings.router)
        with TestClient(self.app, raise_server_exceptions=False, client=("192.168.1.15",50000)) as client:
            self.assertEqual(client.get("/api/settings/logs").status_code, 401)
            self.app.dependency_overrides[require_admin] = lambda: SimpleNamespace(role="admin")
            response = client.get("/api/settings/logs")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["folder"], str(self.folder))
            self.assertFalse(response.json()["can_open"])
            with patch.object(settings, "open_logs_directory") as opened:
                self.assertEqual(client.post("/api/settings/logs/open").status_code, 403)
                opened.assert_not_called()

    def test_local_open_and_failure_keep_the_folder_discoverable(self):
        self.app.include_router(settings.router)
        self.app.dependency_overrides[require_admin] = lambda: SimpleNamespace(role="admin")
        with TestClient(self.app, raise_server_exceptions=False, client=("127.0.0.1",50000)) as client, patch.dict(os.environ, {"USERNAME":"test-user"}), patch.object(os,"startfile",create=True), patch.object(settings,"open_logs_directory") as opened:
            self.assertTrue(client.get("/api/settings/logs").json()["can_open"])
            self.assertEqual(client.post("/api/settings/logs/open").status_code, 200)
            opened.assert_called_once_with()
            opened.side_effect = OSError("unavailable")
            self.assertEqual(client.post("/api/settings/logs/open").status_code, 503)
            self.assertEqual(client.get("/api/settings/logs").json()["file"], str(self.file))

    def test_native_open_rejects_arbitrary_or_network_paths(self):
        with patch.object(paths, "log_path", return_value=self.file), patch.object(paths,"data_dir",return_value=self.folder), patch.object(os,"startfile",create=True) as opened:
            for value in (str(self.folder.parent), r"\\untrusted\share"):
                with self.subTest(value=value), self.assertRaises(PermissionError):
                    paths.open_logs_directory(value)
            opened.assert_not_called()
            paths.open_logs_directory(str(self.folder))
            opened.assert_called_once_with(str(self.folder))
