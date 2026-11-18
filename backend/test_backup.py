import asyncio
import io
import json
import os
import tempfile
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app import backup, migrate, paths
from app.database import Base
from app.models import CompanySettings
from app.schemas import CompanySettingsUpdate

with patch.dict(os.environ, {"SECRET_KEY": "unittest-backup-only"}):
    from app.routers import backups as routes


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {"EASYGEST_DATA_DIR": str(self.root)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.engine = create_engine(
            f"sqlite:///{self.root / 'live.db'}", connect_args={"check_same_thread": False}
        )
        self.addCleanup(self.engine.dispose)
        with self.engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.db.close)
        self.db.add(CompanySettings(name="Boutique test", backup_auto=False))
        self.db.commit()
        for name, value in (("engine", self.engine), ("IS_SQLITE", True)):
            patcher = patch.object(backup, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def archive(self):
        return backup.create(self.db).read_bytes()

    def rewrite(self, content, change):
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            members = {name: archive.read(name) for name in archive.namelist()}
        manifest = json.loads(members["manifest.json"])
        change(manifest, members)
        members["manifest.json"] = json.dumps(manifest).encode()
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, value in members.items():
                archive.writestr(name, value)
        return output.getvalue()

    def legacy(self):
        snapshot = self.root / "legacy.db"
        with self.engine.connect() as conn:
            conn.execute(text("VACUUM INTO :path"), {"path": str(snapshot)})
        return snapshot.read_bytes()

    def test_archive_manifest_integrity_and_status(self):
        target = backup.create(self.db, reason="manuelle")
        self.assertTrue(target.name.startswith("EasyGest-sauvegarde-"))
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(sorted(archive.namelist()), ["easygest.db", "manifest.json"])
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read("manifest.json"))
        self.assertEqual(manifest["format"], 1)
        self.assertEqual(manifest["extra_files"], [])
        self.assertIsNotNone(datetime.fromisoformat(manifest["created_at"]).tzinfo)
        report = backup.inspect_backup(target.read_bytes())
        self.assertTrue(report["compatible"])
        self.assertEqual(report["integrity"], "ok")
        self.assertEqual(report["sha256"], "ok")
        self.assertEqual(report["row_counts"]["company_settings"], 1)
        self.assertEqual(backup.status(self.db)["last_backup_status"], "ok")

    def test_bad_archive_and_legacy_rejected(self):
        for content in (b"", b"not a zip", b"SQLite format 3\x00" + b"invalid" * 100):
            with self.subTest(content=content[:16]), self.assertRaises(backup.BackupError):
                backup.inspect_backup(content)

    def test_sha_mismatch_rejected(self):
        content = self.rewrite(self.archive(), lambda manifest, _: manifest.update(db_sha256="wrong"))
        with self.assertRaisesRegex(backup.BackupError, "SHA-256"):
            backup.inspect_backup(content)

    def test_unknown_format_and_wrong_counts_rejected(self):
        for changes in ({"format": 99}, {"row_counts": {}}, {"extra_files": ["secret.key"]}):
            content = self.rewrite(self.archive(), lambda manifest, _, changes=changes: manifest.update(changes))
            with self.assertRaises(backup.BackupError):
                backup.inspect_backup(content)

    def test_newer_version_inspected_but_not_restored(self):
        content = self.rewrite(self.archive(), lambda manifest, _: manifest.update(app_version="999.0.0"))
        self.assertFalse(backup.inspect_backup(content)["compatible"])
        with self.assertRaisesRegex(backup.BackupError, "récente"):
            backup.schedule_restore(content, self.db, "RESTAURER")
        self.assertFalse((self.root / "restore-pending.db").exists())

    def test_equal_version_with_trailing_zero_is_compatible(self):
        content = self.rewrite(self.archive(), lambda manifest, _: manifest.update(app_version=backup.APP_VERSION + ".0"))
        self.assertTrue(backup.inspect_backup(content)["compatible"])

    def test_failed_verification_removes_archive_and_records_error(self):
        with patch.object(zipfile.ZipFile, "testzip", return_value="easygest.db"):
            with self.assertRaises(backup.BackupError):
                backup.create(self.db)
        self.assertEqual(backup.listing(), [])
        status = backup.status(self.db)
        self.assertEqual(status["last_backup_status"], "erreur")
        self.assertTrue(status["last_backup_error"])
        self.assertIsNone(status["last_backup_at"])

    def test_snapshot_integrity_failure_rejected(self):
        with patch.object(backup, "_database_details", side_effect=backup.BackupError("intégrité")):
            with self.assertRaises(backup.BackupError):
                backup.create(self.db)
        self.assertEqual(backup.listing(), [])

    def test_legacy_staging_confirmation_and_safety(self):
        content = self.legacy()
        self.assertEqual(backup.inspect_backup(content)["sha256"], "non disponible (ancien format)")
        for confirm in ("", "restaurer", " RESTAURER"):
            with self.assertRaisesRegex(backup.BackupError, "RESTAURER"):
                backup.schedule_restore(content, self.db, confirm)
        self.assertEqual(backup.listing(), [])
        safety = backup.schedule_restore(content, self.db, "RESTAURER")
        self.assertIn("avant-restauration", safety.name)
        self.assertEqual((self.root / "restore-pending.db").read_bytes(), content)
        self.assertTrue(backup.inspect_backup(safety.read_bytes())["compatible"])

    def test_zip_restore_preserves_existing_pending_on_failure(self):
        content = self.archive()
        pending = self.root / "restore-pending.db"
        pending.write_bytes(b"existing pending")
        with patch.object(backup, "create", side_effect=backup.BackupError("sécurité impossible")):
            with self.assertRaises(backup.BackupError):
                backup.schedule_restore(content, self.db, "RESTAURER")
        self.assertEqual(pending.read_bytes(), b"existing pending")
        backup.schedule_restore(content, self.db, "RESTAURER")
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            self.assertEqual(pending.read_bytes(), archive.read("easygest.db"))

    def test_legacy_and_zip_retention_and_download_resolution(self):
        folder = paths.backups_dir()
        legacy = folder / "easygest-20000101-000000-manuelle.db"
        legacy.write_bytes(self.legacy())
        os.utime(legacy, (1, 1))
        first = backup.create(self.db)
        second = backup.create(self.db)
        self.assertNotEqual(first, second)
        self.assertEqual(len(backup.listing()), 3)
        self.assertEqual(backup.path_of(legacy.name), legacy.resolve())
        backup.prune(2)
        self.assertFalse(legacy.exists())
        self.assertEqual(len(backup.listing()), 2)
        with self.assertRaises(backup.BackupError):
            backup.path_of("../live.db")

    def test_restore_swap_keeps_older_safety_copy(self):
        current = self.root / "easygest.db"
        current.write_bytes(b"current")
        previous = self.root / "easygest.db.before-restore"
        previous.write_bytes(b"older safety")
        (self.root / "restore-pending.db").write_bytes(b"replacement")
        paths.apply_pending_restore(current)
        self.assertEqual(current.read_bytes(), b"replacement")
        self.assertEqual(previous.read_bytes(), b"current")
        archived = list(paths.backups_dir().glob("*.before-restore"))
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0].read_bytes(), b"older safety")

    def test_inspect_and_restore_routes(self):
        content = self.archive()
        report = asyncio.run(routes.inspect_backup(file=UploadFile(io.BytesIO(content)), name="", _=None))
        self.assertTrue(report["compatible"])
        name = backup.listing()[0]["name"]
        self.assertTrue(asyncio.run(routes.inspect_backup(file=None, name=name, _=None))["compatible"])
        for file in (None, UploadFile(io.BytesIO(b"corrupt"))):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(routes.inspect_backup(file=file, name="", _=None))
            self.assertEqual(error.exception.status_code, 400)
        with self.assertRaises(HTTPException) as error:
            asyncio.run(routes.restore_backup(file=None, name=name, confirm="", db=self.db, _=None))
        self.assertEqual(error.exception.status_code, 400)
        result = asyncio.run(routes.restore_backup(file=None, name=name, confirm="RESTAURER", db=self.db, _=None))
        self.assertIn("avant-restauration", result["safety_backup"])

    def test_schedule_daily_weekly_monthly_and_missed(self):
        settings = self.db.query(CompanySettings).first()
        settings.backup_auto_enabled = True
        settings.backup_time = "20:00"
        now = datetime(2025, 3, 1, 12, tzinfo=timezone.utc)
        for frequency, previous, following in (
            ("daily", datetime(2025, 2, 28, 20, tzinfo=timezone.utc), datetime(2025, 3, 1, 20, tzinfo=timezone.utc)),
            ("weekly", datetime(2025, 2, 24, 20, tzinfo=timezone.utc), datetime(2025, 3, 3, 20, tzinfo=timezone.utc)),
            ("monthly", datetime(2025, 2, 28, 20, tzinfo=timezone.utc), datetime(2025, 3, 28, 20, tzinfo=timezone.utc)),
        ):
            with self.subTest(frequency=frequency):
                settings.backup_frequency = frequency
                settings.backup_weekday = 0
                settings.backup_monthday = 28
                self.assertEqual(backup.schedule_window(settings, now), (previous, following))
                settings.last_backup_at = None
                self.assertTrue(backup.schedule_due(settings, now))
                settings.last_backup_at = previous - (now - previous)
                self.assertTrue(backup.schedule_due(settings, now))
                settings.last_backup_at = previous.replace(tzinfo=None)
                self.assertFalse(backup.schedule_due(settings, now))
                self.assertTrue(backup.schedule_due(settings, following))
        settings.backup_auto_enabled = False
        self.assertFalse(backup.schedule_due(settings, now))

    def test_scheduler_runs_once_and_serializes_threads(self):
        settings = self.db.query(CompanySettings).first()
        settings.backup_auto_enabled = True
        self.db.commit()

        def run():
            with Session(self.engine) as db:
                return backup.scheduled_backup_if_due(db)

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: run(), range(2)))
        self.assertEqual(sum(result is not None for result in results), 1)
        self.db.expire_all()
        self.assertIsNotNone(backup.status(self.db)["next_run_at"])

    def test_historical_startup_backup_preserved(self):
        settings = self.db.query(CompanySettings).first()
        settings.backup_auto = True
        self.db.commit()
        self.assertIsNotNone(backup.auto_backup_if_due(self.db))
        self.assertIsNone(backup.auto_backup_if_due(self.db))

    def test_schedule_validation(self):
        for values in ({"backup_time": "24:00"}, {"backup_weekday": 7}, {"backup_monthday": 29},
                       {"backup_frequency": "hourly"}, {"backup_keep": 0}, {"backup_time": None}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                CompanySettingsUpdate(**values)

    def test_postgres_export_path_unchanged_and_no_scheduler(self):
        with patch.object(backup, "IS_SQLITE", False), patch.object(backup, "SUFFIX", ".json"), \
                patch.object(backup, "_export_json", side_effect=lambda path: path.write_text("{}")):
            result = backup.create(self.db)
            self.assertEqual(result.suffix, ".json")
            self.assertEqual(result.read_text(), "{}")
            self.assertEqual(len(backup.listing()), 1)
            self.assertIsNone(backup.scheduled_backup_if_due(self.db))
            with self.assertRaises(backup.BackupError):
                backup.schedule_restore(self.legacy(), self.db, "RESTAURER")

    def test_additive_migration_is_repeatable(self):
        other = create_engine(f"sqlite:///{self.root / 'old.db'}")
        try:
            with other.begin() as conn:
                conn.exec_driver_sql("CREATE TABLE company_settings (id INTEGER PRIMARY KEY, name VARCHAR, untouched VARCHAR)")
                conn.exec_driver_sql("INSERT INTO company_settings VALUES (1, 'Boutique', 'conservé')")
            with patch.object(migrate, "engine", other):
                migrate.migrate()
                migrate.migrate()
            columns = {column["name"] for column in inspect(other).get_columns("company_settings")}
            self.assertTrue({"untouched", "backup_time", "last_backup_error"} <= columns)
            with other.connect() as conn:
                self.assertEqual(conn.exec_driver_sql("SELECT untouched FROM company_settings").scalar(), "conservé")
        finally:
            other.dispose()


if __name__ == "__main__":
    unittest.main()
