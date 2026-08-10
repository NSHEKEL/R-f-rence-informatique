"""Remote update endpoints: check for a new release and install it."""

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_admin
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


@router.get("", response_model=UpdateStatus)
def check_update(_: User = Depends(require_admin)):
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
def install_update(_: User = Depends(require_admin)):
    try:
        release = latest_release()
        if not update_available(release):
            raise HTTPException(
                status_code=400, detail="Aucune mise à jour disponible"
            )
        install(release)
    except UpdateError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    shutdown_soon()
    return UpdateInstallResult(version=release.version)
