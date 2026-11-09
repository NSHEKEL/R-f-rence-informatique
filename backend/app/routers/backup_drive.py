import html
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from .. import backup, gdrive
from ..permissions import require_permission
from ..database import get_db
from ..models import User

router = APIRouter(prefix="/drive", tags=["backups"])
callback_router = APIRouter(prefix="/api/backups/drive", tags=["backups"])


def _call(db, function, *args):
    try:
        return function(db, *args)
    except (gdrive.DriveError, backup.BackupError) as exc:
        gdrive._record(db, "erreur", str(exc))
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/status")
def status(db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_consulter"))):
    return gdrive.status(db)


@router.post("/client")
async def save_client(request: Request, _: User = Depends(require_permission("sauvegarde_modifier"))):
    try:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 8192:
                raise ValueError()
        payload = json.loads(body)
        client_id, client_secret = payload.get("client_id"), payload.get("client_secret")
        if not all(isinstance(value, str) and 0 < len(value) <= 1000 for value in (client_id, client_secret)):
            raise ValueError()
        return gdrive.save_client(client_id, client_secret)
    except (ValueError, AttributeError, UnicodeError):
        raise HTTPException(status_code=400, detail="Identifiant ou secret OAuth invalide (maximum 1000 caractères).")
    except gdrive.DriveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/connect")
def connect(request: Request, _: User = Depends(require_permission("sauvegarde_modifier"))):
    try:
        server = request.scope.get("server")
        if not server:
            raise gdrive.DriveError("Port du serveur indéterminé.")
        return gdrive.connect(server[1])
    except gdrive.DriveError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@callback_router.get("/callback", response_class=HTMLResponse)
def callback(request: Request, state: str = "", code: str = "", error: str = "", db: Session = Depends(get_db)):
    try:
        gdrive.callback(state, code, request.client.host if request.client else "", db, error)
        message = "Connexion Google Drive réussie, vous pouvez fermer cet onglet."
        status_code = 200
    except gdrive.DriveError as exc:
        message, status_code = str(exc), 400
    return HTMLResponse("<!doctype html><html lang='fr'><meta charset='utf-8'><title>EasyGest — Google Drive</title>"
                        "<h1>Google Drive</h1><p>" + html.escape(message) + "</p></html>", status_code=status_code,
                        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                                 "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"})


@router.post("/disconnect")
def disconnect(db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_modifier"))):
    _call(db, gdrive.disconnect)
    return {"detail": "Google Drive déconnecté."}


@router.post("/test")
def test(db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_modifier"))):
    return _call(db, gdrive.test_connection)


@router.post("/upload/{name}")
def upload(name: str, db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_modifier"))):
    try:
        path = backup.path_of(name)
    except backup.BackupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _call(db, gdrive.upload_existing, path)


@router.get("/files")
def files(db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_consulter"))):
    return _call(db, gdrive.list_files)


@router.post("/download/{file_id}")
def download(file_id: str, db: Session = Depends(get_db), _: User = Depends(require_permission("sauvegarde_modifier"))):
    return _call(db, gdrive.download, file_id)
