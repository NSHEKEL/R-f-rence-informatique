import os
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import backup, clients, history, licensing
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
    license as license_router,
    notifications,
    orders,
    permissions,
    products,
    purchases,
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


def feature(code: str) -> list:
    """Guard every route of a module with the plan the client subscribed to."""
    return [Depends(licensing.require_feature(code))]


app.include_router(auth.router)
app.include_router(dashboard.router, dependencies=feature("tableau_bord"))
app.include_router(products.router, dependencies=feature("produits"))
app.include_router(purchases.router, dependencies=feature("achats"))
app.include_router(categories.router, dependencies=feature("categories"))
app.include_router(suppliers.router, dependencies=feature("fournisseurs"))
app.include_router(customers.router, dependencies=feature("clients"))
app.include_router(sales.router, dependencies=feature("ventes"))
app.include_router(settings.router)
app.include_router(users.router, dependencies=feature("gestion_utilisateurs"))
app.include_router(notifications.router)
app.include_router(permissions.router)
app.include_router(cash.router, dependencies=feature("versements"))
app.include_router(inventory.router, dependencies=feature("stock"))
app.include_router(accounting.router, dependencies=feature("dettes"))
app.include_router(returns.router, dependencies=feature("fonctions_avancees"))
app.include_router(proformas.router, dependencies=feature("fonctions_avancees"))
app.include_router(reports.router, dependencies=feature("rapports"))
app.include_router(sync.router)
app.include_router(updates.router)
app.include_router(orders.router, dependencies=feature("dettes"))
app.include_router(history_router.router)
app.include_router(
    backups.router,
    # Even suspended, a shop must be able to save its data.
    dependencies=[
        Depends(licensing.require_feature("sauvegarde", even_when_blocked=True))
    ],
)
app.include_router(license_router.router)

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# Paths a shop must keep even with a suspended or expired licence: signing in,
# reading and fixing the licence itself, and saving its data.
LICENSE_FREE_PREFIXES = (
    "/api/auth",
    "/api/license",
    "/api/backups",
    "/api/updates",
)

# How often the workstation checks its licence with the central server.
SYNC_INTERVAL_SECONDS = int(os.getenv("EASYGEST_LICENSE_SYNC_SECONDS", "3600"))


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
async def enforce_license(request: Request, call_next):
    """A suspended, expired or revoked licence freezes the shop's data.

    Nothing is ever deleted: reading stays open so the shop can consult and
    export its history, only new writes are refused.
    """
    path = request.url.path
    if request.method not in WRITE_METHODS or not path.startswith("/api/"):
        return await call_next(request)
    if path.startswith(LICENSE_FREE_PREFIXES):
        return await call_next(request)
    db = SessionLocal()
    try:
        view = licensing.current(db)
    finally:
        db.close()
    if view.blocked:
        return JSONResponse(status_code=403, content={"detail": view.message})
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


def _license_loop() -> None:
    """Check in with the central server, quietly, for as long as we run."""
    while True:
        db = SessionLocal()
        try:
            licensing.synchronise(db, quiet=True)
        except Exception as exc:  # noqa: BLE001 - a check must never crash
            print(f"Synchronisation de licence impossible : {exc}")
        finally:
            db.close()
        time.sleep(SYNC_INTERVAL_SECONDS)


@app.on_event("startup")
def on_startup():
    seed()
    threading.Thread(target=_license_loop, daemon=True).start()
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
