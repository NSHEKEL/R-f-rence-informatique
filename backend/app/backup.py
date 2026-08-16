"""Backups of the business data, so a broken workstation loses nothing.

A backup is a self-contained copy of the database:

* SQLite      -> ``VACUUM INTO`` produces a consistent ``.db`` file even while
                 the application is running;
* PostgreSQL  -> every table is exported to a single ``.json`` file (no
                 external ``pg_dump`` needed on the workstation).

Copies are kept in the data directory and, when a backup folder is configured
(USB key, OneDrive/Google Drive folder, network share), mirrored there.
"""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import MetaData, select, text
from sqlalchemy.orm import Session

from .database import IS_SQLITE, engine
from .models import CompanySettings
from .paths import backups_dir, data_dir

SUFFIX = ".db" if IS_SQLITE else ".json"


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


def create(db: Session, *, reason: str = "manuelle") -> Path:
    """Write a new backup and return its path in the data directory."""
    target = backups_dir() / f"easygest-{_stamp()}-{reason}{SUFFIX}"
    if IS_SQLITE:
        with engine.connect() as conn:
            conn.execute(text("VACUUM INTO :path"), {"path": str(target)})
    else:
        _export_json(target)

    settings = db.query(CompanySettings).first()
    if settings is not None:
        _mirror(target, settings.backup_dir or "")
        settings.last_backup_at = datetime.now(timezone.utc)
        db.commit()
        prune(settings.backup_keep or 30)
    return target


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


def prune(keep: int) -> None:
    files = sorted(
        backups_dir().glob(f"easygest-*{SUFFIX}"),
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
        backups_dir().glob(f"easygest-*{SUFFIX}"),
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


def path_of(name: str) -> Path:
    """Resolve a backup by name, refusing anything outside the folder."""
    candidate = (backups_dir() / name).resolve()
    if candidate.parent != backups_dir().resolve() or not candidate.exists():
        raise BackupError("Sauvegarde introuvable")
    return candidate


def schedule_restore(content: bytes) -> None:
    """Queue an uploaded SQLite backup; it is installed on the next start."""
    if not IS_SQLITE:
        raise BackupError(
            "La restauration automatique ne concerne que la base locale ; "
            "sur PostgreSQL, restaurez la base côté serveur."
        )
    if content[:16] != b"SQLite format 3\x00":
        raise BackupError("Ce fichier n'est pas une sauvegarde EasyGest.")
    (data_dir() / "restore-pending.db").write_bytes(content)


def auto_backup_if_due(db: Session) -> Optional[Path]:
    """One automatic backup per day, made when the application starts."""
    settings = db.query(CompanySettings).first()
    if settings is None or not settings.backup_auto:
        return None
    last = settings.last_backup_at
    if last is not None:
        last_day = last.date()
        if last_day == datetime.now(timezone.utc).date():
            return None
    return create(db, reason="auto")
