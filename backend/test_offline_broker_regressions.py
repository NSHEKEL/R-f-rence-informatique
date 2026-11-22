import sys
import tempfile
import unittest
from unittest.mock import patch

from app.offline_broker import BrokerError, OfflineBroker


@unittest.skipUnless(sys.platform == "win32", "Journal Windows / DPAPI")
class OfflineBrokerRegressionTests(unittest.TestCase):
    def test_adopted_server_till_id_is_normalized_but_another_till_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            broker = OfflineBroker(root)
            session = {"id": -1, "server_session_id": 77, "baseline": {"id": 42}}
            with patch.object(broker, "_auth", return_value=({}, {}, set())), patch.object(broker, "_local_session", return_value=session), patch.object(broker, "_session_key", return_value="test"), patch.object(broker.store, "get", return_value={}):
                with patch("app.offline_broker.SaleCreate.model_validate", side_effect=RuntimeError("schema reached")) as validate:
                    for session_id in (-1, 42, 77, None):
                        with self.assertRaisesRegex(RuntimeError, "schema reached"):
                            broker.sale({"cash_session_id": session_id}, {})
                        validate.assert_called_with({"cash_session_id": None})
                    validate.reset_mock()
                    with self.assertRaises(BrokerError):
                        broker.sale({"cash_session_id": 99}, {})
                    validate.assert_not_called()

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
