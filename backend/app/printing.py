"""Receipt and label printer settings.

Both printers are configured once and reused automatically afterwards. The
settings live in a single JSON column so adding a switch does not mean adding
a database column; unknown or missing keys simply fall back on the defaults,
which keeps bases written by older versions readable.
"""

from __future__ import annotations

import json
import shutil
import subprocess

from .models import CompanySettings
from .schemas import PrintingConfig, ReceiptPrinterConfig


def read_config(settings: CompanySettings) -> PrintingConfig:
    """Stored configuration, completed with the defaults."""
    raw = settings.printing_config or ""
    data: object = None
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = None
    config = (
        PrintingConfig.model_validate(data)
        if isinstance(data, dict)
        else PrintingConfig()
    )
    if not isinstance(data, dict):
        # First run: keep the printer and the format already chosen in the
        # company settings so nothing changes for existing shops.
        config.receipt = _from_company(settings)
    return config


def _from_company(settings: CompanySettings) -> ReceiptPrinterConfig:
    receipt = ReceiptPrinterConfig()
    receipt.printer_name = settings.printer_name or ""
    receipt.width = settings.receipt_format or "80mm"
    receipt.auto_print = bool(settings.auto_print_cash)
    receipt.open_drawer = bool(settings.drawer_open_after_sale)
    return receipt


def write_config(settings: CompanySettings, config: PrintingConfig) -> None:
    """Save the configuration and mirror the shared fields on the company."""
    settings.printing_config = json.dumps(config.model_dump())
    # These four are also read by the older printing paths and by the drawer.
    settings.printer_name = config.receipt.printer_name
    settings.receipt_format = config.receipt.width
    settings.auto_print_cash = config.receipt.auto_print
    settings.drawer_open_after_sale = config.receipt.open_drawer


def installed_printers() -> list[str]:
    """Printers known to the operating system, empty list when unavailable."""
    try:
        import win32print  # type: ignore[import-not-found]
    except ImportError:
        return _cups_printers()
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    return [p[2] for p in win32print.EnumPrinters(flags)]


def _cups_printers() -> list[str]:
    """Development fallback (Linux/macOS): ask CUPS for its queues."""
    lpstat = shutil.which("lpstat")
    if not lpstat:
        return []
    try:
        out = subprocess.run(
            [lpstat, "-a"], capture_output=True, text=True, timeout=5
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line.split(" ", 1)[0] for line in out.splitlines() if line.strip()]
