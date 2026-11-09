"""Permission-controlled update checks and installation on this computer."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import backup
from ..permissions import require_permission
from ..database import get_db
from ..models import User
from ..schemas import UpdateInstallResult, UpdateStatus
from ..updater import (
    UpdateError,
    install,
    is_packaged,
    latest_release,
    shutdown_soon,
    update_available,
)
from ..version import APP_VERSION

router = APIRouter(prefix="/api/updates", tags=["updates"])


def _recent_backup_exists() -> bool:
    """A local backup written in the last minutes: safe to proceed."""
    from datetime import datetime, timedelta, timezone

    from ..paths import backups_dir

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    try:
        for path in backups_dir().glob("easygest-*"):
            stamp = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            if stamp >= cutoff:
                return True
    except OSError:
        pass
    return False

@router.get("", response_model=UpdateStatus)
def check_update(_: User = Depends(require_permission("generaux_consulter"))):
    status = UpdateStatus(current_version=APP_VERSION, packaged=is_packaged())
    try:
        release = latest_release()
    except UpdateError as exc:
        status.error = str(exc)
        return status
    status.latest_version = release.version
    status.notes = release.notes
    status.published_at = release.published_at
    status.available = update_available(release)
    return status


@router.post("/install", response_model=UpdateInstallResult)
def install_update(
    _: User = Depends(require_permission("generaux_modifier")), db: Session = Depends(get_db)
):
    try:
        release = latest_release()
        if not update_available(release):
            raise HTTPException(
                status_code=400, detail="Aucune mise à jour disponible"
            )
        # The process exits right after install: take a backup first so an
        # upgrade gone wrong never means lost data. A failed backup blocks
        # the update — safer than upgrading unprotected. Exception: the copy
        # towards a configured USB/network folder may fail after the local
        # backup file was already written; that must not block the update.
        try:
            backup.create(db, reason="pre-maj")
        except Exception as exc:
            if not _recent_backup_exists():
                raise HTTPException(
                    status_code=500,
                    detail=f"Sauvegarde avant mise à jour impossible : {exc}",
                )
        install(release)
    except UpdateError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    shutdown_soon()
    return UpdateInstallResult(version=release.version)
