import json
import time
import unittest
import uuid
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.central.database import Base, get_db
from app.central.models import Client, Installation, MirrorSale
from app.central.routers import mobile, provisioning
from app.offline_auth import AUDIENCE
from app.offline_crypto import digest, fingerprint, private_key, public_key, sign
from types import SimpleNamespace


class CentralOfflineTests(unittest.TestCase):
    def test_exclusion_is_idempotent_before_or_after_receipt_and_survives_canonical_upload(self):
        token = self.delegate().json()["token"]
        for exclude_first in (False, True):
            with self.subTest(exclude_first=exclude_first):
                envelope = self.event()
                operation_id = envelope["event"]["id"]
                upload = {"token": token, "events": [envelope]}
                exclusion = {"operation_id": operation_id, "actor_id": 1, "reason": "Pièces vérifiées, compte supprimé", "reviewed_at": time.time(), "event_hash": digest(envelope["event"])}
                body = {"installation_uid": self.installation.uid, "token": "installation-test-only", "offline_exclusions": [exclusion]}
                if not exclude_first:
                    self.assertEqual(self.client.post("/api/central/public/offline/events", json=upload).status_code, 200)
                    forbidden = self.client.post("/api/central/public/mirror", json={**body, "token": "wrong"})
                    self.assertEqual(forbidden.status_code, 401)
                for _ in range(2):
                    result = self.client.post("/api/central/public/mirror", json=body)
                    self.assertEqual(result.status_code, 200, result.text)
                    self.assertEqual(result.json()["excluded_operations"], [operation_id])
                self.assertEqual(self.client.post("/api/central/public/offline/events", json=upload).status_code, 200)
                canonical = {"installation_uid": self.installation.uid, "token": "installation-test-only", "sales": [{"reference": "VNT-"+operation_id, "operation_id": operation_id, "total": 1750, "status": "Payée"}]}
                self.assertEqual(self.client.post("/api/central/public/mirror", json=canonical).status_code, 200)
                self.db.expire_all()
                row = self.db.query(MirrorSale).filter_by(operation_id=operation_id).one()
                self.assertTrue(row.excluded)
                self.assertEqual(row.total, 1750)
                self.assertEqual(json.loads(row.offline_original), envelope)
                self.assertEqual(json.loads(row.exclusion)["event_hash"], exclusion["event_hash"])
                self.assertEqual(mobile._visible(self.db, SimpleNamespace(role="admin"), self.installation.client).count(), 0)
        print("CENTRAL_REVIEW_EXCLUSION_OK before_or_after_receipt=True replay_idempotent=True canonical_cannot_restore=True originals_retained=True mobile_visible=0")

    def test_exclusion_migration_is_additive_and_repeatable(self):
        from app.central import seed
        legacy = create_engine("sqlite://")
        self.addCleanup(legacy.dispose)
        with legacy.begin() as conn:
            conn.execute(text("CREATE TABLE mirror_sales (id INTEGER PRIMARY KEY, client_id INTEGER, reference VARCHAR, total FLOAT)"))
            conn.execute(text("INSERT INTO mirror_sales (id,client_id,reference,total) VALUES (1,1,'original',1750)"))
        with patch.object(seed, "engine", legacy):
            seed._add_missing_columns()
            seed._add_missing_columns()
        with legacy.connect() as conn:
            self.assertEqual(tuple(conn.execute(text("SELECT reference,total,excluded,exclusion FROM mirror_sales")).one()), ("original",1750,0,""))

    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        client = Client(company="Boutique test")
        self.db.add(client)
        self.db.flush()
        self.installation = Installation(client_id=client.id, uid="offline-shop-test", token="installation-test-only")
        self.db.add(self.installation)
        self.db.commit()
        self.shop_key = private_key()
        self.device_key = private_key()
        self.central_key = private_key()
        self.addCleanup(patch.stopall)
        patch("app.central.security.license_private_key", return_value=self.central_key).start()
        patch("app.central.offline_sales.license_private_key", return_value=self.central_key).start()
        self.device = str(uuid.uuid4())
        now = int(time.time())
        self.grant = jwt.encode({"jti": str(uuid.uuid4()), "iss": self.installation.uid, "aud": AUDIENCE, "sub": "7",
            "device_id": self.device, "cnf": fingerprint(public_key(self.device_key)), "permissions": ["caisse", "vente_nouvelle"],
            "auth_at": now, "iat": now, "exp": now + 86400, "user": {"email": "seller@test.invalid", "name": "Vendeur test"}}, self.shop_key, algorithm="RS256")
        app = FastAPI()
        app.include_router(provisioning.router)
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def delegate(self, token="installation-test-only"):
        return self.client.post("/api/central/public/offline/delegate", json={"installation_uid": self.installation.uid,
            "token": token, "public_key": public_key(self.shop_key), "device_public_key": public_key(self.device_key), "grant": self.grant})

    def event(self):
        event_id = str(uuid.uuid4())
        event = {"id": event_id, "v": 1, "device_id": self.device, "scope": self.installation.uid, "user_id": 7,
            "session_id": str(uuid.uuid4()), "sequence": 2, "kind": "sale", "grant": self.grant, "occurred_at": time.time(),
            "payload": {"sale": {"client_id": event_id, "payment_method": "Mobile Money", "items": [{"product_id": 1, "quantity": 0.5, "unit_price": 3500}]},
                "snapshot": {"reference": "HL-" + event_id, "total": 1750, "items": [{"name": "Lait", "quantity": 0.5, "unit_price": 3500}]}}}
        return {"event": event, "signature": sign(self.device_key, event)}

    def test_poste_first_then_shop_is_one_sale_and_preserves_original(self):
        delegated = self.delegate()
        self.assertEqual(delegated.status_code, 200, delegated.text)
        token = delegated.json()["token"]
        self.assertNotIn("installation-test-only", token)
        envelope = self.event()
        event_id = envelope["event"]["id"]
        for _ in range(2):
            response = self.client.post("/api/central/public/offline/events", json={"token": token, "events": [envelope]})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(self.db.query(MirrorSale).one().provisional)
        canonical = {"installation_uid": self.installation.uid, "token": "installation-test-only", "sales": [{"reference": "VNT-2026-0001",
            "operation_id": event_id, "total": 1750, "status": "Payée", "payment_method": "Mobile Money", "seller_email": "seller@test.invalid", "items": []}]}
        with patch("app.central.events.publish"), patch("app.central.routers.provisioning._notify_new_sales", create=True):
            response = self.client.post("/api/central/public/mirror", json=canonical)
        self.assertEqual(response.status_code, 200, response.text)
        row = self.db.query(MirrorSale).one()
        self.assertFalse(row.provisional)
        self.assertEqual(row.reference, "VNT-2026-0001")
        self.assertEqual(json.loads(row.offline_original), envelope)
        response = self.client.post("/api/central/public/offline/events", json={"token": token, "events": [envelope]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.db.query(MirrorSale).count(), 1)
        self.assertEqual(self.db.query(MirrorSale).one().total, 1750)
        self.assertFalse(self.db.query(MirrorSale).one().provisional)
        print("CENTRAL_OFFLINE_DEDUPE_OK poste_then_shop_then_poste rows=1 total=1750 original_preserved=True")

    def test_empty_forged_other_device_and_changed_uuid_are_rejected(self):
        self.assertEqual(self.delegate("wrong-installation-token").status_code, 401)
        token = self.delegate().json()["token"]
        self.assertEqual(self.client.post("/api/central/public/offline/events", json={"token": token, "events": []}).json()["accepted"], [])
        envelope = self.event()
        wrong = {**envelope, "signature": sign(private_key(), envelope["event"])}
        self.assertEqual(self.client.post("/api/central/public/offline/events", json={"token": token, "events": [wrong]}).status_code, 403)
        self.assertEqual(self.client.post("/api/central/public/offline/events", json={"token": token, "events": [envelope]}).status_code, 200)
        envelope["event"]["payload"]["snapshot"]["total"] = 99999
        envelope["signature"] = sign(self.device_key, envelope["event"])
        self.assertEqual(self.client.post("/api/central/public/offline/events", json={"token": token, "events": [envelope]}).status_code, 409)
        self.assertEqual(self.db.query(MirrorSale).one().total, 1750)
