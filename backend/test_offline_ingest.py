import json
import unittest
import uuid
import threading
from contextlib import nullcontext
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
