"""Download, create and restore backups of the business data."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import backup
from ..auth import require_admin
from ..database import get_db
from ..licensing import require_feature
from ..models import User
from ..schemas import BackupFile, BackupResult


class ExportRequest(BaseModel):
    folder: str = ""


router = APIRouter(prefix="/api/backups", tags=["backups"])


@router.get("", response_model=list[BackupFile])
def list_backups(_: User = Depends(require_admin)):
    return backup.listing()


@router.get("/status")
def backup_status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return backup.status(db)


async def _content(file: UploadFile | None, name: str) -> bytes:
    if file is not None:
        content = await file.read(backup.MAX_UPLOAD + 1)
        if len(content) > backup.MAX_UPLOAD:
            raise backup.BackupError("Fichier trop volumineux (maximum 512 Mo)")
        return content
    if name:
        path = backup.path_of(name)
        if path.stat().st_size > backup.MAX_UPLOAD:
            raise backup.BackupError("Fichier trop volumineux (maximum 512 Mo)")
        return path.read_bytes()
    raise backup.BackupError("Choisissez une sauvegarde")


@router.post("/inspect")
async def inspect_backup(
    file: UploadFile | None = File(None), name: str = Form(""),
    _: User = Depends(require_admin),
):
    try:
        return await run_in_threadpool(backup.inspect_backup, await _content(file, name))
    except backup.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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


@router.post("/{name}/export")
def export_backup(
    name: str,
    payload: ExportRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Write a copy of a backup outside the application, without a browser
    download: the desktop window cannot save files by itself."""
    try:
        target = backup.export(db, name, payload.folder)
    except backup.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"path": str(target)}


@router.post("/restore", dependencies=[Depends(require_feature("restauration"))])
async def restore_backup(
    file: UploadFile | None = File(None), name: str = Form(""),
    confirm: str = Form(""), db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    try:
        safety = await run_in_threadpool(backup.schedule_restore, await _content(file, name), db, confirm)
    except backup.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "safety_backup": safety.name,
        "detail": (
            "Sauvegarde acceptée. Fermez puis rouvrez EasyGest pour "
            "terminer la restauration."
        )
    }
