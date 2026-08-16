"""EasyGest launcher: local server + native desktop window.

The application is a FastAPI server (which also serves the built React
frontend) displayed inside a native window. Nothing is shown to the user
except that window: no console, no external browser, no manual command.

Modes:

* default            -> desktop window on this machine only (127.0.0.1);
* ``EASYGEST_HOST``  -> address the server listens on; set it to ``0.0.0.0``
                        on the shop's main computer so the other workstations
                        can use the same database;
* ``--server``       -> no window, useful to keep the shared server running.
"""

import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request

import uvicorn

# Importing the database module reads the .env of the data directory, so the
# settings below already see EASYGEST_HOST/EASYGEST_PORT when they are set
# there rather than in the system environment.
import app.database  # noqa: F401
from app.paths import data_dir
from app.version import APP_NAME, APP_VERSION

DEFAULT_PORT = int(os.getenv("EASYGEST_PORT", "8000"))
HOST = os.getenv("EASYGEST_HOST", "127.0.0.1").strip() or "127.0.0.1"
HEADLESS = "--server" in sys.argv or os.getenv("EASYGEST_HEADLESS") == "1"


def _free_port(preferred: int) -> int:
    """First port available from the preferred one, so a busy port is not
    an error the user has to solve with a command line."""
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind((HOST, port))
                return port
            except OSError:
                continue
    raise SystemExit("Aucun port disponible pour démarrer EasyGest.")


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
            with urllib.request.urlopen(f"{url}/api/health", timeout=2):
                return True
        except (urllib.error.URLError, OSError):
            time.sleep(0.25)
    return False


def _serve(port: int) -> None:
    from app.main import app

    uvicorn.run(app, host=HOST, port=port, log_level="warning")


def _open_window(url: str) -> bool:
    """Show the application in a native window. False if unavailable."""
    try:
        import webview
    except ImportError:
        return False
    window = webview.create_window(
        APP_NAME,
        url,
        width=1400,
        height=900,
        min_size=(1024, 700),
        confirm_close=True,
    )
    window.events.closed += lambda: os._exit(0)
    webview.start()
    return True


def main() -> None:
    port = _free_port(DEFAULT_PORT)
    url = f"http://127.0.0.1:{port}"
    threading.Thread(target=_serve, args=(port,), daemon=True).start()
    _wait_until_ready(url)

    if HEADLESS:
        print(f"{APP_NAME} {APP_VERSION} — serveur partagé")
        print(f" Ce poste          : {url}")
        if HOST == "0.0.0.0":
            print(f" Autres postes     : http://{_lan_ip()}:{port}")
        print(f" Données           : {data_dir()}")
        print(" Fermez cette fenêtre pour arrêter le serveur.")
        while True:
            time.sleep(3600)

    if not _open_window(url):
        # No native web view available (development machine): fall back to the
        # default browser rather than leaving the user with nothing.
        import webbrowser

        webbrowser.open(url)
        while True:
            time.sleep(3600)


if __name__ == "__main__":
    main()
