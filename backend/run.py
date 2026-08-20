"""EasyGest launcher: local server + native desktop window.

The application is a FastAPI server (which also serves the built React
frontend) displayed inside a native window. Nothing is shown to the user
except that window: no console, no external browser, no manual command.

Modes:

* default            -> desktop window, server reachable from the local
                        network so the other workstations and the Android
                        application can use the same database;
* ``EASYGEST_HOST``  -> address the server listens on; set it to ``127.0.0.1``
                        to keep the data on this machine only;
* ``--server``       -> no window, useful to keep the shared server running;
* ``--selftest``     -> start the server, check it answers, exit (used by the
                        build to prove the packaged executable really runs).
"""

import os
import socket
import sys
import threading
import time
import traceback
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
HOST = os.getenv("EASYGEST_HOST", "0.0.0.0").strip() or "0.0.0.0"
HEADLESS = "--server" in sys.argv or os.getenv("EASYGEST_HEADLESS") == "1"
SELFTEST = "--selftest" in sys.argv


def _redirect_output() -> None:
    """A windowed executable has no console: without this, every print and
    every log line raises and the application dies without a word."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        log = open(data_dir() / "easygest.log", "a", encoding="utf-8", buffering=1)
    except OSError:
        log = open(os.devnull, "w", encoding="utf-8")
    if sys.stdout is None:
        sys.stdout = log
    if sys.stderr is None:
        sys.stderr = log


def _report(message: str) -> None:
    """Tell the user why the window did not appear instead of exiting mute."""
    try:
        with open(data_dir() / "easygest.log", "a", encoding="utf-8") as log:
            log.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n{message}\n")
    except OSError:
        pass
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            None,
            f"{message}\n\nDétails : {data_dir()}\\easygest.log",
            f"{APP_NAME} {APP_VERSION}",
            0x10,
        )


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
    try:
        from app.main import app

        uvicorn.run(app, host=HOST, port=port, log_level="warning")
    except Exception:  # noqa: BLE001 - the thread must not die silently
        traceback.print_exc()


class DesktopApi:
    """Bridge exposed to the page as ``window.pywebview.api``.

    The application runs without a browser, so file dialogs have to be
    provided by the window itself.
    """

    def __init__(self) -> None:
        self.window = None

    def choose_folder(self) -> str:
        """Real Windows folder picker used to select the backup folder."""
        import webview

        if self.window is None:
            return ""
        chosen = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if not chosen:
            return ""
        return chosen[0] if isinstance(chosen, (list, tuple)) else str(chosen)


def _open_window(url: str) -> bool:
    """Show the application in a native window. False if unavailable."""
    try:
        import webview
    except Exception:  # noqa: BLE001 - missing runtime, broken install...
        traceback.print_exc()
        return False
    try:
        api = DesktopApi()
        window = webview.create_window(
            APP_NAME,
            url,
            width=1400,
            height=900,
            min_size=(1024, 700),
            confirm_close=True,
            js_api=api,
        )
        api.window = window
        window.events.closed += lambda: os._exit(0)
        # Without an explicit storage path the window runs in private mode and
        # forgets everything the page saved (session, last user name, screen
        # preferences) as soon as the computer is restarted.
        webview.start(
            private_mode=False,
            storage_path=str(data_dir() / "webview"),
        )
    except Exception:  # noqa: BLE001 - no WebView2 runtime, no .NET...
        traceback.print_exc()
        return False
    return True


def _selftest(url: str) -> None:
    """Prove the packaged executable works: the server answers and the native
    window backend can be loaded."""
    problems = []
    if not _wait_until_ready(url, timeout=60):
        problems.append("le serveur ne répond pas sur /api/health")
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
    print(f"SELFTEST OK — {APP_NAME} {APP_VERSION}")


def main() -> None:
    _redirect_output()
    port = _free_port(DEFAULT_PORT)
    url = f"http://127.0.0.1:{port}"
    threading.Thread(target=_serve, args=(port,), daemon=True).start()

    if SELFTEST:
        _selftest(url)
        return

    ready = _wait_until_ready(url)

    if HEADLESS:
        print(f"{APP_NAME} {APP_VERSION} — serveur partagé")
        print(f" Ce poste          : {url}")
        if HOST != "127.0.0.1":
            print(f" Autres postes     : http://{_lan_ip()}:{port}")
        print(f" Données           : {data_dir()}")
        print(" Fermez cette fenêtre pour arrêter le serveur.")
        while True:
            time.sleep(3600)

    if not ready:
        _report(
            "EasyGest n'a pas pu démarrer son service interne.\n"
            "Vérifiez qu'aucun antivirus ne bloque l'application, puis "
            "relancez-la."
        )
        raise SystemExit(1)

    if _open_window(url):
        return

    # No native web view available: rather than leaving the user with nothing,
    # fall back to the default browser and say so.
    import webbrowser

    _report(
        "La fenêtre EasyGest n'a pas pu s'ouvrir (composant d'affichage "
        "Microsoft Edge WebView2 manquant).\n"
        "L'application continue dans votre navigateur ; installez WebView2 "
        "puis relancez EasyGest pour retrouver la fenêtre normale."
    )
    webbrowser.open(url)
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 - never exit without telling the user
        _report("EasyGest n'a pas pu démarrer.\n\n" + traceback.format_exc())
        raise SystemExit(1)
