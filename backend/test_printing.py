import ctypes
import unittest
from unittest.mock import MagicMock, patch

from app import escpos, printing


class PrintingTests(unittest.TestCase):
    def test_win32_layouts(self):
        self.assertEqual(ctypes.sizeof(printing._PrinterInfo1), 32)
        self.assertEqual(printing._PrinterInfo1.pDescription.offset, 8)
        self.assertEqual(ctypes.sizeof(printing._PrinterInfo2), 136)
        self.assertEqual(printing._PrinterInfo2.Attributes.offset, 104)
        self.assertEqual(printing._PrinterInfo2.AveragePPM.offset, 132)
        self.assertEqual(ctypes.sizeof(escpos._DocInfo), 24)
        self.assertEqual(escpos._DocInfo.pDatatype.offset, 16)

    def test_queue_status_windows_flags(self):
        for flags, problem in [(0, "Prête"), (1, "En pause"), (2, "En erreur"), (8, "Bourrage papier"), (128, "Hors ligne")]:
            with self.subTest(flags=flags):
                dll = MagicMock()
                info = printing._PrinterInfo2()
                info.pPrinterName = "Test queue"
                info.Status = flags
                def get_printer(handle, level, buffer, size, needed):
                    needed._obj.value = ctypes.sizeof(info)
                    if buffer is None:
                        return False
                    ctypes.memmove(buffer, ctypes.byref(info), ctypes.sizeof(info))
                    return True
                dll.GetPrinterW.side_effect = get_printer
                with patch.object(printing, "_spooler", return_value=dll), patch.object(printing, "default_printer", return_value="Test queue"):
                    device = printing.queue_status("Test queue")
                self.assertEqual(device.status, problem)
                self.assertEqual(device.available, flags == 0)
                dll.ClosePrinter.assert_called_once()

    def test_kinds(self):
        for port, expected in {
            "USB001": "USB", "LPT1:": "Parallèle", "COM2:": "Série",
            "IP_192.168.1.50": "Réseau", "WSD-1": "Réseau", "TCP1": "Réseau",
            "PORTPROMPT:": "Virtuelle", "nul": "Virtuelle", "FILE:": "Virtuelle",
            "C:\\spool_out\\ticket.prn": "Virtuelle", "": "",
        }.items():
            self.assertEqual(printing._connection_kind(port), expected)

    def test_diagnose_load_error(self):
        with patch.object(printing, "_spooler", side_effect=OSError("DLL simulée absente")):
            result = printing.diagnose()
        self.assertFalse(result["steps"]["A"]["ok"])
        self.assertEqual(result["queues"], [])
        self.assertIn("DLL simulée absente", result["level1"]["error"])

    def test_diagnose_empty(self):
        with patch.object(printing, "_spooler"), patch.object(printing, "_enumerate_names", return_value=[]), patch.object(printing, "default_printer", return_value=""):
            result = printing.diagnose()
        self.assertEqual(result["level1"]["count"], 0)
        self.assertTrue(result["steps"]["D"]["ok"])

    def test_diagnose_queue_error(self):
        with patch.object(printing, "_spooler"), patch.object(printing, "_enumerate_names", return_value=["Broken"]), patch.object(printing, "default_printer", return_value=""), patch.object(printing, "queue_status", side_effect=OSError("driver")):
            result = printing.diagnose()
        self.assertFalse(result["steps"]["D"]["ok"])
        self.assertIn("driver", result["queues"][0]["error"])

    def test_enumeration_empty_and_error(self):
        dll = MagicMock()
        dll.EnumPrintersW.return_value = True
        self.assertEqual(printing._enumerate_names(dll, 1), [])
        dll.EnumPrintersW.return_value = False
        with self.assertRaises(OSError):
            printing._enumerate_names(dll, 1)

    def test_signatures(self):
        dll = printing._spooler()
        for name in ("OpenPrinterW", "ClosePrinter", "GetPrinterW", "StartDocPrinterW", "StartPagePrinter", "WritePrinter", "EndPagePrinter", "EndDocPrinter"):
            self.assertIs(getattr(dll, name).argtypes[0], ctypes.c_void_p if name != "OpenPrinterW" else ctypes.c_wchar_p)
        self.assertEqual(dll.EnumPrintersW.restype, ctypes.c_int)

    def test_raw_results(self):
        for mode in ("ok", "page", "write", "short", "end"):
            with self.subTest(mode=mode):
                dll = MagicMock()
                dll.StartPagePrinter.return_value = mode != "page"
                dll.EndPagePrinter.return_value = mode != "end"
                def write(handle, data, size, written):
                    ctypes.cast(written, ctypes.POINTER(ctypes.c_uint32))[0] = size - (mode == "short")
                    return mode != "write"
                dll.WritePrinter.side_effect = write
                with patch.object(escpos, "_spooler", return_value=dll):
                    if mode == "ok":
                        self.assertEqual(escpos.send(b"TEST\r\n", "Chosen"), "Chosen")
                    else:
                        with self.assertRaises(escpos.PrintError):
                            escpos.send(b"TEST\r\n", "Chosen")
                dll.ClosePrinter.assert_called_once()


if __name__ == "__main__":
    unittest.main()
