"""Electronic cash drawer.

The drawer has no computer of its own: it is plugged into the receipt printer
(or into a serial port) and opens when it receives its kick code, a handful of
bytes. Sending them means writing to the printer share or to the port, which
only makes sense on the machine the drawer is attached to — the counter.
"""

from __future__ import annotations

from .models import CompanySettings

DEFAULT_CODE = "27,112,0,25,250"  # ESC p 0 25 250, the usual ESC/POS kick


class DrawerError(RuntimeError):
    pass


def kick_bytes(code: str) -> bytes:
    """Decimal byte list from the settings, e.g. "27,112,0,25,250"."""
    parts = [p.strip() for p in (code or DEFAULT_CODE).split(",") if p.strip()]
    try:
        values = [int(p, 0) for p in parts]
    except ValueError as exc:
        raise DrawerError(
            "Code d'ouverture invalide : indiquez des nombres séparés par des "
            "virgules, par exemple 27,112,0,25,250."
        ) from exc
    if not values or any(v < 0 or v > 255 for v in values):
        raise DrawerError("Code d'ouverture invalide (valeurs de 0 à 255).")
    return bytes(values)


def open_drawer(settings: CompanySettings) -> str:
    """Open the drawer; returns the target it was sent to."""
    if not settings.drawer_enabled:
        raise DrawerError("La caisse électronique n'est pas activée.")
    target = (settings.drawer_port or "").strip()
    if not target:
        raise DrawerError(
            "Indiquez le port de la caisse électronique (COM1, LPT1 ou le "
            "partage de l'imprimante, par exemple \\\\CAISSE\\TICKET)."
        )
    payload = kick_bytes(settings.drawer_code)
    try:
        with open(target, "wb") as port:
            port.write(payload)
    except OSError as exc:
        raise DrawerError(
            f"Impossible d'ouvrir la caisse sur « {target} » : {exc}"
        ) from exc
    return target
