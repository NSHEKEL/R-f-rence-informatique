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

import ctypes
import json
import logging
import os
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path
from dotenv import load_dotenv

# app.paths is light: import it before the heavy modules so the boot markers
# can be written even when one of them fails (a crash there used to leave no
# log at all, which made the frozen selftest undebuggable).
from app.paths import data_dir


def _log_path() -> Path:
    system = os.getenv("USERNAME", "").upper() == "SYSTEM" or "systemprofile" in str(Path.home()).lower()
    local = os.getenv("LOCALAPPDATA")
    directory = Path(local) / "EasyGest" / "Logs" if local and not system else data_dir() / "Logs"
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError:
        directory = data_dir() / "Logs"
        directory.mkdir(parents=True, exist_ok=True)
    return directory / "easygest.log"


_file_handler = logging.FileHandler(_log_path(), encoding="utf-8")
_file_handler.setLevel(logging.WARNING)
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)s %(name)s %(message)s"
))
logging.getLogger().addHandler(_file_handler)
try:
    _legacy_handler = logging.FileHandler(data_dir() / "easygest.log", encoding="utf-8")
    _legacy_handler.setLevel(logging.WARNING)
    _legacy_handler.setFormatter(_file_handler.formatter)
    logging.getLogger().addHandler(_legacy_handler)
except OSError:
    pass


def _append_log(message: str) -> None:
    with open(_log_path(), "a", encoding="utf-8") as output:
        output.write(message)
    try:
        with open(data_dir() / "easygest.log", "a", encoding="utf-8") as output:
            output.write(message)
    except OSError:
        pass


def _boot(message: str) -> None:
    try:
        _append_log(f"{time.strftime('%H:%M:%S')} BOOT {message}\n")
    except OSError:
        pass


_boot("demarrage")
import uvicorn  # noqa: E402

# Read deployment settings without opening the database before server reuse.
_boot("uvicorn")
_env_files = [Path(__file__).resolve().parent / ".env"]
if getattr(sys, "frozen", False):
    _env_files = [Path(sys.executable).parent / ".env", data_dir() / ".env", *_env_files]
for _env in _env_files:
    load_dotenv(_env, override=False)
from app import escpos, printing  # noqa: E402
from app.version import APP_NAME, APP_VERSION  # noqa: E402

_boot("imports ok")

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
        log = open(_log_path(), "a", encoding="utf-8", buffering=1)
    except OSError:
        log = open(os.devnull, "w", encoding="utf-8")
    if sys.stdout is None:
        sys.stdout = log
    if sys.stderr is None:
        sys.stderr = log


