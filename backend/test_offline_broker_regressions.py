import sys
import tempfile
import unittest
from unittest.mock import patch

from app.offline_broker import BrokerError, OfflineBroker


@unittest.skipUnless(sys.platform == "win32", "Journal Windows / DPAPI")
class OfflineBrokerRegressionTests(unittest.TestCase):
    def test_legacy_archives_remain_stored_but_do_not_count_as_pending(self):
        with tempfile.TemporaryDirectory() as root:
            broker = OfflineBroker(root)
            broker.identity = {"scope": "shop", "server": "http://server", "user_id": 1}
            entries = [{"scope": "http://server:1", "state": state, "snapshot": {"reference": state}} for state in ("archived", "rejected", "synced", "applied", "reviewed")]
            entries += [{"scope": "http://server:1", marker: "date", "snapshot": {"reference": marker}} for marker in ("rejected_at", "archived_at", "synced_at")]
            with broker.store.connection() as db:
                broker.store.put(db, "servers", ["http://server"])
                broker.store.put(db, "server:http://server", {"shop_id": "shop"})
            with patch.object(broker, "_auth", return_value=({}, {}, set())):
                self.assertEqual(broker.state()["pending"], [])
                broker.import_legacy(entries)
                self.assertEqual(broker.state()["pending"], [])
                active = {"scope": "http://server:1", "snapshot": {"reference": "live pending"}}
                broker.import_legacy([active])
                self.assertEqual([row["reference"] for row in broker.state()["pending"]], ["live pending"])
            with broker.store.connection() as db:
                retained = [broker.store.get(db, key) for key in broker.store.get(db, "legacy-index")]
                self.assertEqual(retained, [*entries, active])

    def test_close_matches_the_confirmed_local_or_adopted_id_before_journaling(self):
        with tempfile.TemporaryDirectory() as root:
            broker = OfflineBroker(root)
            rights = {"caisse", "caisse_fermer", "soldes_consulter"}
            for confirmed in (None, 99, -1, 42, 77):
                session = {"id": -1, "uuid": "session", "server_session_id": 77, "baseline": {"id": 42}}
                with patch.object(broker, "_auth", return_value=({"grant": "test"}, {"iss": "shop", "sub": "1"}, rights)), patch.object(broker, "_local_session", return_value=session), patch.object(broker, "_session_key", return_value="test"), patch.object(broker, "_detail", return_value={"expected_cash": 0}), patch.object(broker.store, "append", return_value={"event": {"id": "closing-event"}}) as append:
                    payload = {"cash_session_id": confirmed, "closing_balance": 0}
                    if confirmed == 99:
                        with self.assertRaises(BrokerError) as error:
                            broker.request("POST", "/cash-sessions/close", payload)
                        self.assertEqual(error.exception.status, 409)
                        self.assertNotIn("closed_at", session)
                        append.assert_not_called()
                    else:
                        broker.request("POST", "/cash-sessions/close", payload)
                        append.assert_called_once()
                        self.assertEqual(append.call_args.args[5]["cash_session_id"], confirmed)

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
