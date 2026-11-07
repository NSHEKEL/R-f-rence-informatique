"""Backups of the business data, so a broken workstation loses nothing.

A backup is a self-contained copy of the database:

* SQLite      -> verified ``VACUUM INTO`` snapshot in a ZIP with a manifest;
* PostgreSQL  -> every table is exported to a single ``.json`` file (no
                 external ``pg_dump`` needed on the workstation).

Copies are kept in the data directory and, when a backup folder is configured
(USB key, OneDrive/Google Drive folder, network share), mirrored there.
"""

import hashlib
import io
import json
import logging
import re
import shutil
import sqlite3
import tempfile
import threading
import zipfile
import zlib
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import MetaData, select, text
from sqlalchemy.orm import Session

from . import gdrive
from .database import IS_SQLITE, SessionLocal, engine
from .models import CompanySettings
from .paths import backups_dir, data_dir
from .version import APP_VERSION, is_newer

SUFFIX = ".db" if IS_SQLITE else ".json"
BACKUP_LOCK = threading.RLock()
MAX_UPLOAD = 512 * 1024 * 1024
MAX_DATABASE = MAX_UPLOAD


class BackupError(RuntimeError):
    pass


def _stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _export_json(destination: Path) -> None:
    metadata = MetaData()
    metadata.reflect(bind=engine)
    payload: dict[str, list[dict]] = {}
    with engine.connect() as conn:
        for name, table in metadata.tables.items():
            rows = conn.execute(select(table)).mappings().all()
            payload[name] = [
                {
                    key: (value.isoformat() if hasattr(value, "isoformat") else value)
                    for key, value in row.items()
                }
                for row in rows
            ]
    destination.write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def create(db: Session, *, reason: str = "manuelle", drive_background: bool = True) -> Path:
    with BACKUP_LOCK:
        target = _create(db, reason=reason)
        if IS_SQLITE and drive_background and reason in ("manuelle", "planifiee", "auto"):
            gdrive.enqueue(db, target)
        return target


def _create(db: Session, *, reason: str) -> Path:
    """Write a new backup and return its path in the data directory."""
    target = backups_dir() / f"easygest-{_stamp()}-{reason}{SUFFIX}"
    if IS_SQLITE:
        settings = db.query(CompanySettings).first()
        try:
            target = _create_archive(reason)
            if settings is not None:
                _mirror(target, settings.backup_dir or "")
                settings.last_backup_at = datetime.now(timezone.utc)
                settings.last_backup_status = "ok"
                settings.last_backup_error = ""
                db.commit()
                prune(settings.backup_keep or 30)
            return target
        except Exception as exc:
            db.rollback()
            settings = db.query(CompanySettings).first()
            if settings is not None:
                settings.last_backup_status = "erreur"
                settings.last_backup_error = str(exc)
                db.commit()
            raise BackupError(f"Sauvegarde impossible : {exc}") from exc
    else:
        _export_json(target)

    settings = db.query(CompanySettings).first()
    if settings is not None:
        _mirror(target, settings.backup_dir or "")
        settings.last_backup_at = datetime.now(timezone.utc)
        db.commit()
        prune(settings.backup_keep or 30)
    return target


