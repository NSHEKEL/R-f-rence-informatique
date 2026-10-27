"""Receipt and label printer settings.

Both printers are configured once and reused automatically afterwards. The
settings live in a single JSON column so adding a switch does not mean adding
a database column; unknown or missing keys simply fall back on the defaults,
which keeps bases written by older versions readable.
"""

from __future__ import annotations

import ctypes
import json
import shutil
import subprocess
import sys

from .models import CompanySettings
from .schemas import PrinterDevice, PrintingConfig, ReceiptPrinterConfig

# Windows printer status bits that mean the queue cannot print right now.
PRINTER_STATUS_ERROR = 0x00000002
PRINTER_STATUS_OFFLINE = 0x00000080
PRINTER_STATUS_PAPER_OUT = 0x00000010
PRINTER_STATUS_NOT_AVAILABLE = 0x00001000
PRINTER_ENUM_LOCAL = 0x00000002
PRINTER_ENUM_CONNECTIONS = 0x00000004


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


class _PrinterInfo2(ctypes.Structure):
    """PRINTER_INFO_2W: the name, the port and the live status of a queue."""

    _fields_ = [
        ("pServerName", ctypes.c_wchar_p),
        ("pPrinterName", ctypes.c_wchar_p),
        ("pShareName", ctypes.c_wchar_p),
        ("pPortName", ctypes.c_wchar_p),
        ("pDriverName", ctypes.c_wchar_p),
        ("pComment", ctypes.c_wchar_p),
        ("pLocation", ctypes.c_wchar_p),
        ("pDevMode", ctypes.c_void_p),
        ("pSepFile", ctypes.c_wchar_p),
        ("pPrintProcessor", ctypes.c_wchar_p),
        ("pDatatype", ctypes.c_wchar_p),
        ("pParameters", ctypes.c_wchar_p),
        ("pSecurityDescriptor", ctypes.c_void_p),
        ("Attributes", ctypes.c_uint32),
        ("Priority", ctypes.c_uint32),
        ("DefaultPriority", ctypes.c_uint32),
        ("StartTime", ctypes.c_uint32),
        ("UntilTime", ctypes.c_uint32),
        ("Status", ctypes.c_uint32),
        ("cJobs", ctypes.c_uint32),
        ("AveragePPM", ctypes.c_uint32),
    ]


def _status_label(status: int) -> str:
    """Plain French reason why a queue is not ready, empty when it is."""
    if status & PRINTER_STATUS_OFFLINE:
        return "Hors ligne"
    if status & PRINTER_STATUS_PAPER_OUT:
        return "Plus de papier"
    if status & PRINTER_STATUS_NOT_AVAILABLE:
        return "Indisponible"
    if status & PRINTER_STATUS_ERROR:
        return "En erreur"
    return ""


def _windows_devices() -> list[PrinterDevice]:
    """Queues declared in Windows, read straight from the print spooler.

    The spooler is asked through ctypes rather than through pywin32: the
    packaged executable does not ship that extension, so the selection list
    used to come back empty and the shop had to type the printer name.
    """
    spooler = ctypes.windll.winspool
    flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS
    needed = ctypes.c_uint32(0)
    returned = ctypes.c_uint32(0)
    spooler.EnumPrintersW(
        flags, None, 2, None, 0, ctypes.byref(needed), ctypes.byref(returned)
    )
    if needed.value == 0:
        return []
    buffer = ctypes.create_string_buffer(needed.value)
    if not spooler.EnumPrintersW(
        flags,
        None,
        2,
        buffer,
        needed.value,
        ctypes.byref(needed),
        ctypes.byref(returned),
    ):
        return []
    entries = ctypes.cast(
        buffer, ctypes.POINTER(_PrinterInfo2 * returned.value)
    ).contents
    default = default_printer()
    devices: list[PrinterDevice] = []
    for entry in entries:
        name = entry.pPrinterName or ""
        if not name:
            continue
        problem = _status_label(int(entry.Status))
        devices.append(
            PrinterDevice(
                name=name,
                port=entry.pPortName or "",
                is_default=name == default,
                available=not problem,
                status=problem or "Disponible",
            )
        )
    return devices


def default_printer() -> str:
    """Printer Windows prints on when none is chosen, empty elsewhere."""
    if sys.platform != "win32":
        return ""
    size = ctypes.c_uint32(0)
    ctypes.windll.winspool.GetDefaultPrinterW(None, ctypes.byref(size))
    buffer = ctypes.create_unicode_buffer(size.value)
    if not ctypes.windll.winspool.GetDefaultPrinterW(
        buffer, ctypes.byref(size)
    ):
        return ""
    return buffer.value


def printer_devices() -> list[PrinterDevice]:
    """Printers installed on this computer, with their availability."""
    if sys.platform == "win32":
        try:
            return _windows_devices()
        except OSError:
            return []
    return [
        PrinterDevice(name=name, port="", is_default=False, available=True,
                      status="Disponible")
        for name in _cups_printers()
    ]


def installed_printers() -> list[str]:
    """Printer names only, kept for the callers that just need the list."""
    return [device.name for device in printer_devices()]


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
