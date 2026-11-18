import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import run


class LauncherNetworkTests(unittest.TestCase):
    def test_reuses_same_version_without_starting_thread(self):
        content = {"status": "ok", "app": run.APP_NAME, "version": run.APP_VERSION, "lifecycle": "managed"}
        with patch.object(run.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(content).encode())), \
                patch.object(run.threading, "Thread") as thread:
            self.assertEqual(run._start_backend(8000), (8000, False))
            thread.assert_not_called()

    def test_other_app_version_bad_response_and_unavailable_do_not_reuse(self):
        for content in ({"app": "Other", "version": run.APP_VERSION}, {"app": run.APP_NAME, "version": "0.0.0"}, []):
            with patch.object(run.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(content).encode())):
                self.assertFalse(run._existing_server(8000))
        with patch.object(run.urllib.request, "urlopen", side_effect=OSError("down")), \
                patch.object(run, "_free_port", return_value=8001), patch.object(run.threading, "Thread") as thread:
            self.assertEqual(run._start_backend(8000), (8001, True))
            thread.return_value.start.assert_called_once()

    def test_system_logs_go_to_shared_data_directory(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"USERNAME": "SYSTEM", "EASYGEST_DATA_DIR": folder}):
            self.assertEqual(run._log_path(), Path(folder) / "Logs" / "easygest.log")


if __name__ == "__main__":
    unittest.main()
