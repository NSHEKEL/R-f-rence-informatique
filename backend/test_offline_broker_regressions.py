import sys
import tempfile
import unittest
from unittest.mock import patch

from app.offline_broker import OfflineBroker


@unittest.skipUnless(sys.platform == "win32", "Journal Windows / DPAPI")
class OfflineBrokerRegressionTests(unittest.TestCase):
    def test_explicit_logout_removes_resume_but_keeps_password_grant(self):
        with tempfile.TemporaryDirectory() as root:
            broker = OfflineBroker(root)
            account = {"server": "http://127.0.0.1:8444", "key": "auth:test", "scope": "shop", "user_id": 1}
            broker.identity = account
            with broker.store.connection() as db:
                broker.store.put(db, "last-login", account)
                broker.store.put(db, "auth:test", {"grant": "retained-for-password-login"})
            broker.logout()
            restarted = OfflineBroker(root)
            with patch.object(restarted, "sync") as sync:
                self.assertIsNone(restarted.resume())
                sync.assert_not_called()
            self.assertIsNone(broker.identity)
            self.assertEqual(restarted.bootstrap()["server"], account["server"])
            with restarted.store.connection() as db:
                self.assertEqual(restarted.store.get(db, "auth:test")["grant"], "retained-for-password-login")