def _report(message: str) -> None:
    """Tell the user why the window did not appear instead of exiting mute."""
    try:
        _append_log(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n{message}\n")
    except OSError:
        pass
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(
            None,
            f"{message}\n\nDétails : {_log_path()}",
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


def _wait_until_ready(url: str, timeout: float = 90.0) -> bool:
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


def _existing_server(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as response:
            info = json.loads(response.read(4096))
        return info.get("status") == "ok" and info.get("app") == APP_NAME and info.get("version") == APP_VERSION
    except (OSError, ValueError, AttributeError):
        return False


def _start_backend(preferred: int, reuse: bool = True) -> tuple[int, bool]:
    if reuse and _existing_server(preferred):
        return preferred, False
    port = _free_port(preferred)
    threading.Thread(target=_serve, args=(port,), daemon=True).start()
    return port, True


class DesktopApi:
    """Bridge exposed to the page as ``window.pywebview.api``.

    The application runs without a browser, so file dialogs have to be
    provided by the window itself.
    """

    def __init__(self) -> None:
        self._window = None

    def choose_folder(self) -> str:
        """Real Windows folder picker used to select the backup folder."""
        import webview

        if self._window is None:
            return ""
        chosen = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not chosen:
            return ""
        return chosen[0] if isinstance(chosen, (list, tuple)) else str(chosen)

    def save_file(self, filename: str, content: str) -> str:
        """Write an export to disk: the native window blocks browser downloads,
        so the Excel and PDF buttons would do nothing without this."""
        import webview

        if self._window is None:
            return ""
        target = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            directory=str(Path.home() / "Documents"),
            save_filename=filename,
        )
        if not target:
            return ""
        path = Path(target[0] if isinstance(target, (list, tuple)) else str(target))
        path.write_text(content, encoding="utf-8-sig")
        return str(path)

    @staticmethod
    def _pref_path(filename: str) -> Path:
        """Where the workstation's own files live. Program Files is
        read-only for a standard user, so the per-poste preferences go in
        %LOCALAPPDATA% — always writable, never needing admin rights, and
        scoped to this Windows session on this machine."""
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "EasyGest"
        try:
            base.mkdir(parents=True, exist_ok=True)
        except OSError:
            base = Path.home()
        return base / filename

    def write_pref_file(self, filename: str, content: str) -> str:
        """Backup of the per-workstation preferences (no dialog)."""
        try:
            path = self._pref_path(filename)
            path.write_text(content, encoding="utf-8")
            return str(path)
        except OSError:
            return ""

    def read_pref_file(self, filename: str) -> str:
        """Restore of the per-workstation preferences; empty when absent."""
        try:
            path = self._pref_path(filename)
            return path.read_text(encoding="utf-8") if path.exists() else ""
        except OSError:
            return ""

    def _printer_problem(self, printer_name: str) -> str:
        try:
            device = printing.queue_status(printer_name or printing.default_printer())
            return device.status if device is not None and not device.available else ""
        except Exception:
            logging.getLogger(__name__).warning("Statut imprimante non lisible", exc_info=True)
            return ""

    def print_ticket(self, payload: str) -> str:
        """Print a receipt straight on the counter printer.

        The lines come from the ticket shown on screen; sending them as
        ESC/POS bytes avoids the browser print preview, which stamps the date,
        the window title, the local address and a page number around the
        receipt. Returns an empty string on success, the reason otherwise, so
        the page can fall back on the browser printer.
        """
        try:
            data = json.loads(payload)
            problem = self._printer_problem(str(data.get("printer", "")))
            if problem:
                return f"Imprimante indisponible : {problem}"
            lines = [
                escpos.Line(
                    text=str(item.get("text", "")),
                    align=str(item.get("align", "left")),
                    bold=bool(item.get("bold", False)),
                    big=bool(item.get("big", False)),
                    barcode=str(item.get("barcode", "")),
                    image=str(item.get("image", "")),
                    image_width=int(item.get("image_width", 0)),
                    image_height=int(item.get("image_height", 0)),
                )
                for item in data.get("lines", [])
            ]
            copies = min(max(int(data.get("copies", 1)), 1), 5)
            # The drawer is wired to this printer: its kick code travels with
            # the ticket, so the till opens without a second trip.
            kick = bytes(
                value & 0xFF for value in data.get("kick", []) if
                isinstance(value, int)
            )
            stream = escpos.build(lines, bool(data.get("cut", True))) * copies
            if kick:
                stream += kick
            escpos.send(stream, str(data.get("printer", "")))
        except Exception as error:  # noqa: BLE001 - no printer, bad driver...
            traceback.print_exc()
            return str(error) or "Impression directe indisponible"
        return ""

    def print_page(
        self, width_mm: float, height_mm: float, margin_mm: float
    ) -> bool:
        """Print the receipt without the browser header and footer.

        The web printing dialog stamps the date, the window title, the local
        address and a page number around the ticket, and pads it to a full
        page. Driving the embedded WebView2 printer directly removes them and
        sets the exact roll geometry. Returns False when the native printer is
        not reachable, so the page falls back on ``window.print()``.
        """
        return self.print_to(width_mm, height_mm, margin_mm, "")

    def print_to(
        self, width_mm: float, height_mm: float, margin_mm: float,
        printer_name: str,
    ) -> bool:
        """Print to a chosen printer without any dialog.

        WebView2 selects the queue through PrintSettings.PrinterName.
        A runtime without that API reports failure rather than printing on
        a different queue.
        """
        if sys.platform != "win32" or self._window is None:
            return False
        try:
            from System import Action
            from webview.platforms.winforms import BrowserView

            form = BrowserView.instances[self._window.uid]
            if not form.InvokeRequired:
                logging.getLogger(__name__).warning("Impression refusée depuis le thread UI")
                return False
        except Exception:  # noqa: BLE001 - Linux, older runtime, no window
            traceback.print_exc()
            return False

        problem = self._printer_problem(printer_name)
        if problem:
            logging.getLogger(__name__).warning("Impression HTML — %s", problem)
            return False
        holder: dict = {}
        deadline = time.monotonic() + 30.0
        dispatched = threading.Event()
        log = logging.getLogger(__name__)
        log.warning("Impression HTML — demande vers %r", printer_name or "imprimante par défaut")

        def send() -> None:
            try:
                if time.monotonic() >= deadline:
                    return
                pending = getattr(self, "_pending_print_task", None)
                if pending is not None and not pending.IsCompleted:
                    log.warning("Impression HTML — tâche précédente encore en cours, nouvel envoi refusé")
                    return
                core = form.browser.webview.CoreWebView2
                settings = core.Environment.CreatePrintSettings()
                settings.PrinterName = printer_name
                settings.ShouldPrintHeaderAndFooter = False
                settings.ShouldPrintBackgrounds = True
                settings.PageWidth = max(width_mm, 20.0) / 25.4
                settings.PageHeight = max(height_mm, 20.0) / 25.4
                inches = max(margin_mm, 0.0) / 25.4
                settings.MarginTop = inches
                settings.MarginBottom = inches
                settings.MarginLeft = inches
                settings.MarginRight = inches
                holder["task"] = core.PrintAsync(settings)
                self._pending_print_task = holder["task"]
                log.warning("Impression HTML — PrintAsync lancé")
            except Exception:  # noqa: BLE001
                log.exception("Impression HTML — lancement impossible")
            finally:
                dispatched.set()

        try:
            form.BeginInvoke(Action(send))
            while not dispatched.is_set():
                if time.monotonic() >= deadline:
                    log.warning("Impression HTML — délai de dispatch UI dépassé")
                    return False
                time.sleep(0.05)
            task = holder.get("task")
            if task is None:
                return False
            while not task.IsCompleted:
                if time.monotonic() >= deadline:
                    log.warning("Impression HTML — délai PrintAsync dépassé ; résultat inconnu")
                    return False
                time.sleep(0.05)
            result = str(task.Result)
            log.warning("Impression HTML — résultat %s", result)
            return result == "Succeeded"
        except Exception:  # noqa: BLE001
            log.exception("Impression HTML — échec")
            return False

    def toggle_fullscreen(self) -> bool:
        """Full screen for the counter: the web API alone cannot resize the
        native window."""
        if self._window is None:
            return False
        self._window.toggle_fullscreen()
        return True


# pywebview speaks English by default; the close dialog is the only text of
# the native frame the user ever reads.
FRENCH = {
    "global.quitConfirmation": "Voulez-vous vraiment fermer EasyGest ?",
    "global.ok": "OK",
    "global.quit": "Quitter",
    "global.cancel": "Annuler",
    "global.saveFile": "Enregistrer le fichier",
    "cocoa.menu.about": "À propos",
    "cocoa.menu.services": "Services",
    "cocoa.menu.view": "Affichage",
    "cocoa.menu.hide": "Masquer",
    "cocoa.menu.hideOthers": "Masquer les autres",
    "cocoa.menu.showAll": "Tout afficher",
    "cocoa.menu.quit": "Quitter",
    "cocoa.menu.fullscreen": "Plein écran",
    "windows.fileFilter.allFiles": "Tous les fichiers",
    "windows.fileFilter.otherFiles": "Autres types de fichiers",
    "linux.openFile": "Ouvrir un fichier",
    "linux.openFiles": "Ouvrir des fichiers",
    "linux.openFolder": "Ouvrir un dossier",
}


def _webview2_installed() -> bool:
    """True when the Edge WebView2 runtime is registered on this machine."""
    if sys.platform != "win32":
        return True
    import winreg

    key = r"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    for hive, path in (
        (winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\" + key),
        (winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\" + key),
        (winreg.HKEY_CURRENT_USER, "SOFTWARE\\" + key),
    ):
        try:
            with winreg.OpenKey(hive, path) as opened:
                if winreg.QueryValueEx(opened, "pv")[0]:
                    return True
        except OSError:
            continue
    return False


def _ensure_webview2() -> bool:
    """Repair a missing WebView2 runtime with the installer shipped next to
    the executable, so the window comes back without a manual download."""
    if _webview2_installed():
        return True
    _boot("webview2 absent")
    candidates = [
        Path(sys.executable).parent / "MicrosoftEdgeWebview2Setup.exe",
        Path(getattr(sys, "_MEIPASS", "")) / "MicrosoftEdgeWebview2Setup.exe",
    ]
    for setup in candidates:
        if not setup.is_file():
            continue
        try:
            import subprocess

            _boot(f"webview2 install via {setup}")
            subprocess.run(
                [str(setup), "/silent", "/install"],
                timeout=300,
                check=False,
            )
        except Exception:  # noqa: BLE001 - no right, offline, AV block
            traceback.print_exc()
        if _webview2_installed():
            _boot("webview2 installe")
            return True
    _boot("webview2 toujours absent")
    return False


# Shown inside the window when the interface never finishes loading, so a
# white page is replaced by an explanation and a retry instead of silence.
_LOAD_ERROR_HTML = (
    "<div style='font-family:Arial,sans-serif;min-height:100vh;display:flex;"
    "flex-direction:column;align-items:center;justify-content:center;"
    "background:#0f2a5c;color:#fff;text-align:center;padding:24px'>"
    "<h1 style='font-size:22px'>EasyGest</h1>"
    "<p style='max-width:460px'>L'interface n'a pas pu se charger. "
    "Le service interne est pourtant d&eacute;marr&eacute;.</p>"
    "<p style='font-size:13px;opacity:.8'>Fermez puis relancez EasyGest. "
    "Si le probl&egrave;me persiste, red&eacute;marrez l'ordinateur ou "
    "r&eacute;installez l'application.</p>"
    "<button onclick='location.reload()' style='margin-top:12px;padding:"
    "10px 26px;border:0;border-radius:8px;font-size:15px;cursor:pointer'>"
    "R&eacute;essayer</button></div>"
)


def _open_window(url: str) -> bool:
    """Show the application in a native window. False if unavailable."""
    if sys.platform == "win32":
        # A missing runtime used to end in a blank window plus a browser
        # opening on localhost: repair it first so the native window works.
        _ensure_webview2()
    try:
        import webview
    except Exception:  # noqa: BLE001 - missing runtime, broken install...
        traceback.print_exc()
        return False
    try:
        if sys.platform == "win32" and os.getenv("EASYGEST_GPU") != "1":
            # Old or weak GPUs leave the WebView2 window white; software
            # rasterisation always renders. The extra flags keep the memory
            # footprint low on 4 GB machines. EASYGEST_GPU=1 restores
            # hardware acceleration on machines where it works.
            os.environ.setdefault(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--disable-gpu --disable-gpu-compositing "
                "--disable-background-networking --disable-component-update "
                "--disable-sync --disable-extensions --no-first-run "
                "--mute-audio",
            )
        api = DesktopApi()
        window = webview.create_window(
            APP_NAME,
            url,
            width=1400,
            height=900,
            min_size=(1024, 700),
            confirm_close=True,
            localization=FRENCH,
            # Without this the native window refuses the mouse: no text can be
            # selected, so nothing can be copied out of a table or a receipt.
            text_select=True,
            js_api=api,
        )
        api._window = window
        window.events.closed += lambda: os._exit(0)

        # Anti-blank-page watchdog: if the interface has not mounted after
        # 30 s, replace the white page with an explanation and a retry.
        loaded = {"ok": False}
        window.events.loaded += lambda: loaded.__setitem__("ok", True)

        def _watchdog() -> None:
            time.sleep(30)
            if loaded["ok"]:
                return
            _boot("watchdog: interface non chargee apres 30 s")
            try:
                window.load_html(_LOAD_ERROR_HTML)
            except Exception:  # noqa: BLE001 - window already gone
                pass

        threading.Thread(target=_watchdog, daemon=True).start()

        # Without an explicit storage path the window runs in private mode and
        # forgets everything the page saved (session, last user name, screen
        # preferences) as soon as the computer is restarted.
        webview.start(
            private_mode=False,
            localization=FRENCH,
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
        # The 32-bit package is built without the native window (no pythonnet
        # wheel exists for x86): there the browser fallback is the expected
        # mode, so only a *bundled-but-broken* webview fails the selftest.
        import importlib.util

        if importlib.util.find_spec("webview") is not None:
            try:
                import clr  # noqa: F401
                import webview  # noqa: F401
                from webview.platforms import winforms  # noqa: F401
            except Exception as exc:  # noqa: BLE001
                problems.append(f"fenêtre native indisponible : {exc!r}")
    if problems:
        print("SELFTEST KO : " + " ; ".join(problems), flush=True)
        # Hard exit: a clean interpreter shutdown can hang in a frozen build
        # (non-daemon threads left by a dependency), which made the CI check
        # wait forever even though the verdict was already known.
        os._exit(1)
    print(f"SELFTEST OK — {APP_NAME} {APP_VERSION}", flush=True)
    os._exit(0)


def _auto_update() -> None:
    """Install a version downloaded earlier, then keep preparing the next one.

    Nothing is asked and nothing is shown: the workstation of a seller or of a
    stock manager updates itself at start like the administrator's one.
    """
    from app import updater

    try:
        if updater.apply_pending():
            raise SystemExit(0)
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 - an update must never block the start
        traceback.print_exc()
    updater.stage_in_background()


def main() -> None:
    _redirect_output()
    if not SELFTEST:
        _auto_update()
    port, started = _start_backend(DEFAULT_PORT, reuse=not SELFTEST)
    url = f"http://127.0.0.1:{port}"

    if SELFTEST:
        _selftest(url)
        return

    ready = _wait_until_ready(url)

    if HEADLESS:
        if not started:
            print(f"Serveur {APP_NAME} déjà actif : {url}")
            return
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