def _database_details(path: Path) -> dict:
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as conn:
        for pragma in ("integrity_check", "quick_check"):
            if conn.execute(f"PRAGMA {pragma}").fetchall() != [("ok",)]:
                raise BackupError("Le contrôle d'intégrité SQLite a échoué")
        tables = sorted(row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ))
        counts = {
            table: conn.execute('SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0]
            for table in tables
        }
    return {"tables": tables, "row_counts": counts}


def _create_archive(reason: str) -> Path:
    if not re.fullmatch(r"[a-zA-Z0-9-]+", reason):
        raise BackupError("Motif de sauvegarde invalide")
    target = backups_dir() / f"EasyGest-sauvegarde-{_stamp()}-{reason}.zip"
    counter = 1
    while target.exists():
        target = backups_dir() / f"EasyGest-sauvegarde-{_stamp()}-{reason}-{counter}.zip"
        counter += 1
    with tempfile.TemporaryDirectory() as folder:
        snapshot = Path(folder) / "easygest.db"
        with engine.connect() as conn:
            conn.execute(text("VACUUM INTO :path"), {"path": str(snapshot)})
        details = _database_details(snapshot)
        if snapshot.stat().st_size > MAX_DATABASE:
            raise BackupError("Base trop volumineuse (maximum 512 Mo)")
        content = snapshot.read_bytes()
        manifest = {
            "format": 1, "app_version": APP_VERSION,
            "created_at": datetime.now().astimezone().isoformat(),
            "reason": reason, "db_sha256": hashlib.sha256(content).hexdigest(),
            "db_size": len(content), **details, "extra_files": [],
        }
        try:
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.write(snapshot, "easygest.db")
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
            with zipfile.ZipFile(target) as archive:
                if archive.testzip() is not None:
                    raise BackupError("Archive endommagée")
                if hashlib.sha256(archive.read("easygest.db")).hexdigest() != manifest["db_sha256"]:
                    raise BackupError("Empreinte de sauvegarde incorrecte")
        except Exception:
            target.unlink(missing_ok=True)
            raise
    return target


def _read_backup(content: bytes) -> tuple[dict, bytes]:
    if len(content) > MAX_UPLOAD:
        raise BackupError("Fichier trop volumineux (maximum 512 Mo)")
    manifest = None
    try:
        if content[:16] == b"SQLite format 3\x00":
            database = content
        else:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                if sorted(archive.namelist()) != ["easygest.db", "manifest.json"]:
                    raise BackupError("Contenu de l'archive non reconnu")
                if archive.getinfo("easygest.db").file_size > MAX_DATABASE or archive.getinfo("manifest.json").file_size > 1024 * 1024:
                    raise BackupError("Archive trop volumineuse")
                if archive.testzip() is not None:
                    raise BackupError("Archive endommagée")
                manifest = json.loads(archive.read("manifest.json"))
                database = archive.read("easygest.db")
            if not isinstance(manifest, dict) or manifest.get("format") != 1:
                raise BackupError("Format de sauvegarde inconnu")
            version = manifest.get("app_version")
            if not isinstance(version, str) or not re.fullmatch(r"\d+(\.\d+){1,3}", version):
                raise BackupError("Version de sauvegarde invalide")
            if manifest.get("db_size") != len(database) or manifest.get("db_sha256") != hashlib.sha256(database).hexdigest():
                raise BackupError("Empreinte SHA-256 incorrecte")
            datetime.fromisoformat(manifest["created_at"])
        with tempfile.TemporaryDirectory() as folder:
            snapshot = Path(folder) / "easygest.db"
            snapshot.write_bytes(database)
            details = _database_details(snapshot)
        if manifest and (manifest.get("tables") != details["tables"] or manifest.get("row_counts") != details["row_counts"] or manifest.get("extra_files") != []):
            raise BackupError("Le manifeste ne correspond pas à la base")
        return {
            "created_at": manifest["created_at"] if manifest else None,
            "app_version": manifest["app_version"] if manifest else None,
            "compatible": manifest is None or not is_newer(manifest["app_version"], APP_VERSION),
            "integrity": "ok", "sha256": "ok" if manifest else "non disponible (ancien format)",
            "row_counts": details["row_counts"],
        }, database
    except BackupError:
        raise
    except (ValueError, KeyError, TypeError, sqlite3.Error, zipfile.BadZipFile, zlib.error, RuntimeError, OSError, NotImplementedError, EOFError) as exc:
        raise BackupError("Sauvegarde invalide ou endommagée") from exc


def inspect_backup(content: bytes) -> dict:
    return _read_backup(content)[0]


def _mirror(source: Path, folder: str) -> None:
    """Copy the backup onto the USB key / cloud folder chosen by the user."""
    if not folder.strip():
        return
    destination = Path(folder.strip()).expanduser()
    try:
        destination.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination / source.name)
    except OSError as exc:
        raise BackupError(
            f"Sauvegarde locale créée, mais copie vers « {folder} » "
            f"impossible : {exc}"
        )


def default_export_dir() -> Path:
    """Where a copy goes when no backup folder is configured."""
    downloads = Path.home() / "Downloads"
    return downloads if downloads.is_dir() else Path.home()


def export(db: Session, name: str, folder: str = "") -> Path:
    """Save a copy of a backup where the user can pick it up.

    The desktop window cannot download files the way a browser does, so the
    copy is written by the application itself: into the configured backup
    folder (USB key, cloud folder) or, failing that, the Downloads folder.
    """
    source = path_of(name)
    chosen = folder.strip()
    if not chosen:
        settings = db.query(CompanySettings).first()
        chosen = (settings.backup_dir or "").strip() if settings else ""
    destination = Path(chosen).expanduser() if chosen else default_export_dir()
    try:
        destination.mkdir(parents=True, exist_ok=True)
        target = destination / source.name
        shutil.copy2(source, target)
    except OSError as exc:
        raise BackupError(f"Copie vers « {destination} » impossible : {exc}")
    return target


def after_sale(db: Session) -> Optional[Path]:
    """Copy of the data made right after a sale, when the shop asked for it.

    Losing the workstation must not lose the day's takings, so the copy is
    mirrored to the configured folder as soon as the ticket is recorded.
    """
    settings = db.query(CompanySettings).first()
    if settings is None or not settings.backup_on_sale:
        return None
    return create(db, reason="vente")


