"""Direct ticket printing on the receipt printer (ESC/POS).

Printing through the embedded browser always stamps the date, the window
title, the local address and a page number around the ticket, and pads the
roll to a full page. The counter printer understands ESC/POS, so the ticket is
sent to it as raw bytes instead: what comes out is the receipt alone.
"""

from __future__ import annotations

import base64
import ctypes
import sys
from dataclasses import dataclass

ESC = b"\x1b"
GS = b"\x1d"
CODEPAGE = "cp858"  # Western European with the euro sign, the printer default


class PrintError(RuntimeError):
    pass


@dataclass
class Line:
    """One printed line of the ticket."""

    text: str = ""
    align: str = "left"
    bold: bool = False
    big: bool = False
    barcode: str = ""
    # QR code payload; qr_size is the module width in dots (58mm: 4, 80mm: 6).
    qr: str = ""
    qr_size: int = 6
    # Monochrome bitmap of the logo: base64 rows of packed pixels.
    image: str = ""
    image_width: int = 0
    image_height: int = 0


def _text(value: str) -> bytes:
    return value.encode(CODEPAGE, errors="replace")


def _qr(data: str, size: int = 6) -> bytes:
    """Native ESC/POS QR code (GS ( k): model 2, error correction M."""
    payload = data.encode("utf-8")
    n = len(payload) + 3
    return (
        GS + b"(k" + bytes([4, 0, 49, 65, 50, 0])
        + GS + b"(k" + bytes([3, 0, 49, 67, max(1, min(size, 16))])
        + GS + b"(k" + bytes([3, 0, 49, 69, 49])
        + GS + b"(k" + bytes([n & 0xFF, (n >> 8) & 0xFF, 49, 80, 48]) + payload
        + GS + b"(k" + bytes([3, 0, 49, 81, 48])
    )


def _barcode(value: str) -> bytes:
    """CODE128 barcode with its number printed underneath."""
    data = b"{B" + value.encode("ascii", errors="ignore")
    return (
        GS + b"h\x50"  # height, 80 dots
        + GS + b"w\x02"  # narrow module
        + GS + b"H\x02"  # number printed below the bars
        + GS + b"k\x49" + bytes([len(data)]) + data
        + b"\n"
    )


def _raster(line: Line) -> bytes:
    """Logo printed as a bitmap (GS v 0), centred on the paper."""
    try:
        pixels = base64.b64decode(line.image)
    except (ValueError, TypeError):
        return b""
    bytes_per_row = (line.image_width + 7) // 8
    rows = line.image_height
    if bytes_per_row <= 0 or rows <= 0:
        return b""
    if len(pixels) < bytes_per_row * rows:
        return b""
    header = (
        GS + b"v0\x00"
        + bytes([bytes_per_row & 0xFF, bytes_per_row >> 8])
        + bytes([rows & 0xFF, rows >> 8])
    )
    return (
        ESC + b"a\x01"
        + header + pixels[: bytes_per_row * rows]
        + ESC + b"a\x00"
    )


def build(lines: list[Line], cut: bool, kick: bytes = b"") -> bytes:
    """Turn the ticket into the byte stream the printer expects."""
    out = bytearray(ESC + b"@")  # reset: the previous ticket may have left
    out += ESC + b"t\x13"  # select cp858
    for line in lines:
        if line.image:
            out += _raster(line)
            continue
        if line.barcode:
            out += ESC + b"a\x01" + _barcode(line.barcode) + ESC + b"a\x00"
            continue
        if line.qr:
            out += (
                ESC + b"a\x01" + _qr(line.qr, line.qr_size)
                + ESC + b"a\x00"
            )
            continue
        out += ESC + b"a" + bytes([1 if line.align == "center" else 0])
        out += ESC + b"E" + bytes([1 if line.bold else 0])
        out += GS + b"!" + bytes([0x11 if line.big else 0x00])
        out += _text(line.text) + b"\n"
        out += GS + b"!\x00" + ESC + b"E\x00"
    out += ESC + b"a\x00" + b"\n\n\n"
    if kick:
        out += kick
    if cut:
        out += GS + b"V\x42\x00"  # partial cut after feeding
    return bytes(out)


def _default_printer() -> str:
    if sys.platform != "win32":
        raise PrintError("L'impression directe n'est disponible que sous Windows.")
    # c_uint32, not wintypes.DWORD: wintypes is absent from some frozen
    # builds and its lazy import used to kill direct printing there.
    size = ctypes.c_uint32(0)
    ctypes.windll.winspool.GetDefaultPrinterW(None, ctypes.byref(size))
    buffer = ctypes.create_unicode_buffer(size.value)
    if not ctypes.windll.winspool.GetDefaultPrinterW(buffer, ctypes.byref(size)):
        raise PrintError("Aucune imprimante par défaut n'est configurée.")
    return buffer.value


def send(data: bytes, printer_name: str = "") -> str:
    """Write raw bytes to a Windows printer; returns the printer used."""
    if sys.platform != "win32":
        raise PrintError("L'impression directe n'est disponible que sous Windows.")
    class _DocInfo(ctypes.Structure):
        _fields_ = [
            ("pDocName", ctypes.c_wchar_p),
            ("pOutputFile", ctypes.c_wchar_p),
            ("pDatatype", ctypes.c_wchar_p),
        ]

    target = printer_name.strip() or _default_printer()
    spooler = ctypes.windll.winspool
    handle = ctypes.c_void_p()
    if not spooler.OpenPrinterW(target, ctypes.byref(handle), None):
        raise PrintError(f"Imprimante « {target} » introuvable.")
    try:
        info = _DocInfo("Reçu EasyGest", None, "RAW")
        if not spooler.StartDocPrinterW(handle, 1, ctypes.byref(info)):
            raise PrintError(f"Impression refusée par « {target} ».")
        try:
            spooler.StartPagePrinter(handle)
            written = ctypes.c_uint32(0)
            spooler.WritePrinter(
                handle, data, len(data), ctypes.byref(written)
            )
            spooler.EndPagePrinter(handle)
        finally:
            spooler.EndDocPrinter(handle)
    finally:
        spooler.ClosePrinter(handle)
    return target
