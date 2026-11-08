import ctypes
import json
import unittest
from unittest.mock import MagicMock, patch

from app import escpos, printing
from app.models import CompanySettings
from app.schemas import PrintingConfig


class PrintCustomizationTests(unittest.TestCase):
    def test_defaults_merge_and_round_trip_preserve_saved_fields(self):
        settings = CompanySettings(printer_name='Legacy', receipt_format='58mm')
        config = printing.read_config(settings)
        self.assertEqual(config.receipt.width, '58mm')
        self.assertEqual(config.receipt.printer_name, 'Legacy')
        settings.printing_config = json.dumps({'receipt': {'width': '58mm', 'font_size': 9, 'show_customer': False}, 'documents': {'show_address': False, 'order_prefix': 'CM'}, 'label': {'columns': 2}})
        config = printing.read_config(settings)
        self.assertEqual(config.receipt.font_size, 9)
        self.assertFalse(config.receipt.show_customer)
        self.assertFalse(config.documents.show_address)
        self.assertEqual(config.documents.order_prefix, 'CM')
        self.assertEqual(config.documents.font_family, 'Arial')
        self.assertEqual(config.label.columns, 2)
        config.label.code_type = 'qr'
        config.documents.footer_text = 'Merci à bientôt'
        printing.write_config(settings, config)
        self.assertEqual(printing.read_config(settings), config)
        self.assertEqual(PrintingConfig().receipt.text_color, '#000000')

    def test_capability_color_mono_unknown_and_error(self):
        for reported, expected in [(1, True), (0, False), (-1, False), (OSError('driver'), False)]:
            with self.subTest(reported=reported):
                dll = MagicMock()
                dll.OpenPrinterW.return_value = True
                info = printing._PrinterInfo2()
                info.pPrinterName, info.pPortName = 'Test', 'USB001'
                def get_printer(handle, level, buffer, size, needed):
                    needed._obj.value = ctypes.sizeof(info)
                    if buffer is None:
                        return False
                    ctypes.memmove(buffer, ctypes.byref(info), ctypes.sizeof(info))
                    return True
                dll.GetPrinterW.side_effect = get_printer
                if isinstance(reported, Exception):
                    dll.DeviceCapabilitiesW.side_effect = reported
                else:
                    dll.DeviceCapabilitiesW.return_value = reported
                with patch.object(printing, '_spooler', return_value=dll):
                    device = printing.queue_status('Test')
                self.assertIs(device.supports_color, expected)
                self.assertEqual(dll.DeviceCapabilitiesW.call_args.args[2], 32)
                dll.ClosePrinter.assert_called_once()

    def test_raw_spacing_and_qr(self):
        stream = escpos.build([escpos.Line(text='Merci', bold=True), escpos.Line(qr='TEST-0001')], False, line_spacing=36)
        self.assertIn(b'\x1b3\x24', stream)
        self.assertIn(b'TEST-0001', stream)
        self.assertIn(b'\x1bE\x01', stream)
