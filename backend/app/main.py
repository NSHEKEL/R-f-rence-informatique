import os
import socket
import sys
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import backup, clients, history
from .auth import ALGORITHM, SECRET_KEY, require_admin
from .database import Base, SessionLocal, engine, get_db
from .migrate import migrate
from .models import User
from .routers import (
    accounting,
    auth,
    backups,
    cash,
    categories,
    customers,
    dashboard,
    history as history_router,
    inventory,
    notifications,
    orders,
    products,
    proformas,
    reports,
    returns,
    sales,
    settings,
    suppliers,
    sync,
    updates,
    users,
)
from .seed import seed
from .version import APP_NAME, APP_VERSION

Base.metadata.create_all(bind=engine)
migrate()

app = FastAPI(title=f"{APP_NAME} — API Vente & Stock")

# Workstations open the app from the server's own address, so private LAN
# origins are allowed by default; ALLOWED_ORIGINS narrows this in production.
_configured_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
LAN_ORIGIN_RE = (
    r"^https?://(localhost|127\.0\.0\.1|10\.[0-9.]+|192\.168\.[0-9.]+|"
    r"172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+)(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_configured_origins,
    allow_origin_regex=None if _configured_origins else LAN_ORIGIN_RE,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(dashboard.router)
app.include_router(products.router)
app.include_router(categories.router)
app.include_router(suppliers.router)
app.include_router(customers.router)
app.include_router(sales.router)
app.include_router(settings.router)
app.include_router(users.router)
app.include_router(notifications.router)
app.include_router(cash.router)
app.include_router(inventory.router)
app.include_router(accounting.router)
app.include_router(returns.router)
app.include_router(proformas.router)
app.include_router(reports.router)
app.include_router(sync.router)
app.include_router(updates.router)
app.include_router(orders.router)
app.include_router(history_router.router)
app.include_router(backups.router)

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _user_id(request: Request) -> Optional[int]:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    try:
        payload = jwt.decode(
            header.split(" ", 1)[1], SECRET_KEY, algorithms=[ALGORITHM]
        )
    except JWTError:
        return None
    subject = payload.get("sub")
    return int(subject) if subject else None


@app.middleware("http")
async def record_workstation(request: Request, call_next):
    """Remember which machines use this server, to list them in the settings."""
    if request.url.path.startswith("/api/"):
        clients.record(
            request.client.host if request.client else "", _user_id(request)
        )
    return await call_next(request)


@app.middleware("http")
async def record_undoable_action(request: Request, call_next):
    """Snapshot the rows a write touches, so it can be undone afterwards."""
    label = (
        history.label_for(request.method, request.url.path)
        if request.method in WRITE_METHODS
        else ""
    )
    if not label:
        return await call_next(request)
    recorder = history.start(label, _user_id(request))
    try:
        response = await call_next(request)
    finally:
        history.stop()
    if response.status_code < 400:
        history.persist(recorder)
    return response


@app.on_event("startup")
def on_startup():
    seed()
    sync.trim_change_log()
    db = SessionLocal()
    try:
        backup.auto_backup_if_due(db)
    except Exception as exc:  # a failed backup must never block the app
        print(f"Sauvegarde automatique impossible : {exc}")
    finally:
        db.close()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": APP_NAME,
        "version": APP_VERSION,
    }


def _lan_ip() -> str:
    """Address of this computer on the shop's network."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return str(sock.getsockname()[0])
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


@app.get("/api/network")
def network(request: Request):
    """Address to type on the phone or on the other workstations."""
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    address = f"{_lan_ip()}:{port}"
    return {"address": address, "url": f"http://{address}"}


@app.get("/api/network/clients")
def network_clients(
    db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    """Workstations and phones that used this server, with their address."""
    seen = clients.connected()
    identifiers = [entry["user_id"] for entry in seen if entry["user_id"]]
    names = {
        user.id: user.name
        for user in db.query(User).filter(User.id.in_(identifiers)).all()
    }
    return [
        {
            "address": entry["address"],
            "user": names.get(entry["user_id"]) if entry["user_id"] else None,
            "last_seen": entry["last_seen"],
            "active": entry["active"],
        }
        for entry in seen
    ]


def _frontend_dir() -> Optional[Path]:
    """Locate the built frontend (bundled in the executable or dev dist)."""
    if getattr(sys, "frozen", False):
        candidate = Path(sys._MEIPASS) / "frontend_dist"
    else:
        candidate = (
            Path(__file__).resolve().parent.parent.parent
            / "frontend"
            / "dist"
        )
    return candidate if candidate.exists() else None


FRONTEND_DIR = _frontend_dir()

if FRONTEND_DIR is not None:
    _assets = FRONTEND_DIR / "assets"
    if _assets.exists():
        app.mount(
            "/assets", StaticFiles(directory=str(_assets)), name="assets"
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        # API routes are registered earlier and take priority; unmatched API
        # paths must 404 rather than fall back to the SPA.
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = FRONTEND_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIR / "index.html"))
