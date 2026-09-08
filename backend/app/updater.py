"""Remote update of the Windows package installed on customer machines.

The server publishes each release on GitHub; every installation polls that
repository, downloads the new executable and swaps it in through a small
batch script that runs after the current process exits (Windows keeps a
running .exe locked, so it cannot overwrite itself).
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import ssl
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
TIMEOUT = 30
ATTEMPTS = 4
CHUNK = 256 * 1024


def _ssl_context() -> ssl.SSLContext:
    """Trusted authorities, taken from certifi when the app is packaged.

    A frozen executable carries no system certificate store, and a proxy that
    cuts the connection makes OpenSSL report UNEXPECTED_EOF_WHILE_READING.
    """
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001 - fall back to the system store
        return ssl.create_default_context()


def _urlopen(request: urllib.request.Request, timeout: int):
    return urllib.request.urlopen(request, timeout=timeout, context=_ssl_context())


def _friendly(exc: Exception) -> str:
    """Say what the user can act on, not what OpenSSL printed."""
    text = str(exc)
    if "EOF" in text or "SSL" in text.upper():
        return (
            "la connexion sécurisée a été coupée (Internet instable, pare-feu "
            "ou antivirus). Réessayez dans un instant."
        )
    return text


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
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"EasyGest/{APP_VERSION}",
        },
    )
    last: Exception | None = None
    payload = None
    for attempt in range(ATTEMPTS):
        try:
            with _urlopen(request, TIMEOUT) as response:
                payload = json.load(response)
            break
        except (
            urllib.error.URLError,
            ssl.SSLError,
            socket.timeout,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
        ) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    if payload is None:
        raise UpdateError(
            f"Serveur de mise à jour injoignable : {_friendly(last or OSError())}"
        ) from last

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
    """Fetch the release, resuming where a cut connection left off.

    Downloads of forty megabytes over a shaky line fail often; restarting from
    zero each time never finishes, so the partial file is kept and the server
    is asked for the rest.
    """
    partial = destination.with_suffix(destination.suffix + ".part")
    last: Exception | None = None
    for attempt in range(ATTEMPTS):
        done = partial.stat().st_size if partial.exists() else 0
        headers = {"User-Agent": f"EasyGest/{APP_VERSION}"}
        if done:
            headers["Range"] = f"bytes={done}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            with _urlopen(request, TIMEOUT * 10) as response:
                mode = "ab" if done and response.status == 206 else "wb"
                if mode == "wb":
                    done = 0
                with open(partial, mode) as handle:
                    while True:
                        block = response.read(CHUNK)
                        if not block:
                            break
                        handle.write(block)
            if partial.stat().st_size < 1_000_000:
                raise UpdateError("Fichier téléchargé incomplet.")
            destination.unlink(missing_ok=True)
            shutil.move(str(partial), str(destination))
            return
        except (
            urllib.error.URLError,
            ssl.SSLError,
            socket.timeout,
            TimeoutError,
            OSError,
        ) as exc:
            last = exc
            time.sleep(2.0 * (attempt + 1))
    partial.unlink(missing_ok=True)
    raise UpdateError(
        f"Téléchargement impossible : {_friendly(last or OSError())}"
    ) from last


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


def _staging_dir() -> Path:
    from .paths import data_dir

    folder = data_dir() / "updates"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _marker() -> Path:
    return _staging_dir() / "pending.json"


def pending_update() -> tuple[str, Path] | None:
    """Version already downloaded and waiting to be installed at next start."""
    marker = _marker()
    if not marker.exists():
        return None
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
        version = str(data.get("version", ""))
        target = Path(str(data.get("file", "")))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    if not version or not target.exists() or not is_newer(version, APP_VERSION):
        clear_pending()
        return None
    return version, target


def clear_pending() -> None:
    pending = _marker()
    try:
        if pending.exists():
            data = json.loads(pending.read_text(encoding="utf-8"))
            Path(str(data.get("file", ""))).unlink(missing_ok=True)
    except (OSError, json.JSONDecodeError, ValueError):
        pass
    pending.unlink(missing_ok=True)


def stage_update() -> str:
    """Download the new version in the background, without installing it.

    Installing while the user works would close the application under their
    hands; the file is kept and applied the next time EasyGest starts.
    """
    if not is_packaged():
        return ""
    already = pending_update()
    release = latest_release()
    if not update_available(release):
        if already:
            clear_pending()
        return ""
    if already and already[0] == release.version:
        return already[0]
    clear_pending()

    installed = is_installed()
    url = release.installer_url if installed else release.download_url
    if not url:
        raise UpdateError("Aucun fichier d'installation dans cette version.")
    target = _staging_dir() / (
        "EasyGest_Setup.exe" if installed else Path(sys.executable).name
    )
    _download(url, target)
    _marker().write_text(
        json.dumps({"version": release.version, "file": str(target)}),
        encoding="utf-8",
    )
    return release.version


def apply_pending() -> bool:
    """Install a downloaded version. True when the caller must exit at once."""
    pending = pending_update()
    if pending is None or not is_packaged():
        return False
    _version, staged = pending
    try:
        if is_installed():
            subprocess.Popen(
                [str(staged), "/SILENT", "/NORESTART", "/RESTARTAPPLICATIONS"],
                close_fds=True,
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
            )
        else:
            current = Path(sys.executable).resolve()
            script = Path(tempfile.gettempdir()) / "easygest_update.bat"
            script.write_text(
                SWAP_SCRIPT.format(new=staged, current=current), encoding="utf-8"
            )
            subprocess.Popen(
                ["cmd", "/c", "start", "", "/min", str(script)],
                close_fds=True,
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0),
            )
    except OSError:
        return False
    _marker().unlink(missing_ok=True)
    return True


def stage_in_background(delay: float = 20.0) -> None:
    """Prepare the next version quietly, whoever is signed in.

    Sellers and stock managers never see an update message, but their
    workstation still updates itself at the following start.
    """
    if not is_packaged() or os.getenv("EASYGEST_AUTO_UPDATE") == "0":
        return

    def run() -> None:
        time.sleep(delay)
        while True:
            try:
                stage_update()
            except UpdateError:
                pass
            time.sleep(6 * 3600)

    threading.Thread(target=run, daemon=True).start()


def shutdown_soon(delay: float = 1.5) -> None:
    """Let the HTTP response reach the browser before the process dies."""

    def stop() -> None:
        time.sleep(delay)
        os._exit(0)

    threading.Thread(target=stop, daemon=True).start()
