import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.offline_crypto import digest, fingerprint, private_key, public_key, sign, verify
from app.offline_store import OfflineStore, local_events_pending


class OfflineCryptoTests(unittest.TestCase):
    def test_signature_and_hash_reject_changes(self):
        private = private_key()
        public = public_key(private)
        event = {"amount": 1750, "quantity": 0.5}
        signature = sign(private, event)
        verify(public, event, signature)
        self.assertEqual(len(fingerprint(public)), 64)
        with self.assertRaises(Exception):
            verify(public, {**event, "quantity": 1}, signature)
        self.assertNotEqual(digest(event), digest({**event, "amount": 3500}))


@unittest.skipUnless(sys.platform == "win32", "DPAPI Windows")
class OfflineStoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="EasyGest-offline-test-", dir=os.environ["LOCALAPPDATA"])
        self.addCleanup(self.directory.cleanup)
        self.store = OfflineStore(self.directory.name)

    def test_local_pending_probe_reads_existing_journal_without_decrypting_or_creating_it(self):
        with patch.dict(os.environ, EASYGEST_OFFLINE_HOME=self.directory.name), patch("app.offline_store.installation_uid", return_value="shop"):
            self.assertFalse(local_events_pending())
            with self.store.connection() as db:
                self.store.append(db, "shop", 4, "session", "sale", {}, "grant")
            self.assertTrue(local_events_pending())
            with self.store.connection() as db:
                db.execute("UPDATE events SET state='applied'")
                self.store.append(db, "other-shop", 4, "session", "sale", {}, "grant")
            self.assertFalse(local_events_pending())
        missing = str(Path(self.directory.name) / "missing")
        with patch.dict(os.environ, EASYGEST_OFFLINE_HOME=missing):
            self.assertFalse(local_events_pending())
            self.assertFalse(Path(missing).exists())

    def test_commit_survives_restart_and_payloads_are_encrypted(self):
        payload = {"reference": "SECRET-RECEIPT", "quantity": 0.5, "amount": 1750}
        with self.store.connection() as db:
            self.store.put(db, "test", payload)
            envelope = self.store.append(db, "shop", 4, "session", "sale", payload, "grant")
        restarted = OfflineStore(self.directory.name)
        with restarted.connection() as db:
            self.assertEqual(restarted.get(db, "test"), payload)
            self.assertEqual(restarted.events(db, "shop")[0]["envelope"], envelope)
            duplicate = restarted.append(db, "shop", 4, "session", "sale", payload, "grant", envelope["event"]["id"])
            self.assertEqual(duplicate, envelope)
            with self.assertRaises(ValueError):
                restarted.append(db, "shop", 4, "session", "sale", {}, "grant", envelope["event"]["id"])
            with self.assertRaises(ValueError):
                restarted.acknowledge(db, envelope["event"]["id"], {"hash": "wrong", "state": "applied"})
        for path in Path(self.directory.name).glob("journal.sqlite3*"):
            self.assertNotIn(b"SECRET-RECEIPT", path.read_bytes())

    def test_transaction_rollback_and_clock_reversal_fail_closed(self):
        with self.assertRaises(RuntimeError):
            with self.store.connection() as db:
                self.store.put(db, "not-committed", {"value": 1})
                raise RuntimeError("interrupted")
        with self.store.connection() as db:
            self.assertIsNone(self.store.get(db, "not-committed"))
            self.store.clock(db)
        with patch("app.offline_store.time.time", return_value=0):
            with self.assertRaises(ValueError):
                with self.store.connection() as db:
                    self.store.clock(db)
