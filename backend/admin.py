"""EasyGest Admin launcher: the Global Administrator console.

This is the owner's application, distinct from the shop application. It shows
the console of the hosted central server, so the clients it manages are the
real ones — the shops synchronise with that server, not with this computer.

Modes:

* default            -> desktop window on the hosted console;
* ``--local``        -> run the central server on this computer instead (also
                        used automatically when the hosted server cannot be
                        reached), with ``EASYGEST_ADMIN_HOST`` /
                        ``EASYGEST_ADMIN_PORT`` for the shops of the local
                        network;
* ``EASYGEST_CENTRAL_URL`` -> address of the hosted server (empty = local);
* ``--server``       -> no window, to keep the central server running;
* ``--selftest``     -> start, check the API answers, exit (used by the build).
"""

import os
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn

from app.paths import data_dir
from app.version import APP_NAME, APP_VERSION

ADMIN_NAME = f"{APP_NAME} Admin"


def _central_dir() -> Path:
    """Where central.db and the signing key live, outside Program Files."""
    directory = Path(
        os.getenv("CENTRAL_DATA_DIR", "").strip() or data_dir() / "central"
    )
    directory.mkdir(parents=True, exist_ok=True)
    return directory


# Read before importing the central package: its database URL is resolved at
# import time, and the packaged executable must not write next to its own files.
CENTRAL_DIR = _central_dir()
os.environ.setdefault("CENTRAL_DATA_DIR", str(CENTRAL_DIR))

DEFAULT_PORT = int(os.getenv("EASYGEST_ADMIN_PORT", "8600"))
HOST = os.getenv("EASYGEST_ADMIN_HOST", "0.0.0.0").strip() or "0.0.0.0"
HEADLESS = "--server" in sys.argv or os.getenv("EASYGEST_ADMIN_HEADLESS") == "1"
SELFTEST = "--selftest" in sys.argv
FORCE_LOCAL = "--local" in sys.argv or HEADLESS
LOG_FILE = CENTRAL_DIR / "easygest-admin.log"


def _hosted_url() -> str:
    """Address of the hosted central server, the one the shops talk to."""
    from app.licensing import central_url

    return central_url()


def _redirect_output() -> None:
    """A windowed executable has no console: printing would kill it."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        log = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    except OSError:
        log = open(os.devnull, "w", encoding="utf-8")
    if sys.stdout is None:
        sys.stdout = log
    if sys.stderr is None:
        sys.stderr = log


def _report(message: str) -> None:
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as log:
            log.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n{message}\n")
    except OSError:
        pass
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            None,
            f"{message}\n\nDétails : {LOG_FILE}",
            f"{ADMIN_NAME} {APP_VERSION}",
            0x10,
        )


def _free_port(preferred: int) -> int:
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((HOST, port))
                return port
            except OSError:
                continue
    raise SystemExit("Aucun port disponible pour démarrer la console.")


def _lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def _wait_until_ready(url: str, timeout: float = 40.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/api/central/health", timeout=2):
                return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.25)
    return False


def _serve(port: int) -> None:
    try:
        from app.central.server import app

        uvicorn.run(app, host=HOST, port=port, log_level="warning")
    except Exception:  # noqa: BLE001 - the thread must not die silently
        traceback.print_exc()


def _open_window(url: str) -> bool:
    try:
        import webview
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return False
    try:
        window = webview.create_window(
            ADMIN_NAME,
            f"{url}/console/connexion",
            width=1400,
            height=900,
            min_size=(1024, 700),
            confirm_close=True,
            text_select=True,
        )
        window.events.closed += lambda: os._exit(0)
        webview.start(
            private_mode=False,
            storage_path=str(CENTRAL_DIR / "webview"),
        )
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return False
    return True


def _selftest(url: str) -> None:
    problems = []
    if not _wait_until_ready(url, timeout=60):
        problems.append("le serveur central ne répond pas sur /api/central/health")
    if sys.platform == "win32":
        try:
            import clr  # noqa: F401
            import webview  # noqa: F401
            from webview.platforms import winforms  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            problems.append(f"fenêtre native indisponible : {exc!r}")
    if problems:
        print("SELFTEST KO : " + " ; ".join(problems))
        raise SystemExit(1)
    print(f"SELFTEST OK — {ADMIN_NAME} {APP_VERSION}")


def main() -> None:
    _redirect_output()

    hosted = "" if FORCE_LOCAL else _hosted_url()
    if hosted and _wait_until_ready(hosted, timeout=12):
        if SELFTEST:
            _selftest(hosted)
            return
        if _open_window(hosted):
            return
        import webbrowser

        _report(
            "La fenêtre de la console n'a pas pu s'ouvrir (composant "
            "d'affichage Microsoft Edge WebView2 manquant).\nLa console "
            "continue dans votre navigateur ; installez WebView2 puis "
            "relancez l'application."
        )
        webbrowser.open(f"{hosted}/console/connexion")
        while True:
            time.sleep(3600)

    port = _free_port(DEFAULT_PORT)
    url = f"http://127.0.0.1:{port}"
    threading.Thread(target=_serve, args=(port,), daemon=True).start()

    if SELFTEST:
        _selftest(url)
        return

    ready = _wait_until_ready(url)

    if HEADLESS:
        print(f"{ADMIN_NAME} {APP_VERSION} — serveur central")
        print(f" Console           : {url}/console")
        if HOST != "127.0.0.1":
            print(f" Boutiques         : http://{_lan_ip()}:{port}")
        print(f" Données           : {CENTRAL_DIR}")
        while True:
            time.sleep(3600)

    if not ready:
        _report(
            "La console Administrateur Global n'a pas pu démarrer son service "
            "interne.\nVérifiez qu'aucun antivirus ne bloque l'application, "
            "puis relancez-la."
        )
        raise SystemExit(1)

    if _open_window(url):
        return

    import webbrowser

    _report(
        "La fenêtre de la console n'a pas pu s'ouvrir (composant d'affichage "
        "Microsoft Edge WebView2 manquant).\nLa console continue dans votre "
        "navigateur ; installez WebView2 puis relancez l'application."
    )
    webbrowser.open(f"{url}/console/connexion")
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 - never exit without telling the user
        _report(
            "La console Administrateur Global n'a pas pu démarrer.\n\n"
            + traceback.format_exc()
        )
