"""Electronic cash drawer.

The drawer has no computer of its own: it is plugged into the receipt printer
(or into a serial port) and opens when it receives its kick code, a handful of
bytes. Sending them means writing to the printer share or to the port, which
only makes sense on the machine the drawer is attached to — the counter.
"""

from __future__ import annotations

from . import escpos
from .models import CompanySettings
from .schemas import PrintingConfig

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


def is_port(target: str) -> bool:
    """True for a serial, parallel or shared path, false for a printer name."""
    value = target.strip().upper()
    return value.startswith(("COM", "LPT", "\\\\", "/DEV/")) or value.endswith(":")


def open_drawer(
    settings: CompanySettings, config: PrintingConfig | None = None
) -> str:
    """Open the drawer; returns the target it was sent to.

    The drawer is nearly always wired to the receipt printer, so the kick code
    goes through the spooler to that printer when no port is given: the shop
    has one setting less to fill in. Drawers plugged straight into a serial or
    parallel port are still written to directly.
    """
    if not settings.drawer_enabled:
        raise DrawerError("La caisse électronique n'est pas activée.")
    target = (settings.drawer_port or "").strip()
    if not target and config is not None:
        target = config.receipt.printer_name.strip()
    payload = kick_bytes(settings.drawer_code)
    if target and is_port(target):
        try:
            with open(target, "wb") as port:
                port.write(payload)
        except OSError as exc:
            raise DrawerError(
                f"Impossible d'ouvrir la caisse sur « {target} » : {exc}"
            ) from exc
        return target
    # A printer name, or nothing at all: the default printer then takes it.
    try:
        return escpos.send(payload, target)
    except escpos.PrintError as exc:
        raise DrawerError(str(exc)) from exc
