"""Central server: the API of the licences and the global administrator console.

Run it apart from the shops::

    cd backend
    CENTRAL_ADMIN_EMAIL=... CENTRAL_ADMIN_PASSWORD=... \\
        venv/bin/python -m uvicorn app.central.server:app --port 8200
"""

import os
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..version import APP_NAME, APP_VERSION
from .routers import auth, console, provisioning
from .seed import seed

app = FastAPI(title=f"{APP_NAME} — Serveur central")

_origins = [
    origin.strip()
    for origin in os.getenv("CENTRAL_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    # Installations call from any address on the internet; the API is
    # protected by the installation token, not by the origin.
    allow_origins=_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(console.router)
app.include_router(provisioning.router)


@app.on_event("startup")
def on_startup() -> None:
    seed()


@app.get("/api/central/health")
def health():
    return {"status": "ok", "service": "central", "version": APP_VERSION}


def _console_dir() -> Path | None:
    """The console is a route of the EasyGest frontend build.

    Inside EasyGestAdmin.exe the build is bundled next to the code, so the
    packaged console keeps working without any development checkout.
    """
    candidates = []
    try:
        candidates.append(Path(sys._MEIPASS) / "frontend_dist")  # noqa: SLF001
    except AttributeError:
        pass
    candidates.append(Path(__file__).resolve().parents[3] / "frontend" / "dist")
    return next((path for path in candidates if path.exists()), None)


CONSOLE_DIR = _console_dir()

if CONSOLE_DIR is not None:
    _assets = CONSOLE_DIR / "assets"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = CONSOLE_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(CONSOLE_DIR / "index.html"))
