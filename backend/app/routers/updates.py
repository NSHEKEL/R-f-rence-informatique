"""Remote update endpoints: check for a new release and install it.

The update always concerns the computer running this process, never the
central server: a workstation reads its data on the shared server but keeps
its own EasyGest installation. The frontend therefore calls these endpoints on
its own machine, and a request coming from that machine is accepted without a
token — the shared server may use another signing key or another user list.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from ..auth import ALGORITHM, SECRET_KEY
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

LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def allow_update(request: Request, db: Session = Depends(get_db)) -> None:
    """Accept the machine itself, or an administrator coming from the network."""
    if (request.client.host if request.client else "") in LOOPBACK:
        return

    header = request.headers.get("Authorization", "")
    token = header[7:] if header.lower().startswith("bearer ") else ""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user = db.query(User).filter(User.id == int(payload.get("sub", 0))).first()
    except (JWTError, ValueError):
        user = None
    if user is None or user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Mise à jour réservée à l'ordinateur lui-même ou à un administrateur",
        )


@router.get("", response_model=UpdateStatus)
def check_update(_: None = Depends(allow_update)):
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
def install_update(_: None = Depends(allow_update)):
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
