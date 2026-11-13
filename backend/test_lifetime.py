import ast
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from app import lifetime
import test_pos_display as pos_tests
from app.models import CompanySettings


class PrinterPersistenceTests(unittest.TestCase):
    setUp = pos_tests.PosDisplayTests.setUp
    call = pos_tests.PosDisplayTests.call
    open = pos_tests.PosDisplayTests.open

    def test_stale_company_save_cannot_erase_canonical_printer(self):
        self.user.role = 'admin'
        self.db.commit()
        config = self.call('/api/settings/printing')
        config['receipt']['width'] = 'A4'
        config['receipt']['printer_name'] = 'File choisie'
        self.call('/api/settings/printing', 'PUT', config)
        self.call('/api/settings/company', 'PUT', {'name': 'Société', 'printer_name': ''})
        self.assertEqual(self.call('/api/settings/company')['printer_name'], 'File choisie')
        self.assertEqual(self.call('/api/settings/printing')['receipt']['printer_name'], 'File choisie')
        self.db.expire_all()
        self.assertEqual(self.db.query(CompanySettings).one().printer_name, 'File choisie')


class LifetimeTests(unittest.TestCase):
    def test_reuse_requires_lifecycle_marker_and_healthy_owner(self):
        module = ast.parse(Path(__file__).with_name('run.py').read_text(encoding='utf-8'))
        function = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == '_existing_server')
        import urllib.request
        payload = {'status': 'ok', 'app': 'EasyGest', 'version': 'test'}
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, count): return json.dumps(payload).encode()
        messages = []
        namespace = {'urllib': __import__('urllib'), 'json': json, 'APP_NAME': 'EasyGest', 'APP_VERSION': 'test', '_report': messages.append}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'reuse-test', 'exec'), namespace)
        with patch.object(urllib.request, 'urlopen', return_value=Response()):
            with self.assertRaises(SystemExit):
                namespace['_existing_server'](8000)
            self.assertIn('Ancien serveur EasyGest', messages[0])
            payload['lifecycle'] = 'managed'
            self.assertTrue(namespace['_existing_server'](8000))
            payload['status'] = 'stopping'
            self.assertFalse(namespace['_existing_server'](8000))

    @unittest.skipUnless(sys.platform == 'win32', 'Windows parent process handle')
    def test_parent_termination_stops_child_listener(self):
        with tempfile.TemporaryDirectory() as folder:
            marker = Path(folder) / 'listener.json'
            child = "from app.lifetime import watch_parent; watch_parent(); import http.server,json,os; from pathlib import Path; s=http.server.HTTPServer(('127.0.0.1',0),http.server.BaseHTTPRequestHandler); Path(__import__('sys').argv[1]).write_text(json.dumps({'pid':os.getpid(),'port':s.server_port})); s.serve_forever()"
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); time.sleep(60)"
            process = subprocess.Popen([sys._base_executable, '-c', parent, child, str(marker)])
            try:
                deadline = time.monotonic() + 10
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(marker.exists())
                info = json.loads(marker.read_text())
                import socket
                with socket.create_connection(('127.0.0.1', info['port']), timeout=1): pass
                process.terminate()
                process.wait(timeout=5)
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    try:
                        with socket.create_connection(('127.0.0.1', info['port']), timeout=.1): pass
                    except OSError:
                        return
                    time.sleep(.05)
                self.fail('Le processus enfant écoute encore après arrêt du parent')
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
