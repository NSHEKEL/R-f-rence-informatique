import asyncio
import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException

from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
    "EASYGEST_DATA_DIR": folder, "DATABASE_URL": "sqlite:///:memory:", "SECRET_KEY": "network-tests-only",
}):
    from app import network
    from app.auth import get_current_user, require_admin
    from app.database import Base, get_db
    from app.main import app
    from app.models import CashSession, CompanySettings, Counter, Customer, Product, Sale, SaleItem, Supplier, User, Workstation
    from app.routers import sales
    from app.schemas import SaleCreate


async def get(path, ip, method="GET", headers=(), include_headers=False, target=app, body=b""):
    messages = []
    initial = True

    async def receive():
        nonlocal initial
        if initial:
            initial = False
            return {"type": "http.request", "body": body, "more_body": False}
        await asyncio.Event().wait()

    async def send(message):
        messages.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method,
             "scheme": "http", "path": path, "raw_path": path.encode(), "query_string": b"",
             "headers": [(b"host", b"127.0.0.1:8000"), (b"user-agent", b"Android test"), *headers],
             "server": ("127.0.0.1", 8000), "client": (ip, 1234)}
    await asyncio.wait_for(target(scope, receive, send), 20)
    status = next(message["status"] for message in messages if message["type"] == "http.response.start")
    body = b"".join(message.get("body", b"") for message in messages if message["type"] == "http.response.body")
    result = (status, json.loads(body) if body.startswith((b"{", b"[")) else body.decode())
    if include_headers:
        return (*result, dict(next(message["headers"] for message in messages if message["type"] == "http.response.start")))
    return result


class NetworkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        env = patch.dict(os.environ, {"EASYGEST_DATA_DIR": str(self.root)})
        env.start()
        self.addCleanup(env.stop)
        self.engine = create_engine(f"sqlite:///{self.root / 'shop.db'}", connect_args={"check_same_thread": False, "timeout": 30})
        self.addCleanup(self.engine.dispose)
        with self.engine.connect() as conn:
            conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        Base.metadata.create_all(self.engine)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
        self.db = self.sessions()
        self.addCleanup(self.db.close)
        self.user = User(name="Admin", email="test@example.test", hashed_password="unused", role="admin")
        self.db.add_all([self.user, CompanySettings(name="Test")])
        self.db.commit()
        patcher = patch.object(network, "SessionLocal", self.sessions)
        patcher.start()
        self.addCleanup(patcher.stop)
        previous = dict(app.dependency_overrides)
        self.addCleanup(lambda: (app.dependency_overrides.clear(), app.dependency_overrides.update(previous)))

        def db_dependency():
            with self.sessions() as session:
                yield session

        app.dependency_overrides[get_db] = db_dependency
        app.dependency_overrides[require_admin] = lambda: self.user
        app.dependency_overrides[get_current_user] = lambda: self.user

    def restrict(self, value=True):
        self.db.query(CompanySettings).first().network_restrict_workstations = value
        self.db.commit()

    def test_default_off_keeps_remote_access_and_health_contract(self):
        code, info = asyncio.run(get("/api/network", "192.168.1.50"))
        self.assertEqual(code, 200)
        self.assertEqual(info["role"], "principal")
        self.assertEqual(info["port"], 8000)
        self.assertEqual(info["connected_count"], 1)
        code, health = asyncio.run(get("/api/health", "192.168.1.50"))
        self.assertEqual(code, 200)
        self.assertNotIn("workstation_status", health)
        self.assertEqual(self.db.query(Workstation).one().status, "pending")

    def test_network_requires_auth_but_health_remains_public(self):
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(asyncio.run(get('/api/network', '127.0.0.1'))[0], 401)
        self.assertEqual(asyncio.run(get('/api/health', '127.0.0.1'))[0], 200)

    def test_pending_health_allowed_other_api_forbidden_then_approved_then_blocked(self):
        self.restrict()
        code, health = asyncio.run(get("/api/health", "192.168.1.50"))
        self.assertEqual(code, 200)
        self.assertEqual(health["workstation_status"], "pending")
        code, error = asyncio.run(get("/api/network", "192.168.1.50"))
        self.assertEqual(code, 403)
        self.assertEqual(error["code"], "workstation_not_authorized")
        poste = self.db.query(Workstation).one()
        network.change(poste.id, network.WorkstationChange(status="approved", name="Android"), self.db, self.user)
        self.assertEqual(asyncio.run(get("/api/network", poste.ip))[0], 200)
        self.assertEqual(asyncio.run(get("/api/health", poste.ip))[1]["workstation_status"], "approved")
        network.change(poste.id, network.WorkstationChange(status="blocked"), self.db, self.user)
        self.assertEqual(asyncio.run(get("/api/network", poste.ip))[0], 403)
        self.assertEqual(asyncio.run(get("/api/health", poste.ip))[0], 200)

    def test_loopback_always_allowed_and_admin_routes_still_require_auth(self):
        self.restrict()
        for ip in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            self.assertEqual(asyncio.run(get("/api/network", ip))[0], 200)
        app.dependency_overrides.pop(require_admin)
        app.dependency_overrides.pop(get_current_user)
        self.assertEqual(asyncio.run(get("/api/network/workstations", "127.0.0.1"))[0], 401)

    def test_cross_origin_rejection_has_cors_headers_and_preflight_works(self):
        self.restrict()
        origin = b"http://192.168.1.50:8000"
        code, error, headers = asyncio.run(get("/api/sales", "192.168.1.50", "POST", [(b"origin", origin)], True))
        self.assertEqual(code, 403)
        self.assertEqual(error["code"], "workstation_not_authorized")
        self.assertEqual(headers[b"access-control-allow-origin"], origin)
        code, _ = asyncio.run(get("/api/sales", "192.168.1.50", "OPTIONS", [(b"origin", origin), (b"access-control-request-method", b"POST")]))
        self.assertEqual(code, 200)

    def test_last_user_listing_deletion_and_re_registration(self):
        network.observe("192.168.1.50", self.user.id, "Android", "Téléphone")
        row = network.listing(self.db, self.user)[0]
        self.assertEqual(row["last_user"], "Admin")
        self.assertEqual(row["hostname"], "Téléphone")
        self.assertTrue(row["active"])
        network.delete(row["id"], self.db, self.user)
        network.observe("192.168.1.50")
        self.assertEqual(self.db.query(Workstation).one().status, "pending")

    def test_business_conflict_columns_absent_no_schema_change(self):
        for model in (Product, Customer, Supplier):
            self.assertNotIn("updated_at", model.__table__.columns)

    def test_two_concurrent_same_client_id_both_succeed_once(self):
        self.same_client_race(20)

    def test_same_id_last_unit_race_also_returns_existing_sale(self):
        self.same_client_race(1)

    def same_client_race(self, stock):
        product = Product(name="Produit", sku="TEST", quantity=stock, sale_price=100)
        self.db.add_all([product, CashSession(opened_by_id=self.user.id, business_day=datetime.now(timezone.utc).date().isoformat()),
                         Counter(name=f"VNT-{datetime.now(timezone.utc).year}", value=0)])
        self.db.commit()
        payload = SaleCreate(client_id="same-checkout", items=[{"product_id": product.id, "quantity": 1}], paid_amount=100)
        barrier = threading.Barrier(2)
        local = threading.local()
        collisions = []
        persist = sales._persist_sale

        def simultaneous(db, payload, user):
            if not getattr(local, "entered", False):
                local.entered = True
                barrier.wait(timeout=10)
            try:
                return persist(db, payload, user)
            except (IntegrityError, HTTPException):
                collisions.append(True)
                raise

        sale_app = FastAPI()
        sale_app.include_router(sales.router)
        sale_app.dependency_overrides[get_db] = app.dependency_overrides[get_db]
        sale_app.dependency_overrides[get_current_user] = lambda: self.user

        async def checkout():
            return await get("/api/sales", "127.0.0.1", "POST", [(b"content-type", b"application/json")],
                             target=sale_app, body=payload.model_dump_json().encode())

        async def simultaneous_requests():
            return await asyncio.gather(checkout(), checkout())

        with patch.object(sales, "_persist_sale", side_effect=simultaneous), patch.object(sales, "_backup_after_sale"), patch.object(sales.remote_sales, "schedule"):
            responses = asyncio.run(simultaneous_requests())
        self.assertEqual([status for status, _ in responses], [201, 201])
        self.assertEqual(responses[0][1]["id"], responses[1][1]["id"])
        self.assertTrue(collisions)
        self.db.expire_all()
        self.assertEqual(self.db.query(Sale).count(), 1)
        self.assertEqual(self.db.query(SaleItem).count(), 1)
        self.assertEqual(self.db.get(Product, product.id).quantity, stock - 1)


if __name__ == "__main__":
    unittest.main()
