"""Where EasyGest keeps the data that must survive updates and reinstalls.

Application files live in Program Files (read-only once installed), so the
database, the signing key, the backups and the deployment settings are stored
in the per-user data directory instead:

    Windows : %APPDATA%\\EasyGest
    Linux   : ~/.local/share/EasyGest

Installations made before the rename kept their files in
``~/ReferenceInformatique``; that folder is adopted as-is so no data is lost.
"""

import os
import sys
from pathlib import Path

APP_DIR_NAME = "EasyGest"
LEGACY_DIR = Path.home() / "ReferenceInformatique"
LEGACY_DB_NAME = "reference.db"
DB_NAME = "easygest.db"


def _default_data_dir() -> Path:
    if sys.platform == "win32":
        base = os.getenv("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        return Path(base) / APP_DIR_NAME
    return Path.home() / ".local" / "share" / APP_DIR_NAME


def data_dir() -> Path:
    """Directory holding the user's data, created on first use.

    ``EASYGEST_DATA_DIR`` overrides it (used to point several machines at a
    shared folder, or to run tests on a scratch directory).
    """
    override = os.getenv("EASYGEST_DATA_DIR", "").strip()
    if override:
        directory = Path(override).expanduser()
    elif LEGACY_DIR.exists():
        directory = LEGACY_DIR
    else:
        directory = _default_data_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def database_file() -> Path:
    """SQLite file of a single-workstation install, legacy name included."""
    directory = data_dir()
    legacy = directory / LEGACY_DB_NAME
    current = legacy if legacy.exists() else directory / DB_NAME
    apply_pending_restore(current)
    return current


def apply_pending_restore(current: Path) -> None:
    """Swap in a backup uploaded through "Restaurer une sauvegarde".

    The running application holds the database open, so a restore only drops
    the file here; it is installed on the next start, before any connection.
    """
    pending = data_dir() / "restore-pending.db"
    if not pending.exists():
        return
    if current.exists():
        current.replace(current.with_suffix(current.suffix + ".before-restore"))
    for suffix in ("-wal", "-shm"):
        stale = current.with_name(current.name + suffix)
        if stale.exists():
            stale.unlink()
    pending.replace(current)


def backups_dir() -> Path:
    directory = data_dir() / "backups"
    directory.mkdir(parents=True, exist_ok=True)
    return directory
