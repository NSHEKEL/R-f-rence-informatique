"""Receipt and label printer settings.

Both printers are configured once and reused automatically afterwards. The
settings live in a single JSON column so adding a switch does not mean adding
a database column; unknown or missing keys simply fall back on the defaults,
which keeps bases written by older versions readable.
"""

from __future__ import annotations

import ctypes
import json
import logging
import shutil
import subprocess
import sys

from .models import CompanySettings
from .schemas import PrinterDevice, PrintingConfig, ReceiptPrinterConfig

log = logging.getLogger(__name__)


def _spooler():
    """Load the Windows spooler with pointer-safe Win32 signatures."""
    dll = ctypes.WinDLL("winspool.drv", use_last_error=True)
    ptr = ctypes.c_void_p
    dword = ctypes.c_uint32
    out_dword = ctypes.POINTER(dword)
    signatures = {
        "OpenPrinterW": ([ctypes.c_wchar_p, ctypes.POINTER(ptr), ptr], ctypes.c_int),
        "ClosePrinter": ([ptr], ctypes.c_int),
        "EnumPrintersW": ([dword, ctypes.c_wchar_p, dword, ptr, dword, out_dword, out_dword], ctypes.c_int),
        "GetPrinterW": ([ptr, dword, ptr, dword, out_dword], ctypes.c_int),
        "GetDefaultPrinterW": ([ctypes.c_wchar_p, out_dword], ctypes.c_int),
        "SetDefaultPrinterW": ([ctypes.c_wchar_p], ctypes.c_int),
        "StartDocPrinterW": ([ptr, dword, ptr], dword),
        "StartPagePrinter": ([ptr], ctypes.c_int),
        "WritePrinter": ([ptr, ptr, dword, out_dword], ctypes.c_int),
        "EndPagePrinter": ([ptr], ctypes.c_int),
        "EndDocPrinter": ([ptr], ctypes.c_int),
        "DeviceCapabilitiesW": ([ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint16, ptr, ptr], ctypes.c_int),
    }
    for name, (args, result) in signatures.items():
        function = getattr(dll, name)
        function.argtypes = args
        function.restype = result
    return dll

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


class _PrinterInfo1(ctypes.Structure):
    """PRINTER_INFO_1W: name-only listing that survives broken drivers."""

    _fields_ = [
        ("Flags", ctypes.c_uint32),
        ("pDescription", ctypes.c_wchar_p),
        ("pName", ctypes.c_wchar_p),
        ("pComment", ctypes.c_wchar_p),
    ]


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


def _connection_kind(port: str) -> str:
    """How the printer is attached, guessed from its port name."""
    value = (port or "").upper()
    if value.startswith(("USB", "DOT4")):
        return "USB"
    if value.startswith("\\\\") or "WSD" in value or value.startswith(("IP_", "TCP")):
        return "Réseau"
    if value.startswith("LPT"):
        return "Parallèle"
    if value.startswith("COM"):
        return "Série"
    if value.startswith(("PORTPROMPT", "NUL", "FILE", "/")) or (len(value) > 2 and value[1:3] == ":\\"):
        return "Virtuelle"
    return ""


