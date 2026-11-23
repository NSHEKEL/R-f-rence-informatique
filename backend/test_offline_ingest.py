import json
import unittest
import uuid
import threading
from contextlib import nullcontext
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import test_cash_register as fixtures
from app.models import CashMovement, CashSession, OfflineEvent, OfflineSession, Product, Sale
from app.offline_auth import issue, read_grant
from app.offline_crypto import sign
from app.offline_store import OfflineStore
from app.offline_crypto import private_key, public_key
from app.routers import offline
from app.offline_broker import BrokerError, OfflineBroker


class OfflineIngestTests(unittest.TestCase):
    call = fixtures.CashRegisterTests.call
    grant = fixtures.CashRegisterTests.grant

    def setUp(self):
        fixtures.CashRegisterTests.setUp(self)
        self.app.include_router(offline.router)
        self.grant("caisse", "vente_nouvelle", "caisse_fermer", "soldes_consulter", "caisse_operations")
        self.private = private_key()
        for target in (
            patch("app.offline_auth.persistent_secret", return_value=self.private.encode()),
            patch("app.offline_auth.installation_uid", return_value="offline-test-shop"),
            patch("app.licensing.installation_uid", return_value="offline-test-shop"),
            patch("app.offline_auth.has_feature", return_value=True),
            patch("app.licensing.has_feature", return_value=True),
            patch("app.licensing.effective", return_value=SimpleNamespace(blocked=False, features=set())),
            patch("app.remote_sales.schedule"),
        ):
            target.start()
            self.addCleanup(target.stop)
        self.device = str(uuid.uuid4())
        self.session = str(uuid.uuid4())
        grant = issue(self.db, self.user, self.device, public_key(self.private), True)
        self.token = grant["offline_grant"]
        self.claims = read_grant(self.db, self.token)
        catalogue = self.call("/api/offline/catalogue")
        from app.offline_crypto import digest
        self.catalogue_id = catalogue["snapshot_id"]
        self.sequence = 0

    def event(self, kind, payload):
        self.sequence += 1
        body = {"id": str(uuid.uuid4()), "v": 1, "scope": self.claims["iss"], "device_id": self.device,
                "user_id": self.user.id, "session_id": self.session, "sequence": self.sequence,
                "kind": kind, "occurred_at": self.claims["auth_at"] + 0.01, "grant": self.token, "payload": payload}
        return {"event": body, "signature": sign(self.private, body)}

    def submit(self, *events):
        return self.call("/api/offline/events", "POST", {"events": list(events)})["results"]

    def sale(self, payment="Espèces", quantity=1):
        return self.event("sale", {"catalogue_id": self.catalogue_id,
            "sale": {"payment_method": payment, "status": "Payée", "items": [{"product_id": self.product.id, "quantity": quantity, "unit_price": 100}]},
            "snapshot": {"reference": "RECU-ORIGINAL", "total": quantity * 100}})

    def test_two_sales_fraction_momo_lost_ack_and_movements_are_applied_once(self):
        opening = self.event("open", {"opening_balance": 500})
        first, second = self.sale("Mobile Money"), self.sale(quantity=0.5)
        movement = self.event("movement", {"type": "out", "amount": 10, "reason": "Remise"})
        for envelope in (opening, first, second, movement):
            self.assertEqual(self.submit(envelope)[0]["state"], "applied")
        for _ in range(2):
            self.assertTrue(all(row["state"] == "applied" for row in self.submit(opening, first, second, movement)))
        with self.sessions() as db:
            self.assertEqual(db.query(Sale).count(), 2)
            self.assertEqual(db.query(CashSession).count(), 1)
            self.assertEqual(db.query(CashMovement).count(), 1)
            self.assertEqual(db.get(Product, self.product.id).quantity, 18.5)
            self.assertEqual(db.query(OfflineSession).one().status, "open")
        self.assertEqual(self.call("/api/cash-sessions/current")["expected_cash"], 640)
        self.assertEqual(self.call("/api/offline/catalogue")["snapshot_id"], self.catalogue_id)
        closing = self.event("close", {"closing_balance": 640, "kept_balance": 100})
        self.assertEqual(self.submit(closing)[0]["state"], "applied")
        with self.sessions() as db:
            self.assertEqual(db.query(CashSession).one().remitted_amount, 540)

    def test_historical_prices_are_preserved_without_updating_catalogue(self):
        self.submit(self.event("open", {"opening_balance": 0}))
        with self.sessions() as db:
            db.get(Product, self.product.id).sale_price = 200
            db.commit()
        sale = self.sale(quantity=0.5)
        self.assertEqual(self.submit(sale)[0]["state"], "applied")
        with self.sessions() as db:
            self.assertEqual(db.query(Sale).one().total, 50)
            self.assertEqual(db.get(Product, self.product.id).sale_price, 200)

    def recovery_broker(self, *envelopes):
        results = {}
        broker = OfflineBroker.__new__(OfflineBroker)
        broker.sync_lock = threading.Lock()
        broker.store = SimpleNamespace(
            connection=lambda: nullcontext(None),
            events=lambda *args, **kwargs: [{"envelope": envelope} for envelope in envelopes if results.get(envelope["event"]["id"], {}).get("state") != "applied"],
            acknowledge=lambda db, event_id, result: results.update({event_id: result}),
        )
        return broker

    def test_provisional_opening_adopts_same_device_till_without_close_or_double_expense(self):
        original = self.call("/api/cash-sessions/open", "POST", {"opening_balance": 1000}, status=201)
        self.db.get(CashSession, original["id"]).workstation = self.device
        self.db.commit()
        self.grant("depenses_gerer", "clotures_consulter", "tresorerie_consulter")
        self.call("/api/accounting/expenses", "POST", {"label": "Transport", "amount": 5, "payment_method": "Espèces"}, status=201)
        opening, sale = self.event("open", {"opening_balance": 500}), self.sale(quantity=0.5)
        broker = self.recovery_broker(opening, sale)
        self.assertEqual(broker.recover_local(self.db, self.claims["iss"], self.user.id), {"recovered": 2})
        self.assertEqual(broker.recover_local(self.db, self.claims["iss"], self.user.id), {"recovered": 0})
        current = self.call("/api/cash-sessions/current")
        self.assertEqual(current["id"], original["id"])
        self.assertEqual(current["opening_balance"], 1000)
        self.assertEqual(current["sales_count"], 1)
        self.assertEqual(current["total_sales"], 50)
        self.assertEqual(current["cash_expenses"], 5)
        self.assertEqual(current["expected_cash"], 1045)
        self.assertEqual(self.db.query(CashSession).count(), 1)
        self.assertEqual(self.db.query(OfflineSession).one().cash_session_id, original["id"])
        closed = self.call("/api/cash-sessions/close", "POST", {"cash_session_id": self.call("/api/cash-sessions/current")["id"], "closing_balance": 1045})
        self.assertEqual(closed["cash_expenses"], 5)
        print("PROVISIONAL_ADOPTION_OK forced_close=False sessions=1 server_float=1000 expenses_deducted_once=5 sales=1 replayed_once=True")

    def test_same_till_or_mixed_recovery_errors_never_allow_closing(self):
        self.submit(self.event("open", {"opening_balance": 500}))
        self.db.get(Product, self.product.id).quantity = 0
        self.db.commit()
        broker = self.recovery_broker(self.sale())
        with self.assertRaises(BrokerError) as stock:
            broker.recover_local(self.db, self.claims["iss"], self.user.id)
        self.assertEqual(stock.exception.status, 409)
        bad_sale = self.sale()
        bad_sale["signature"] = "invalid"
        broker = self.recovery_broker(bad_sale)
        with self.assertRaises(BrokerError) as conflict:
            broker.recover_local(self.db, self.claims["iss"], self.user.id)
        self.assertEqual(conflict.exception.status, 409)
        self.assertIsNone(self.call("/api/cash-sessions/current")["closed_at"])
        self.session = str(uuid.uuid4())
        self.sequence = 0
        opening = self.event("open", {"opening_balance": 500})
        broker = self.recovery_broker(opening, bad_sale)
        with self.assertRaises(BrokerError) as mixed:
            broker.recover_local(self.db, self.claims["iss"], self.user.id)
        self.assertEqual(mixed.exception.status, 409)

    def test_failed_close_does_not_merge_a_later_journal_session(self):
        first_open = self.event("open", {"opening_balance": 500})
        first_sale = self.sale(quantity=21)
        first_close = self.event("close", {"closing_balance": 2600})
        self.assertEqual([row["state"] for row in self.submit(first_open, first_sale, first_close)], ["applied", "conflict", "conflict"])
        first_id = self.call("/api/cash-sessions/current")["id"]
        self.session = str(uuid.uuid4())
        self.sequence = 0
        second_open = self.event("open", {"opening_balance": 200})
        second_sale = self.sale(quantity=0.5)
        second_close = self.event("close", {"closing_balance": 250})
        self.assertEqual([row["state"] for row in self.submit(second_open, second_sale, second_close)], ["conflict"] * 3)
        for envelope in (first_close, second_open, second_sale, second_close):
            self.assertEqual(json.loads(self.db.get(OfflineEvent, envelope["event"]["id"]).envelope), envelope)
        current = self.call("/api/cash-sessions/current")
        self.assertEqual(current["id"], first_id)
        self.assertIsNone(current["closed_at"])
        self.assertEqual(current["sales_count"], 0)
        self.assertEqual(self.db.query(OfflineSession).count(), 1)
        self.db.get(Product, self.product.id).quantity = 30
        self.db.commit()
        self.assertTrue(all(row["state"] == "applied" for row in self.submit(first_sale, first_close)))
        self.assertTrue(all(row["state"] == "applied" for row in self.submit(second_open, second_sale, second_close)))
        self.db.expire_all()
        mappings = self.db.query(OfflineSession).all()
        self.assertEqual(len({row.cash_session_id for row in mappings}), 2)
        self.assertEqual(self.db.query(Sale).count(), 2)
        print("JOURNAL_IDENTITY_GUARD_OK failed_close_preserves_first=True later_open_conflict=True distinct_after_recovery=True")

    def test_admin_can_review_a_deleted_users_conflicts_without_posting_or_losing_them(self):
        envelopes = [self.event("open", {"opening_balance": 500}), self.sale(quantity=0.5)]
        self.user.is_active = False
        self.db.commit()
        self.assertTrue(all(row["state"] == "conflict" for row in self.submit(*envelopes)))
        self.user.is_active = True
        self.user.role = "admin"
        self.db.commit()
        event_id = envelopes[0]["event"]["id"]
        self.call(f"/api/offline/events/{event_id}/resolve", "POST", {"reason": "Vérifié sur pièces", "review": True}, status=409)
        self.db.delete(self.user)
        self.user = self.other
        self.db.commit()
        self.call(f"/api/offline/events/{event_id}/resolve", "POST", {"reason": "Vérifié sur pièces", "review": True}, status=403)
        self.user.role = "admin"
        self.db.commit()
        self.call(f"/api/offline/events/{event_id}/resolve", "POST", {"reason": "     ", "review": True}, status=400)
        self.assertTrue(all(row["user_deleted"] for row in self.call("/api/offline/events")))
        for envelope in envelopes:
            event_id = envelope["event"]["id"]
            result = self.call(f"/api/offline/events/{event_id}/resolve", "POST", {"reason": "Vérifié sur pièces", "review": True})
            self.assertEqual(result["state"], "reviewed")
            row = self.db.get(OfflineEvent, event_id)
            self.assertEqual(json.loads(row.envelope), envelope)
            self.assertEqual(json.loads(row.resolution)[-1]["actor_id"], self.user.id)
        self.assertTrue(all(row["state"] == "reviewed" for row in self.submit(*envelopes)))
        self.assertEqual(self.db.query(Sale).count(), 0)
        self.assertEqual(self.db.query(CashSession).count(), 0)
        print("ORPHAN_REVIEW_OK admin_only=True live_accounts_rejected=True original_kept=True replay_reviewed=True posted_sales=0")

    def test_reviewed_ack_is_durable_and_no_longer_pending(self):
        store = OfflineStore(Path(self.temp.name) / "review-journal")
        with store.connection() as db:
            envelope = store.append(db, "scope", 999, str(uuid.uuid4()), "open", {"opening_balance": 500}, "grant")
            event_id = envelope["event"]["id"]
            from app.offline_crypto import digest
            store.acknowledge(db, event_id, {"hash": digest(envelope["event"]), "state": "reviewed"})
            self.assertEqual(store.events(db, "scope", pending=True), [])
            self.assertEqual(store.events(db, "scope")[0]["envelope"], envelope)

    def test_settings_keep_old_unresolved_conflicts_visible_beyond_terminal_history(self):
        self.assertEqual(self.call("/api/offline/events"), [])
        for index in range(205):
            self.db.add(OfflineEvent(id=str(uuid.uuid4()), device_id=self.device, user_id=self.user.id, session_id="history", sequence=index+1, kind="sale", occurred_at=self.claims["auth_at"], received_at=datetime(2020, 1, 1) + timedelta(seconds=index+1), hash="hash", envelope="{}", state="reviewed", result="{}"))
        old = OfflineEvent(id="old-conflict", device_id=self.device, user_id=self.user.id, session_id="old", sequence=1, kind="sale", occurred_at=self.claims["auth_at"], received_at=datetime(2020, 1, 1), hash="hash", envelope="{}", state="conflict", result="{}")
        self.db.add(old)
        self.db.commit()
        rows = self.call("/api/offline/events")
        self.assertEqual(len(rows), 201)
        self.assertEqual(rows[0]["id"], old.id)
        self.assertEqual(rows[0]["state"], "conflict")

    def test_reviewed_sale_exclusion_retries_until_central_acknowledges_the_same_uuid(self):
        from app import remote_sales
        from app.offline_crypto import digest
        envelope = self.sale(quantity=0.5)
        event = envelope["event"]
        row = OfflineEvent(id=event["id"], device_id=self.device, user_id=self.user.id, session_id=self.session, sequence=event["sequence"], kind="sale", occurred_at=event["occurred_at"], hash=digest(event), envelope=json.dumps(envelope), state="reviewed", result='{"reason":"original conservé"}', resolution=json.dumps([{"actor_id":self.other.id,"reason":"Pièces vérifiées","at":event["occurred_at"],"review":True}]))
        self.db.add(row)
        self.db.commit()
        state = SimpleNamespace(token="installation-test", installation_uid="offline-test-shop", central_url="https://central.test")
        with patch("app.licensing.state", return_value=state), patch("app.licensing._post") as post, patch("app.mobile_ops.process_pending"):
            post.side_effect = ConnectionError("network unavailable")
            with self.assertRaises(ConnectionError):
                remote_sales.push(self.db)
            self.assertNotIn("central_exclusion_acked", json.loads(row.result))
            post.side_effect = None
            post.return_value = {"status":"ok"}
            remote_sales.push(self.db)
            self.assertEqual(post.call_args.args[1]["offline_exclusions"][0]["operation_id"], row.id)
            self.assertNotIn("central_exclusion_acked", json.loads(row.result))
            post.return_value = {"excluded_operations":[row.id]}
            remote_sales.push(self.db)
            self.assertTrue(json.loads(row.result)["central_exclusion_acked"])
            remote_sales.push(self.db)
            self.assertEqual(post.call_args.args[1]["offline_exclusions"], [])
        self.assertEqual(json.loads(row.envelope), envelope)
        self.assertEqual(self.db.query(Sale).count(), 0)

    def test_reviewed_duplicate_replay_never_excludes_a_booked_sale(self):
        from app import remote_sales
        from app.offline_crypto import digest
        self.call("/api/cash-sessions/open", "POST", {"opening_balance": 500}, 201)
        envelope = self.sale(quantity=0.5)
        event = envelope["event"]
        self.call("/api/sales", "POST", {"client_id": event["id"], "payment_method": "Espèces", "items": [{"product_id": self.product.id, "quantity": 0.5, "unit_price": 100}]}, 201)
        row = OfflineEvent(id=event["id"], device_id=self.device, user_id=987654, session_id=self.session, sequence=event["sequence"], kind="sale", occurred_at=event["occurred_at"], hash=digest(event), envelope=json.dumps(envelope), state="reviewed", result="{}", resolution=json.dumps([{"actor_id":self.other.id,"reason":"Compte supprimé, doublon conservé","at":event["occurred_at"],"review":True}]))
        self.db.add(row)
        self.db.commit()
        state = SimpleNamespace(token="installation-test", installation_uid="offline-test-shop", central_url="https://central.test")
        with patch("app.licensing.state", return_value=state), patch("app.licensing._post", return_value={"status":"ok"}) as post, patch("app.mobile_ops.process_pending"):
            remote_sales.push(self.db)
            self.assertEqual(post.call_args.args[1]["offline_exclusions"], [])
            self.assertTrue(any(sale["operation_id"] == event["id"] for sale in post.call_args.args[1]["sales"]))
        self.assertEqual(self.db.query(Sale).count(), 1)
        self.assertEqual(json.loads(row.envelope), envelope)
        self.assertNotIn("central_exclusion_acked", json.loads(row.result))
        print("BOOKED_REPLAY_REVIEW_OK booked_sale_kept=True mobile_exclusion_sent=False original_kept=True")

    def test_valid_receipts_sync_after_expiry_but_new_out_of_window_receipts_do_not(self):
        from fastapi import HTTPException
        from app.offline_auth import current_account

        opening, sale = self.event("open", {"opening_balance": 500}), self.sale()
        with patch("app.offline_auth.time.time", return_value=self.claims["exp"] + 3600):
            with self.assertRaises(HTTPException):
                current_account(self.db, self.claims)
            self.assertTrue(all(row["state"] == "applied" for row in self.submit(opening, sale)))
            expired = self.sale()
            expired["event"]["occurred_at"] = self.claims["exp"] + 1
            expired["signature"] = sign(self.private, expired["event"])
            self.call("/api/offline/events", "POST", {"events": [expired]}, 403)
            with self.sessions() as db:
                self.assertEqual(db.query(Sale).count(), 1)
                self.assertEqual(db.get(Product, self.product.id).quantity, 19)

    def test_lost_online_ack_adopts_same_sale_and_same_open_session(self):
        source = self.call("/api/cash-sessions/open", "POST", {"opening_balance": 500}, 201)
        with self.sessions() as db:
            db.get(CashSession, source["id"]).workstation = self.device
            db.commit()
        client_id = str(uuid.uuid4())
        self.call("/api/sales", "POST", {"client_id": client_id, "payment_method": "Espèces", "items": [{"product_id": self.product.id, "quantity": 1, "unit_price": 100}]}, 201)
        opening = self.event("open", {"opening_balance": 500, "source_session_id": source["id"]})
        sale = self.sale()
        sale["event"]["id"] = client_id
        sale["signature"] = sign(self.private, sale["event"])
        self.assertTrue(all(row["state"] == "applied" for row in self.submit(opening, sale)))
        self.assertTrue(all(row["state"] == "applied" for row in self.submit(opening, sale)))
        with self.sessions() as db:
            self.assertEqual(db.query(Sale).count(), 1)
            self.assertEqual(db.query(CashSession).count(), 1)
            self.assertEqual(db.get(Product, self.product.id).quantity, 19)
            self.assertEqual(db.query(OfflineSession).one().cash_session_id, source["id"])

    def test_disabled_account_preserves_inbox_without_posting(self):
        self.user.is_active = False
        self.db.commit()
        opening = self.event("open", {"opening_balance": 0})
        sale = self.sale()
        self.assertTrue(all(row["state"] == "conflict" for row in self.submit(opening, sale)))
        with self.sessions() as db:
            self.assertEqual(db.query(OfflineEvent).count(), 2)
            self.assertEqual(db.query(Sale).count(), 0)
            self.assertEqual(json.loads(db.get(OfflineEvent, sale["event"]["id"]).envelope), sale)

    def test_stock_conflict_and_uuid_tampering_never_lose_original(self):
        self.submit(self.event("open", {"opening_balance": 0}))
        sale = self.sale(quantity=100)
        self.assertEqual(self.submit(sale)[0]["state"], "conflict")
        changed = json.loads(json.dumps(sale))
        changed["event"]["payload"]["snapshot"]["total"] = 1
        self.call("/api/offline/events", "POST", {"events": [changed]}, 403)
        changed["signature"] = sign(self.private, changed["event"])
        self.call("/api/offline/events", "POST", {"events": [changed]}, 409)
        self.assertEqual(self.submit(sale)[0]["state"], "conflict")
        with self.sessions() as db:
            self.assertEqual(db.query(Sale).count(), 0)
            self.assertEqual(json.loads(db.get(OfflineEvent, sale["event"]["id"]).envelope), sale)
