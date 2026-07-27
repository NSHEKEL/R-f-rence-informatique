"""Standalone launcher for the Référence Informatique desktop package.

Starts the FastAPI server (which also serves the built frontend) and opens the
default web browser on the application. Used as the PyInstaller entry point so
the whole app runs from a single double-clickable executable.

The server listens on every network interface so other workstations on the same
local network can use the same database by opening the displayed LAN address.
"""

import socket
import threading
import time
import webbrowser

import uvicorn

from app.main import app

HOST = "0.0.0.0"
PORT = 8000
LOCAL_URL = f"http://127.0.0.1:{PORT}"


def _lan_ip() -> str:
    """Best-effort local network address of this machine."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def _open_browser() -> None:
    time.sleep(2)
    try:
        webbrowser.open(LOCAL_URL)
    except Exception:
        pass


def main() -> None:
    ip = _lan_ip()
    print("=" * 60)
    print(" RÉFÉRENCE INFORMATIQUE — Vente & Stock")
    print("=" * 60)
    print(f" Ce poste (serveur)   : {LOCAL_URL}")
    print(f" Autres postes (réseau) : http://{ip}:{PORT}")
    print("")
    print(" Gardez cette fenêtre ouverte : elle héberge la base de données.")
    print(" Fermez-la pour arrêter l'application.")
    print("=" * 60)
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
