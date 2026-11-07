import base64
import asyncio
import hashlib
import io
import json
import os
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
    "EASYGEST_DATA_DIR": folder, "DATABASE_URL": "sqlite:///:memory:", "SECRET_KEY": "gdrive-test-only",
}):
    from app import backup, gdrive
    from app.models import CompanySettings
    from app.routers import backup_drive, backups
    from app.auth import require_admin


class Response(io.BytesIO):
    def __init__(self, value, status=200, headers=None):
        super().__init__(value if isinstance(value, bytes) else json.dumps(value).encode())
        self.status = status
        self.headers = headers or {}


class FakeGoogle:
    def __init__(self):
        self.calls = []
        self.documents = {}
        self.folder_id = ""
        self.folder_name = "EasyGest Sauvegardes"
        self.upload_metadata = {}
        self.upload_content = b""
        self.deleted = []
        self.fail_upload_once = False
        self.fail_md5 = False
        self.quota_error = False
        self.invalid_grant = False
        self.token_timeout = False

    def error(self, url, code, value):
        raise urllib.error.HTTPError(url, code, "fake", {}, io.BytesIO(json.dumps(value).encode()))

    def __call__(self, request, timeout=None):
        url, method = request.full_url, request.get_method()
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        path = urllib.parse.urlsplit(url).path
        self.calls.append((method, url, request.data, dict(request.headers)))
        if url == gdrive.TOKEN_URL:
            if self.token_timeout:
                raise urllib.error.URLError("fake offline")
            if self.invalid_grant:
                self.error(url, 400, {"error": "invalid_grant"})
            return Response({"access_token": "access-private", "refresh_token": "refresh-private", "expires_in": 3600})
        if url == gdrive.REVOKE_URL:
            return Response({})
        if path.endswith("/about"):
            return Response({"user": {"emailAddress": "boutique@example.test"}, "storageQuota": {"usage": "10", "limit": "1000"}})
        if query.get("uploadType") == ["resumable"]:
            if self.quota_error:
                self.error(url, 403, {"error": {"errors": [{"reason": "storageQuotaExceeded"}]}})
            self.upload_metadata = json.loads(request.data)
            self.upload_content = b""
            return Response({}, headers={"Location": "https://www.googleapis.com/upload/session"})
        if path == "/upload/session":
            content_range = request.get_header("Content-range")
            if content_range.startswith("bytes */"):
                return Response(b"", status=308, headers={"Range": f"bytes=0-{len(self.upload_content) - 1}"})
            start = int(content_range.split(" ")[1].split("-")[0])
            if start != len(self.upload_content):
                raise AssertionError("offset incorrect")
            self.upload_content += request.data
            if self.fail_upload_once:
                self.fail_upload_once = False
                self.error(url, 503, {})
            total = int(content_range.split("/")[1])
            if len(self.upload_content) < total:
                return Response(b"", status=308, headers={"Range": f"bytes=0-{len(self.upload_content) - 1}"})
            file_id = "uploaded" + str(len(self.documents))
            self.documents[file_id] = {**self.upload_metadata, "id": file_id,
                "size": str(total), "md5Checksum": hashlib.md5(self.upload_content).hexdigest(),
                "createdTime": "2026-11-08T12:00:00Z", "content": self.upload_content}
            return Response({"id": file_id})
        if path.endswith("/files"):
            if method == "POST":
                metadata = json.loads(request.data)
                self.folder_id, self.folder_name = "folder", metadata["name"]
                return Response({"id": self.folder_id})
            if "mimeType='application/vnd.google-apps.folder'" in query.get("q", [""])[0]:
                return Response({"files": [{"id": self.folder_id}] if self.folder_id else []})
            return Response({"files": [{key: value for key, value in entry.items() if key != "content"}
                                       for entry in sorted(self.documents.values(), key=lambda item: item["createdTime"], reverse=True)
                                       if entry.get("appProperties", {}).get("easygest") == "1"]})
        file_id = path.rsplit("/", 1)[-1]
        if file_id == self.folder_id and file_id:
            return Response({"id": file_id, "name": self.folder_name, "mimeType": "application/vnd.google-apps.folder", "trashed": False})
        if file_id not in self.documents:
            self.error(url, 404, {"error": {}})
        if method == "DELETE":
            self.deleted.append(file_id)
            del self.documents[file_id]
            return Response(b"", status=204)
        entry = self.documents[file_id]
        if query.get("alt") == ["media"]:
            return Response(entry["content"])
        return Response({**{key: value for key, value in entry.items() if key != "content"},
                         "md5Checksum": "wrong" if self.fail_md5 else entry["md5Checksum"]})


class DriveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        environment = patch.dict(os.environ, {"EASYGEST_DATA_DIR": str(self.root),
            "EASYGEST_GDRIVE_CLIENT_ID": "", "EASYGEST_GDRIVE_CLIENT_SECRET": ""})
        environment.start()
        self.addCleanup(environment.stop)
        self.engine = create_engine(f"sqlite:///{self.root / 'live.db'}", connect_args={"check_same_thread": False})
        self.addCleanup(self.engine.dispose)
        CompanySettings.__table__.create(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.db.close)
        self.db.add(CompanySettings(name="Boutique test", backup_auto=False))
        self.db.commit()
        self.fake = FakeGoogle()
        for target, value in (("app.gdrive.urllib.request.urlopen", self.fake), ("app.gdrive.time.sleep", lambda _: None),
                              ("app.backup.engine", self.engine), ("app.backup.IS_SQLITE", True)):
            patcher = patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        gdrive.STATES.clear()
        gdrive.save_client("client-private.apps.googleusercontent.com", "secret-private")
        gdrive._write("gdrive_token.json", {"refresh_token": "refresh-private"})

    def settings(self):
        return self.db.query(CompanySettings).first()

    def archive(self):
        return backup.create(self.db, drive_background=False)

    def test_refresh_and_status_no_credentials_returned(self):
        status = gdrive.status(self.db)
        self.assertTrue(status["connected"])
        self.assertTrue(status["client_configured"])
        self.assertEqual(status["account_email"], "boutique@example.test")
        self.assertEqual(status["quota_limit"], "1000")
        output = json.dumps(status, default=str)
        for private in ("client-private", "secret-private", "refresh-private", "access-private"):
            self.assertNotIn(private, output)
        self.assertEqual(urllib.parse.parse_qs(self.fake.calls[0][2].decode())["grant_type"], ["refresh_token"])

    def test_environment_client_has_precedence(self):
        with patch.dict(os.environ, {"EASYGEST_GDRIVE_CLIENT_ID": "env-id", "EASYGEST_GDRIVE_CLIENT_SECRET": "env-secret"}):
            self.assertTrue(gdrive.configured_status()["client_from_env"])
            self.assertEqual(gdrive._credentials()["client_id"], "env-id")
            with self.assertRaises(gdrive.DriveError):
                gdrive.save_client("other", "other")

    def test_folder_created_reused_and_missing_cache_recreated(self):
        client = gdrive.Client()
        first = client.folder(self.db)
        self.assertEqual(first, "folder")
        self.assertEqual(client.folder(self.db), first)
        self.settings().drive_folder_id = "missing"
        self.db.commit()
        self.assertEqual(client.folder(self.db), first)
        self.fake.folder_id = ""
        self.assertEqual(client.folder(self.db), "folder")
        creates = [call for call in self.fake.calls if call[0] == "POST" and call[1].endswith("/files")]
        self.assertEqual(len(creates), 2)

    def test_upload_resumes_after_503_from_server_range(self):
        self.fake.fail_upload_once = True
        content = b"x" * gdrive.CHUNK + b"last chunk"
        result = gdrive.Client().upload("backup.zip", content, "folder", {"easygest": "1"})
        self.assertEqual(result["size"], str(len(content)))
        self.assertEqual(self.fake.upload_content, content)
        ranges = [call[3].get("Content-range", "") for call in self.fake.calls if call[0] == "PUT"]
        self.assertIn(f"bytes */{len(content)}", ranges)
        self.assertTrue(any(value.startswith(f"bytes {gdrive.CHUNK}-") for value in ranges))

    def test_md5_mismatch_records_failure_and_deletes_bad_copy(self):
        self.fake.fail_md5 = True
        with self.assertRaisesRegex(gdrive.DriveError, "MD5"):
            gdrive.upload_existing(self.db, self.archive())
        self.assertEqual(self.settings().drive_last_status, "erreur")
        self.assertIsNone(self.settings().drive_last_upload_at)
        self.assertTrue(self.fake.deleted)

    def test_quota_error_in_french(self):
        self.fake.quota_error = True
        with self.assertRaisesRegex(gdrive.DriveError, "Espace Google Drive insuffisant"):
            gdrive.upload_existing(self.db, self.archive())
        self.assertEqual(self.settings().drive_last_status, "erreur")

    def test_invalid_grant_disconnects_and_records_error(self):
        self.fake.invalid_grant = True
        status = gdrive.status(self.db)
        self.assertFalse(status["connected"])
        self.assertIn("reconnexion requise", status["last_error"])
        self.assertFalse((self.root / "gdrive_token.json").exists())
        self.assertEqual(self.settings().drive_last_status, "erreur")

    def test_network_error_and_rate_limit(self):
        self.fake.token_timeout = True
        with self.assertRaisesRegex(gdrive.DriveError, "connexion Internet"):
            gdrive.test_connection(self.db)
        self.assertEqual(self.settings().drive_last_status, "erreur")
        self.assertIn("Limite de requêtes", str(gdrive._failure(403, {"error": {"errors": [{"reason": "userRateLimitExceeded"}]}})))

    def test_expired_deadline_and_empty_status(self):
        with self.assertRaisesRegex(gdrive.DriveError, "Délai"):
            gdrive.request("GET", gdrive.API + "/about", deadline=time.monotonic() - 1)
        (self.root / "gdrive_token.json").unlink()
        (self.root / "gdrive_client.json").unlink()
        status = gdrive.status(self.db)
        self.assertFalse(status["client_configured"])
        self.assertFalse(status["connected"])

    def test_upload_success_and_retention(self):
        self.settings().drive_keep = 1
        self.db.commit()
        self.fake.documents["old"] = {"id": "old", "name": "old.zip", "createdTime": "2000-01-01T00:00:00Z", "appProperties": {"easygest": "1"}}
        result = gdrive.upload_existing(self.db, self.archive())
        self.assertEqual(result["status"], "ok")
        self.assertEqual(self.fake.deleted, ["old"])
        self.assertEqual(self.settings().drive_last_status, "ok")
        self.assertIsNotNone(self.settings().drive_last_upload_at)
        self.assertEqual(self.fake.upload_metadata["appProperties"]["easygest"], "1")
        self.assertEqual(self.fake.upload_metadata["appProperties"]["app_version"], backup.APP_VERSION)

    def test_callback_pkce_single_use_expiry_and_loopback(self):
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(gdrive.connect(8123)["authorization_url"]).query)
        state = params["state"][0]
        self.assertEqual(params["scope"], [gdrive.SCOPE])
        self.assertEqual(params["redirect_uri"], ["http://127.0.0.1:8123/api/backups/drive/callback"])
        verifier = gdrive.STATES[state][1]
        self.assertEqual(params["code_challenge"], [base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()])
        for invalid_state, client_ip in (("bad", "127.0.0.1"), (state, "192.168.1.10")):
            with self.assertRaises(gdrive.DriveError):
                gdrive.callback(invalid_state, "code", client_ip, self.db)
        gdrive.callback(state, "code", "127.0.0.1", self.db)
        with self.assertRaises(gdrive.DriveError):
            gdrive.callback(state, "code", "127.0.0.1", self.db)
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(gdrive.connect(8123)["authorization_url"]).query)
        state = params["state"][0]
        expiry, *values = gdrive.STATES[state]
        gdrive.STATES[state] = (time.monotonic() - 1, *values)
        with self.assertRaises(gdrive.DriveError):
            gdrive.callback(state, "code", "127.0.0.1", self.db)

    def test_callback_actual_server_port_and_admin_dependencies(self):
        request = Request({"type": "http", "server": ("0.0.0.0", 8007), "client": ("127.0.0.1", 123), "headers": [(b"host", b"evil.test:9999")]})
        result = backup_drive.connect(request, _=None)
        self.assertIn("127.0.0.1%3A8007", result["authorization_url"])
        for route in backup_drive.router.routes:
            if route.path.endswith("/callback"):
                continue
            self.assertIn(require_admin, [dependency.call for dependency in route.dependant.dependencies])

    def test_callback_in_actual_app_does_not_inherit_jwt_guard(self):
        from app.main import app

        paths = app.openapi()["paths"]
        self.assertNotIn("security", paths["/api/backups/drive/callback"]["get"])
        self.assertTrue(paths["/api/backups/drive/status"]["get"]["security"])

    def test_client_validation_never_echoes_secret(self):
        (self.root / "gdrive_token.json").unlink()
        for secret in ("secret-private", "secret-private" * 100):
            payload = json.dumps({"client_id": "new-client", "client_secret": secret}).encode()

            async def receive():
                return {"type": "http.request", "body": payload}

            request = Request({"type": "http"}, receive=receive)
            try:
                result = asyncio.run(backup_drive.save_client(request, _=None))
                self.assertNotIn(secret, json.dumps(result))
            except Exception as exc:
                self.assertNotIn(secret, str(exc))
                self.assertEqual(exc.status_code, 400)

    def test_download_verified_and_usable_for_inspect(self):
        uploaded = gdrive.upload_existing(self.db, self.archive())
        result = gdrive.download(self.db, uploaded["file_id"])
        local = backup.path_of(result["name"])
        self.assertTrue(backup.inspect_backup(local.read_bytes())["compatible"])
        self.fake.fail_md5 = True
        with self.assertRaisesRegex(gdrive.DriveError, "MD5"):
            gdrive.download(self.db, uploaded["file_id"])

    def test_client_and_token_files_excluded_from_archives(self):
        with zipfile.ZipFile(self.archive()) as archive:
            self.assertEqual(sorted(archive.namelist()), ["easygest.db", "manifest.json"])
            self.assertNotIn(b"refresh-private", archive.read("easygest.db"))
            self.assertEqual(json.loads(archive.read("manifest.json"))["extra_files"], [])
        returned = json.dumps(backup_drive.status(self.db, _=None), default=str)
        self.assertNotIn("secret-private", returned)
        self.assertNotIn("refresh-private", returned)

    def test_test_file_is_verified_and_deleted_and_disconnect_revokes(self):
        result = gdrive.test_connection(self.db)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(len(self.fake.deleted), 1)
        gdrive.disconnect(self.db)
        self.assertFalse((self.root / "gdrive_token.json").exists())
        self.assertFalse(self.settings().drive_enabled)
        self.assertTrue(any(call[1] == gdrive.REVOKE_URL for call in self.fake.calls))

    def test_backup_integration_excludes_sales_and_safety(self):
        with patch.object(gdrive, "enqueue") as enqueue:
            for reason in ("manuelle", "auto", "planifiee", "vente", "avant-restauration"):
                backup.create(self.db, reason=reason)
            self.assertEqual(enqueue.call_count, 3)
            backup.create(self.db, drive_background=False)
            self.assertEqual(enqueue.call_count, 3)

    def test_manual_drive_option_reports_local_success_and_remote_failure(self):
        self.fake.quota_error = True
        result = backups.create_backup(drive=True, db=self.db, _=None)
        self.assertTrue(backup.path_of(result["name"]).exists())
        self.assertEqual(result["drive"]["status"], "erreur")
        self.assertIn("Espace", result["drive"]["error"])


if __name__ == "__main__":
    unittest.main()
