"""Remote update of the Windows package installed on customer machines.

The server publishes each release on GitHub; every installation polls that
repository, downloads the new executable and swaps it in through a small
batch script that runs after the current process exits (Windows keeps a
running .exe locked, so it cannot overwrite itself).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from .version import (
    APP_VERSION,
    UPDATE_ASSET,
    UPDATE_INSTALLER_ASSET,
    UPDATE_REPO,
    is_newer,
)

RELEASE_API = "https://api.github.com/repos/{repo}/releases/latest"
TIMEOUT = 20


@dataclass
class Release:
    version: str
    download_url: str  # portable executable
    installer_url: str  # EasyGest_Setup.exe
    notes: str
    published_at: str


class UpdateError(RuntimeError):
    pass


def _repo() -> str:
    return os.getenv("UPDATE_REPO", UPDATE_REPO)


def is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False))


def is_installed() -> bool:
    """True when the app was set up with EasyGest_Setup.exe.

    The Inno Setup uninstaller sits next to the program, and the installed
    copy usually lives in a folder only an administrator may write to, so the
    update has to run the new installer instead of swapping the file.
    """
    if not is_packaged():
        return False
    folder = Path(sys.executable).resolve().parent
    return any(folder.glob("unins*.exe"))


def latest_release() -> Release:
    url = RELEASE_API.format(repo=_repo())
    request = urllib.request.Request(
        url, headers={"Accept": "application/vnd.github+json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise UpdateError(f"Serveur de mise à jour injoignable : {exc}") from exc

    def url_of(name: str) -> str:
        return next(
            (
                asset["browser_download_url"]
                for asset in payload.get("assets", [])
                if asset.get("name") == name
            ),
            "",
        )

    return Release(
        version=str(payload.get("tag_name", "")),
        download_url=url_of(os.getenv("UPDATE_ASSET", UPDATE_ASSET)),
        installer_url=url_of(UPDATE_INSTALLER_ASSET),
        notes=str(payload.get("body", "") or ""),
        published_at=str(payload.get("published_at", "") or ""),
    )


def update_available(release: Release) -> bool:
    return bool(release.version) and is_newer(release.version, APP_VERSION)


def _download(url: str, destination: Path) -> None:
    try:
        with urllib.request.urlopen(url, timeout=300) as response:
            destination.write_bytes(response.read())
    except (urllib.error.URLError, TimeoutError) as exc:
        raise UpdateError(f"Téléchargement impossible : {exc}") from exc
    if destination.stat().st_size < 1_000_000:
        raise UpdateError("Fichier téléchargé incomplet.")


SWAP_SCRIPT = """@echo off
rem Replaces the running executable once it has exited, then restarts it.
timeout /t 3 /nobreak >nul
:retry
move /y "{new}" "{current}" >nul 2>&1
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto retry
)
start "" "{current}"
del "%~f0"
"""


def install(release: Release) -> Path:
    """Fetch the new version and schedule it; the caller then exits.

    An installed copy runs the new EasyGest_Setup.exe silently (it upgrades in
    place and keeps the data, which lives in %PROGRAMDATA%); a portable copy has
    its own file swapped by a small script once the process has exited.
    """
    if not is_packaged():
        raise UpdateError(
            "La mise à jour automatique n'est disponible que depuis "
            "l'application installée (EasyGest.exe)."
        )

    if is_installed():
        if not release.installer_url:
            raise UpdateError(
                "Aucun installateur EasyGest_Setup.exe dans cette version."
            )
        staged = Path(tempfile.gettempdir()) / "EasyGest_Setup.exe"
        _download(release.installer_url, staged)
        subprocess.Popen(
            [str(staged), "/SILENT", "/NORESTART", "/RESTARTAPPLICATIONS"],
            close_fds=True,
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
        )
        return staged

    if not release.download_url:
        raise UpdateError("Aucun fichier d'installation dans cette version.")
    current = Path(sys.executable).resolve()
    staged = current.with_name(f"{current.stem}.new{current.suffix}")
    _download(release.download_url, staged)

    script = Path(tempfile.gettempdir()) / "easygest_update.bat"
    script.write_text(
        SWAP_SCRIPT.format(new=staged, current=current), encoding="utf-8"
    )
    subprocess.Popen(
        ["cmd", "/c", "start", "", "/min", str(script)],
        close_fds=True,
        creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
    )
    return staged


def shutdown_soon(delay: float = 1.5) -> None:
    """Let the HTTP response reach the browser before the process dies."""

    def stop() -> None:
        time.sleep(delay)
        os._exit(0)

    threading.Thread(target=stop, daemon=True).start()
