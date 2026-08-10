import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .database import Base, engine
from .migrate import migrate
from .routers import (
    accounting,
    auth,
    cash,
    categories,
    customers,
    dashboard,
    inventory,
    notifications,
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
from .version import APP_VERSION

Base.metadata.create_all(bind=engine)
migrate()

app = FastAPI(title="Référence Informatique — API Vente & Stock")

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


@app.on_event("startup")
def on_startup():
    seed()
    sync.trim_change_log()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": "Référence Informatique",
        "version": APP_VERSION,
    }


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
