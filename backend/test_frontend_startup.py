import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import run


class FrontendStartupTests(unittest.TestCase):
    def startup(self):
        api = MagicMock()
        startup = run.FrontendStartup(api, "http://127.0.0.1:8000", timeout=0)
        return api, startup

    def test_explicit_mount_avoids_cache_clear_and_navigation(self):
        api, startup = self.startup()
        with patch.object(run, "_boot"):
            startup.mounted(startup.token)
            startup.watch()
        api._clear_webview_cache.assert_not_called()
        api._window.load_url.assert_not_called()
        api._window.load_html.assert_not_called()

    def test_missing_signal_retries_once_then_shows_error_even_if_html_loaded(self):
        api, startup = self.startup()
        with patch.object(run, "_boot") as log:
            startup.failed("module 404\nmissing", startup.token)
            startup.watch()
        api._clear_webview_cache.assert_called_once_with(startup.url)
        api._window.load_url.assert_called_once_with(startup.page_url())
        api._window.load_html.assert_called_once_with(run._LOAD_ERROR_HTML)
        self.assertTrue(any("module 404 missing" in call.args[0] for call in log.call_args_list))

    def test_native_html_load_is_not_readiness_and_bridge_mount_is(self):
        webview = MagicMock()
        window = webview.create_window.return_value

        def start(**kwargs):
            api = webview.create_window.call_args.kwargs["js_api"]
            self.assertFalse(api._startup.ready.is_set())
            api.frontend_ready(api._startup.token)
            self.assertTrue(api._startup.ready.is_set())

        webview.start.side_effect = start
        with patch.dict(sys.modules, {"webview": webview}), patch.object(run.sys, "platform", "linux"), \
                patch.object(run.threading, "Thread"), patch.object(run, "_boot"):
            self.assertTrue(run._open_window("http://127.0.0.1:8000"))
        window.events.loaded.__iadd__.assert_not_called()

    def test_mount_after_retry_succeeds_and_stale_page_signal_is_ignored(self):
        api, startup = self.startup()
        old_token = startup.token

        def loaded(url):
            startup.mounted(old_token)
            self.assertFalse(startup.ready.is_set())
            startup.mounted(startup.token)

        api._window.load_url.side_effect = loaded
        with patch.object(run, "_boot"):
            startup.watch()
        api._window.load_html.assert_not_called()
        api._clear_webview_cache.assert_called_once()

    def test_empty_errors_are_bounded_and_stale_errors_ignored(self):
        _, startup = self.startup()
        with patch.object(run, "_boot"):
            startup.failed("", startup.token)
            self.assertEqual(startup.reason, "erreur frontend sans detail")
            startup.failed("x" * 2000, startup.token)
            self.assertEqual(len(startup.reason), 1500)
            startup.failed("stale", "old-token")
            self.assertEqual(startup.reason, "x" * 1500)

    def test_cache_or_navigation_failure_does_not_loop_or_escape(self):
        api, startup = self.startup()
        api._clear_webview_cache.side_effect = OSError("old runtime")
        api._window.load_url.side_effect = OSError("navigation failed")
        with patch.object(run, "_boot"), self.assertLogs(level="ERROR"):
            startup.watch()
        api._clear_webview_cache.assert_called_once()
        api._window.load_url.assert_called_once()
        api._window.load_html.assert_called_once()

    def test_bridge_readiness_errors_and_manual_retry(self):
        api = run.DesktopApi()
        self.assertFalse(api.retry_frontend())
        api.frontend_ready()
        api.frontend_error("early")
        api._window = MagicMock()
        api._startup = run.FrontendStartup(api, "http://127.0.0.1:8000")
        with patch.object(run, "_boot"), patch.object(run.threading, "Thread") as thread:
            api.frontend_error("bad script", api._startup.token)
            api.frontend_ready(api._startup.token)
            self.assertTrue(api._startup.ready.is_set())
            self.assertTrue(api.retry_frontend())
            self.assertFalse(api._startup.ready.is_set())
            api._window.load_url.assert_called_once_with(api._startup.page_url())
            thread.return_value.start.assert_called_once()

    def test_native_cache_clear_preserves_cookies_local_storage_and_offline_queue(self):
        api = run.DesktopApi()
        api._window = SimpleNamespace(uid="test")
        core = MagicMock()
        core.CallDevToolsProtocolMethodAsync.return_value = SimpleNamespace(IsCompleted=True, Result="{}")
        form = SimpleNamespace(browser=SimpleNamespace(webview=SimpleNamespace(CoreWebView2=core)), BeginInvoke=lambda action: action())
        modules = {"System": SimpleNamespace(Action=lambda action: action),
                   "webview.platforms.winforms": SimpleNamespace(BrowserView=SimpleNamespace(instances={"test": form}))}
        with patch.dict(sys.modules, modules):
            api._clear_webview_cache("http://127.0.0.1:8000")
        calls = core.CallDevToolsProtocolMethodAsync.call_args_list
        self.assertEqual(calls[0].args, ("Network.clearBrowserCache", "{}"))
        self.assertEqual(calls[1].args[0], "Storage.clearDataForOrigin")
        self.assertEqual(json.loads(calls[1].args[1]), {
            "origin": "http://127.0.0.1:8000", "storageTypes": "service_workers,cache_storage",
        })


if __name__ == "__main__":
    unittest.main()
