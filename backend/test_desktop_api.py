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
            (True, "LaunchError", False),
        ):
            with self.subTest(completed=completed, result=result):
                api = DesktopApi()
                api._window = SimpleNamespace(uid="test")
                settings = SimpleNamespace()
                task = SimpleNamespace(IsCompleted=completed, Result=result)
                core = MagicMock()
                core.Environment.CreatePrintSettings.return_value = settings
                core.PrintAsync.return_value = task
                if result == "LaunchError":
                    core.PrintAsync.side_effect = OSError("PrintAsync failure")
                form = SimpleNamespace(
                    browser=SimpleNamespace(webview=SimpleNamespace(CoreWebView2=core)),
                    InvokeRequired=True,
                    BeginInvoke=lambda action: action(),
                )
                modules = {
                    "System": SimpleNamespace(Action=lambda action: action),
                    "webview.platforms.winforms": SimpleNamespace(
                        BrowserView=SimpleNamespace(instances={"test": form})
                    ),
                }
                with patch.dict(sys.modules, modules), patch("run.time.monotonic", side_effect=[0, 0, 31]):
                    self.assertEqual(api.print_to(210, 297, 0, "Selected queue"), expected)
                self.assertEqual(settings.PrinterName, "Selected queue")
                core.PrintAsync.assert_called_once_with(settings)

    def test_print_page_uses_same_safe_path(self):
        api = DesktopApi()
        with patch.object(api, "print_to", return_value=False) as print_to:
            self.assertFalse(api.print_page(80, 120, 0))
        print_to.assert_called_once_with(80, 120, 0, "")

    def test_print_dispatch_and_completion_are_asynchronous(self):
        api = DesktopApi()
        api._window = SimpleNamespace(uid="async")
        completed = threading.Event()

        class Task:
            @property
            def IsCompleted(self):
                return completed.is_set()

            @property
            def Result(self):
                if not completed.is_set():
                    raise AssertionError("Result read before completion")
                return "Succeeded"

        core = MagicMock()
        core.Environment.CreatePrintSettings.return_value = SimpleNamespace()

        def print_async(settings):
            threading.Timer(0.1, completed.set).start()
            return Task()

        core.PrintAsync.side_effect = print_async
        pending = []
        form = SimpleNamespace(
            InvokeRequired=True,
            browser=SimpleNamespace(webview=SimpleNamespace(CoreWebView2=core)),
        )

        def begin(action):
            timer = threading.Timer(0.05, action)
            pending.append(timer)
            timer.start()

        form.BeginInvoke = begin
        modules = {
            "System": SimpleNamespace(Action=lambda action: action),
            "webview.platforms.winforms": SimpleNamespace(
                BrowserView=SimpleNamespace(instances={"async": form})
            ),
        }
        with patch.dict(sys.modules, modules):
            self.assertTrue(api.print_to(210, 297, 0, "Chosen"))
        for timer in pending:
            timer.join()
        core.PrintAsync.assert_called_once()

    def test_ui_thread_is_not_blocked_or_dispatched(self):
        api = DesktopApi()
        api._window = SimpleNamespace(uid="ui")
        form = SimpleNamespace(InvokeRequired=False, BeginInvoke=MagicMock())
        modules = {
            "System": SimpleNamespace(Action=lambda action: action),
            "webview.platforms.winforms": SimpleNamespace(
                BrowserView=SimpleNamespace(instances={"ui": form})
            ),
        }
        with patch.dict(sys.modules, modules), patch("run.time.sleep") as sleep:
            self.assertFalse(api.print_to(210, 297, 0, "Chosen"))
        sleep.assert_not_called()
        form.BeginInvoke.assert_not_called()

    def test_dispatch_timeout_does_not_print_later(self):
        api = DesktopApi()
        api._window = SimpleNamespace(uid="late")
        core = MagicMock()
        pending = []
        form = SimpleNamespace(
            InvokeRequired=True, BeginInvoke=pending.append,
            browser=SimpleNamespace(webview=SimpleNamespace(CoreWebView2=core)),
        )
        modules = {
            "System": SimpleNamespace(Action=lambda action: action),
            "webview.platforms.winforms": SimpleNamespace(
                BrowserView=SimpleNamespace(instances={"late": form})
            ),
        }
        with patch.dict(sys.modules, modules), patch("run.time.monotonic", side_effect=[0, 31, 32]):
            self.assertFalse(api.print_to(210, 297, 0, "Chosen"))
            pending[0]()
        core.PrintAsync.assert_not_called()


if __name__ == "__main__":
    unittest.main()
