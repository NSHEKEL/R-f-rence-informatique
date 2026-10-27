"""Standalone launcher for the Référence Informatique desktop package.

Starts the FastAPI server (which also serves the built frontend) and opens the
default web browser on the application. Used as the PyInstaller entry point so
the whole app runs from a single double-clickable executable.
"""

import threading
import time
import webbrowser

import uvicorn

from app.main import app

HOST = "127.0.0.1"
PORT = 8000
URL = f"http://{HOST}:{PORT}"


def _open_browser() -> None:
    time.sleep(2)
    try:
        webbrowser.open(URL)
    except Exception:
        pass


def main() -> None:
    print("Référence Informatique — démarrage...")
    print(f"Ouvrez votre navigateur sur {URL} si la page ne s'ouvre pas.")
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
