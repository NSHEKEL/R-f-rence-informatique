"""Direct ticket printing on the receipt printer (ESC/POS).

Printing through the embedded browser always stamps the date, the window
title, the local address and a page number around the ticket, and pads the
roll to a full page. The counter printer understands ESC/POS, so the ticket is
sent to it as raw bytes instead: what comes out is the receipt alone.
"""

from __future__ import annotations

import ctypes
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


def _text(value: str) -> bytes:
    return value.encode(CODEPAGE, errors="replace")


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


def build(lines: list[Line], cut: bool, kick: bytes = b"") -> bytes:
    """Turn the ticket into the byte stream the printer expects."""
    out = bytearray(ESC + b"@")  # reset: the previous ticket may have left
    out += ESC + b"t\x13"  # select cp858
    for line in lines:
        if line.barcode:
            out += ESC + b"a\x01" + _barcode(line.barcode) + ESC + b"a\x00"
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
    # ctypes.wintypes only exists on Windows, where printing happens.
    from ctypes import wintypes

    size = wintypes.DWORD(0)
    ctypes.windll.winspool.GetDefaultPrinterW(None, ctypes.byref(size))
    buffer = ctypes.create_unicode_buffer(size.value)
    if not ctypes.windll.winspool.GetDefaultPrinterW(buffer, ctypes.byref(size)):
        raise PrintError("Aucune imprimante par défaut n'est configurée.")
    return buffer.value


def send(data: bytes, printer_name: str = "") -> str:
    """Write raw bytes to a Windows printer; returns the printer used."""
    from ctypes import wintypes

    class _DocInfo(ctypes.Structure):
        _fields_ = [
            ("pDocName", wintypes.LPWSTR),
            ("pOutputFile", wintypes.LPWSTR),
            ("pDatatype", wintypes.LPWSTR),
        ]

    target = printer_name.strip() or _default_printer()
    spooler = ctypes.windll.winspool
    handle = wintypes.HANDLE()
    if not spooler.OpenPrinterW(target, ctypes.byref(handle), None):
        raise PrintError(f"Imprimante « {target} » introuvable.")
    try:
        info = _DocInfo("Reçu EasyGest", None, "RAW")
        if not spooler.StartDocPrinterW(handle, 1, ctypes.byref(info)):
            raise PrintError(f"Impression refusée par « {target} ».")
        try:
            spooler.StartPagePrinter(handle)
            written = wintypes.DWORD(0)
            spooler.WritePrinter(
                handle, data, len(data), ctypes.byref(written)
            )
            spooler.EndPagePrinter(handle)
        finally:
            spooler.EndDocPrinter(handle)
    finally:
        spooler.ClosePrinter(handle)
    return target