def prune(keep: int) -> None:
    files = sorted(
        _backup_files(),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for stale in files[max(keep, 1):]:
        try:
            stale.unlink()
        except OSError:
            pass


def listing() -> list[dict]:
    entries = []
    for path in sorted(
        _backup_files(),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    ):
        stat = path.stat()
        entries.append(
            {
                "name": path.name,
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(
                    stat.st_mtime, timezone.utc
                ),
            }
        )
    return entries


def _backup_files() -> list[Path]:
    if not IS_SQLITE:
        return list(backups_dir().glob("easygest-*.json"))
    return [path for path in backups_dir().iterdir() if path.is_file() and (
        path.name.startswith(("easygest-", "EasyGest-sauvegarde-"))
        and path.suffix in (".db", ".zip", ".before-restore")
    )]


def path_of(name: str) -> Path:
    """Resolve a backup by name, refusing anything outside the folder."""
    candidate = (backups_dir() / name).resolve()
    if candidate.parent != backups_dir().resolve() or not candidate.exists():
        raise BackupError("Sauvegarde introuvable")
    return candidate


def schedule_restore(content: bytes, db: Session, confirm: str = "") -> Path:
    """Queue an uploaded SQLite backup; it is installed on the next start."""
    if not IS_SQLITE:
        raise BackupError(
            "La restauration automatique ne concerne que la base locale ; "
            "sur PostgreSQL, restaurez la base côté serveur."
        )
    if confirm != "RESTAURER":
        raise BackupError("Saisissez RESTAURER pour confirmer")
    report, database = _read_backup(content)
    if not report["compatible"]:
        raise BackupError("Cette sauvegarde provient d'une version plus récente")
    with BACKUP_LOCK:
        safety = create(db, reason="avant-restauration")
        pending = data_dir() / "restore-pending.tmp"
        try:
            pending.write_bytes(database)
            pending.replace(data_dir() / "restore-pending.db")
        finally:
            pending.unlink(missing_ok=True)
    return safety


def auto_backup_if_due(db: Session) -> Optional[Path]:
    """One automatic backup per day, made when the application starts."""
    with BACKUP_LOCK:
        settings = db.query(CompanySettings).first()
        if settings is None or not settings.backup_auto:
            return None
        last = settings.last_backup_at
        if last is not None and last.date() == datetime.now(timezone.utc).date():
            return None
        return create(db, reason="auto")


def schedule_window(settings: CompanySettings, now: datetime) -> tuple[datetime, datetime]:
    hour, minute = map(int, settings.backup_time.split(":"))
    slots = []
    for offset in range(-65, 66):
        day = now.date() + timedelta(days=offset)
        if settings.backup_frequency == "weekly" and day.weekday() != settings.backup_weekday:
            continue
        if settings.backup_frequency == "monthly" and day.day != settings.backup_monthday:
            continue
        slots.append(datetime.combine(day, datetime.min.time()).replace(
            hour=hour, minute=minute, tzinfo=now.tzinfo
        ))
    return max(slot for slot in slots if slot <= now), min(slot for slot in slots if slot > now)


def _last_success(settings: CompanySettings) -> Optional[datetime]:
    last = settings.last_backup_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return last


def schedule_due(settings: CompanySettings, now: datetime) -> bool:
    if not settings.backup_auto_enabled:
        return False
    previous, _ = schedule_window(settings, now)
    last = _last_success(settings)
    return last is None or last < previous


def status(db: Session) -> dict:
    settings = db.query(CompanySettings).first()
    if settings is None:
        return {"next_run_at": None, "sqlite": IS_SQLITE}
    now = datetime.now().astimezone()
    next_run = None
    if IS_SQLITE and settings.backup_auto_enabled:
        next_run = now if schedule_due(settings, now) else schedule_window(settings, now)[1]
    keys = ("backup_auto", "backup_auto_enabled", "backup_frequency", "backup_time",
            "backup_weekday", "backup_monthday", "backup_keep", "last_backup_at",
            "last_backup_status", "last_backup_error")
    return {**{key: getattr(settings, key) for key in keys}, "last_backup_at": _last_success(settings),
            "next_run_at": next_run, "sqlite": IS_SQLITE}


def scheduled_backup_if_due(db: Session, now: Optional[datetime] = None) -> Optional[Path]:
    with BACKUP_LOCK:
        db.expire_all()
        settings = db.query(CompanySettings).first()
        if IS_SQLITE and settings is not None and schedule_due(settings, now or datetime.now().astimezone()):
            return create(db, reason="planifiee")
    return None


def scheduler_loop() -> None:
    if not IS_SQLITE:
        return
    while True:
        with SessionLocal() as db:
            try:
                scheduled_backup_if_due(db)
            except Exception:
                logging.getLogger(__name__).exception("Échec de la sauvegarde planifiée")
        threading.Event().wait(60)
