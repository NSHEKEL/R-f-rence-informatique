import json
import sys
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from webview import util

from run import DesktopApi


class OpaqueWindow:
    def __dir__(self):
        raise AssertionError("The native window must not be explored")


class DesktopApiTests(unittest.TestCase):
    def test_only_methods_are_public(self):
        api = DesktopApi()
        api._window = OpaqueWindow()
        public = {name: getattr(api, name) for name in dir(api) if not name.startswith("_")}
        self.assertTrue(public)
        self.assertTrue(all(callable(value) for value in public.values()))

    def test_pywebview_exposes_methods_without_exploring_window(self):
        api = DesktopApi()
        api._window = OpaqueWindow()
        window = SimpleNamespace(
            _js_api=api, _functions={}, _expose_lock=threading.Lock(),
            run_js=MagicMock(), events=MagicMock(),
        )
        with patch.object(util, "load_js_files", return_value=("BOOT", "%(functions)s")), patch.object(util, "Thread", side_effect=lambda target: SimpleNamespace(start=target)):
            util.inject_pywebview("winforms", window)
        functions = json.loads(window.run_js.call_args_list[-1].args[0])
        names = {entry["func"] for entry in functions}
        self.assertIn("print_ticket", names)
        self.assertIn("print_to", names)
        self.assertFalse(any("window" in name for name in names))
        window.events._pywebviewready.set.assert_called_once()

    def test_no_window(self):
        api = DesktopApi()
        self.assertEqual(api.choose_folder(), "")
        self.assertEqual(api.save_file("test.txt", "test"), "")
        self.assertFalse(api.print_page(80, 120, 0))
        self.assertFalse(api.toggle_fullscreen())

    def test_print_to_selected_queue_and_result(self):
        for completed, result, expected in (
            (True, "Succeeded", True),
            (True, "PrinterUnavailable", False),
            (False, "Succeeded", False),
        ):
            with self.subTest(completed=completed, result=result):
                api = DesktopApi()
                api._window = SimpleNamespace(uid="test")
                settings = SimpleNamespace()
                task = SimpleNamespace(Wait=lambda timeout: completed, Result=result)
                core = MagicMock()
                core.Environment.CreatePrintSettings.return_value = settings
                core.PrintAsync.return_value = task
                form = SimpleNamespace(
                    browser=SimpleNamespace(webview=SimpleNamespace(CoreWebView2=core)),
                    Invoke=lambda action: action(),
                )
                modules = {
                    "System": SimpleNamespace(Action=lambda action: action),
                    "webview.platforms.winforms": SimpleNamespace(
                        BrowserView=SimpleNamespace(instances={"test": form})
                    ),
                }
                with patch.dict(sys.modules, modules):
                    self.assertEqual(api.print_to(210, 297, 0, "Selected queue"), expected)
                self.assertEqual(settings.PrinterName, "Selected queue")
                core.PrintAsync.assert_called_once_with(settings)


if __name__ == "__main__":
    unittest.main()
