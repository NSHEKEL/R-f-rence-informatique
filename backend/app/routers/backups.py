"""Download, create and restore backups of the business data."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import backup, gdrive
from ..permissions import require_permission
from ..database import get_db
from ..licensing import require_feature
from ..models import User
from ..schemas import BackupFile
from . import backup_drive


class ExportRequest(BaseModel):
    folder: str = ""


router = APIRouter(prefix="/api/backups", tags=["backups"])
router.include_router(backup_drive.router)


@router.get("", response_model=list[BackupFile])
def list_backups(_: User = Depends(require_permission("sauvegarde_consulter"))):
    return backup.listing()


@router.get("/status")
def backup_status(db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_consulter"))):
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
    _: User = Depends(require_permission("sauvegarde_modifier")),
):
    try:
        return await run_in_threadpool(backup.inspect_backup, await _content(file, name))
    except backup.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("")
def create_backup(
    drive: bool = False, db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_modifier"))
):
    try:
        path = backup.create(db, drive_background=not drive)
    except backup.BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    result = {"name": path.name, "size": path.stat().st_size}
    if drive:
        try:
            result["drive"] = gdrive.upload_existing(db, path)
        except gdrive.DriveError as exc:
            result["drive"] = {"status": "erreur", "error": str(exc)}
    return result


@router.get("/{name}/download")
def download_backup(name: str, _: User = Depends(require_permission("sauvegarde_consulter"))):
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
    _: User = Depends(require_permission("sauvegarde_modifier")),
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
    _: User = Depends(require_permission("sauvegarde_modifier", "parametres_sauvegarde_restaurer")),
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