def _enumerate_names(spooler, level: int) -> list[str]:
    """Raw EnumPrintersW call: queue names, or [] when the call fails."""
    flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS
    needed = ctypes.c_uint32(0)
    returned = ctypes.c_uint32(0)
    ok = spooler.EnumPrintersW(
        flags, None, level, None, 0, ctypes.byref(needed),
        ctypes.byref(returned),
    )
    if needed.value == 0:
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())
        return []
    buffer = ctypes.create_string_buffer(needed.value)
    if not spooler.EnumPrintersW(
        flags,
        None,
        level,
        buffer,
        needed.value,
        ctypes.byref(needed),
        ctypes.byref(returned),
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    names: list[str] = []
    if level == 1:
        entries = ctypes.cast(
            buffer, ctypes.POINTER(_PrinterInfo1 * returned.value)
        ).contents
        for entry in entries:
            name = entry.pName or ""
            if name:
                names.append(name)
    else:
        entries = ctypes.cast(
            buffer, ctypes.POINTER(_PrinterInfo2 * returned.value)
        ).contents
        for entry in entries:
            name = entry.pPrinterName or ""
            if name:
                names.append(name)
    return names


def _windows_devices() -> list[PrinterDevice]:
    """Queues declared in Windows, read straight from the print spooler.

    The spooler is asked through ctypes rather than through pywin32: the
    packaged executable does not ship that extension, so the selection list
    used to come back empty and the shop had to type the printer name.

    Level-2 enumeration returns full details in one call but fails
    ENTIRELY when a single installed queue has a broken driver (an old
    thermal printer does exactly this) — the list then looked empty while
    PowerShell and the print dialog still showed every printer. The names
    therefore come from the tolerant level-1 call, then each queue is
    enriched by its own GetPrinter: one sick queue only breaks its own
    line, which reads "Non détectable".
    """
    spooler = _spooler()
    names = _enumerate_names(spooler, 1)
    if not names:
        return []
    default = default_printer()
    devices: list[PrinterDevice] = []
    seen: set[str] = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        try:
            device = queue_status(name)
        except Exception as exc:
            # A queue that crashes the detail query stays listed, marked.
            log.warning(
                "Étape GetPrinter — file %r : %s: %s",
                name,
                type(exc).__name__,
                exc,
            )
            device = None
        if device is None:
            device = PrinterDevice(
                name=name,
                port="",
                driver="",
                kind="",
                jobs=0,
                is_default=False,
                available=True,
                status="Non détectable",
            )
        device.is_default = name == default
        devices.append(device)
    return devices


def queue_status(name: str) -> PrinterDevice | None:
    """Live status of one queue: jobs waiting and the current problem."""
    if sys.platform != "win32":
        return None
    # c_void_p, not ctypes.wintypes.HANDLE: wintypes is absent from some
    # frozen builds and its lazy import used to kill the whole listing.
    spooler = _spooler()
    handle = ctypes.c_void_p()
    if not spooler.OpenPrinterW(name, ctypes.byref(handle), None):
        return None
    try:
        needed = ctypes.c_uint32(0)
        spooler.GetPrinterW(handle, 2, None, 0, ctypes.byref(needed))
        if needed.value == 0:
            return None
        buffer = ctypes.create_string_buffer(needed.value)
        if not spooler.GetPrinterW(
            handle, 2, buffer, needed.value, ctypes.byref(needed)
        ):
            return None
        info = ctypes.cast(buffer, ctypes.POINTER(_PrinterInfo2)).contents
        try:
            color = spooler.DeviceCapabilitiesW(info.pPrinterName or name, info.pPortName, 32, None, info.pDevMode) == 1
        except OSError:
            color = False
        problem = _status_label(int(info.Status))
        if not problem and int(info.Status) & 0x00000008:
            problem = "En pause"
        return PrinterDevice(
            name=info.pPrinterName or name,
            port=info.pPortName or "",
            driver=info.pDriverName or "",
            kind=_connection_kind(info.pPortName or ""),
            jobs=int(info.cJobs),
            is_default=name == default_printer(),
            available=not problem,
            supports_color=color,
            status=problem or "Prête",
        )
    finally:
        spooler.ClosePrinter(handle)


def set_default_printer(name: str) -> bool:
    """Make a queue the Windows default printer."""
    if sys.platform != "win32" or not name:
        return False
    return bool(_spooler().SetDefaultPrinterW(name))


def open_preferences(name: str) -> str:
    """Open the driver's own preferences dialog for a queue."""
    if sys.platform != "win32":
        raise OSError("Disponible uniquement sous Windows.")
    subprocess.Popen(
        ["rundll32", "printui.dll,PrintUIEntry", "/e", "/n", name],
        shell=False,
    )
    return name


def default_printer() -> str:
    """Printer Windows prints on when none is chosen, empty elsewhere."""
    if sys.platform != "win32":
        return ""
    size = ctypes.c_uint32(0)
    _spooler().GetDefaultPrinterW(None, ctypes.byref(size))
    buffer = ctypes.create_unicode_buffer(size.value)
    if not _spooler().GetDefaultPrinterW(
        buffer, ctypes.byref(size)
    ):
        return ""
    return buffer.value


def printer_devices() -> list[PrinterDevice]:
    """Printers installed on this computer, with their availability.

    Raises OSError on Windows when the enumeration itself fails, so the
    API can report the technical reason instead of an empty list.
    """
    if sys.platform == "win32":
        return _windows_devices()
    return [
        PrinterDevice(name=name, port="", is_default=False, available=True,
                      status="Disponible")
        for name in _cups_printers()
    ]


def installed_printers() -> list[str]:
    """Printer names only; empty rather than raising on OS errors."""
    try:
        return [device.name for device in printer_devices()]
    except OSError:
        return []


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


def diagnose() -> dict:
    """Stage-by-stage detection report, for support: Windows call results
    (levels 1 and 2), the default queue, and each queue's detail query."""
    report: dict = {"platform": sys.platform, "steps": {}, "level1": {},
                    "level2": {}, "default": "", "queues": []}
    def stage(key: str, label: str, error: str = "") -> None:
        report["steps"][key] = {"name": label, "ok": not error}
        if error:
            report["steps"][key]["error"] = error
            log.warning("Étape %s — %s : %s", key, label, error)
    if sys.platform != "win32":
        try:
            report["devices"] = [d.name for d in printer_devices()]
        except Exception as exc:
            report["error"] = f"{type(exc).__name__}: {exc}"
        return report
    try:
        spooler = _spooler()
        # EnumPrinters also checks that the spooler service answers.
        _enumerate_names(spooler, 1)
        stage("A", "Chargement winspool.drv / service spouleur")
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        stage("A", "Chargement winspool.drv / service spouleur", report["error"])
        for key in ("B", "C", "D"):
            stage(key, "Non exécutée", "Spouleur indisponible")
        report["level1"] = {"error": report["error"]}
        report["level2"] = {"error": report["error"]}
        return report
    for level in (1, 2):
        try:
            names = _enumerate_names(spooler, level)
            report[f"level{level}"] = {"ok": True, "count": len(names), "names": names}
            stage("B" if level == 1 else "C", f"EnumPrinters niv. {level}")
        except Exception as exc:
            log.warning(
                "Étape EnumPrinters niv. %s : %s: %s",
                level,
                type(exc).__name__,
                exc,
            )
            report[f"level{level}"] = {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}"
            }
            stage("B" if level == 1 else "C", f"EnumPrinters niv. {level}", report[f"level{level}"]["error"])
    try:
        report["default"] = default_printer()
    except Exception as exc:
        report["default_error"] = f"{type(exc).__name__}: {exc}"
        stage("C", "EnumPrinters niv. 2 + imprimante par défaut", report["default_error"])
    queues = []
    for name in report.get("level1", {}).get("names", []):
        try:
            device = queue_status(name)
            queues.append(
                {
                    "name": name,
                    "ok": device is not None,
                    "status": device.status if device else None,
                    "port": device.port if device else "",
                    "driver": device.driver if device else "",
                }
            )
        except Exception as exc:
            log.warning(
                "Étape GetPrinter — file %r : %s: %s",
                name,
                type(exc).__name__,
                exc,
            )
            queues.append(
                {
                    "name": name,
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    report["queues"] = queues
    stage("D", "GetPrinter par file", "; ".join(
        q["name"] + ": " + q.get("error", "Non détectable")
        for q in queues if not q["ok"]
    ))
    return report
