"""Where EasyGest keeps the data that must survive updates and reinstalls.

Application files live in Program Files (read-only once installed), so the
database, the signing key, the backups and the deployment settings are stored
in a shared data directory instead:

    Windows : %PROGRAMDATA%\\EasyGest
    Linux   : ~/.local/share/EasyGest

The Windows folder is shared by every account of the computer on purpose: a
per-user folder made the shop lose its company settings whenever the program
was started from another session or with administrator rights (an update run
as administrator wrote into the administrator's own profile).

Older installations kept their files in ``%APPDATA%\\EasyGest`` — or, before
the rename, in ``~/ReferenceInformatique``; both are adopted as-is, and the
per-user folder is copied into the shared one on first start so no data is
lost.
"""

import os
import shutil
import sys
from pathlib import Path

APP_DIR_NAME = "EasyGest"
LEGACY_DIR = Path.home() / "ReferenceInformatique"
LEGACY_DB_NAME = "reference.db"
DB_NAME = "easygest.db"


def _user_data_dir() -> Path:
    base = os.getenv("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(base) / APP_DIR_NAME


def _shared_data_dir() -> Path:
    base = os.getenv("PROGRAMDATA") or "C:\\ProgramData"
    return Path(base) / APP_DIR_NAME


def _holds_database(directory: Path) -> bool:
    return (directory / DB_NAME).exists() or (directory / LEGACY_DB_NAME).exists()


def _adopt_user_folder(shared: Path) -> None:
    """Move a database created by an earlier, per-user installation.

    Copies rather than moves: the old folder stays as a safety net in case the
    shared folder cannot be written to.
    """
    previous = _user_data_dir()
    if not _holds_database(previous):
        return
    try:
        shared.mkdir(parents=True, exist_ok=True)
        for item in previous.iterdir():
            target = shared / item.name
            if target.exists():
                continue
            if item.is_dir():
                shutil.copytree(item, target)
            else:
                shutil.copy2(item, target)
    except OSError:
        pass


def _default_data_dir() -> Path:
    if sys.platform == "win32":
        shared = _shared_data_dir()
        if not _holds_database(shared):
            _adopt_user_folder(shared)
        try:
            shared.mkdir(parents=True, exist_ok=True)
            probe = shared / ".write-test"
            probe.touch()
            probe.unlink()
            return shared
        except OSError:
            # Locked-down machine: fall back to the per-user folder.
            return _user_data_dir()
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
