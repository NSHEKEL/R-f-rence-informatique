"""Download, create and restore backups of the business data."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import backup
from ..auth import require_admin
from ..database import get_db
from ..models import User
from ..schemas import BackupFile, BackupResult

router = APIRouter(prefix="/api/backups", tags=["backups"])


@router.get("", response_model=list[BackupFile])
def list_backups(_: User = Depends(require_admin)):
    return backup.listing()


@router.post("", response_model=BackupResult)
def create_backup(
    db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    try:
        path = backup.create(db)
    except backup.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return BackupResult(name=path.name, size=path.stat().st_size)


@router.get("/{name}/download")
def download_backup(name: str, _: User = Depends(require_admin)):
    try:
        path = backup.path_of(name)
    except backup.BackupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return FileResponse(
        str(path), filename=path.name, media_type="application/octet-stream"
    )


@router.post("/restore")
async def restore_backup(
    file: UploadFile = File(...), _: User = Depends(require_admin)
):
    try:
        backup.schedule_restore(await file.read())
    except backup.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "detail": (
            "Sauvegarde acceptée. Fermez puis rouvrez EasyGest pour "
            "terminer la restauration."
        )
    }
