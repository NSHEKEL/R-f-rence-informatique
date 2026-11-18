import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.central.database import Base, get_db
from app.central.models import Client, Installation, MirrorReturn, MirrorSale, MirrorUser
from app.central.routers import mobile, provisioning
from app.central import seed


class MobileSummaryReturnsTests(unittest.TestCase):
    def test_period_returns_scope_and_repeat_summary(self):
        legacy = create_engine("sqlite://")
        self.addCleanup(legacy.dispose)
        with legacy.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE installations (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("CREATE TABLE mirror_users (id INTEGER PRIMARY KEY)")
            connection.exec_driver_sql("INSERT INTO installations (id) VALUES (1)")
            connection.exec_driver_sql("INSERT INTO mirror_users (id) VALUES (1)")
        with patch.object(seed, "engine", legacy):
            seed._add_missing_columns()
        with legacy.connect() as connection:
            self.assertEqual(connection.exec_driver_sql("SELECT cash_balances FROM installations WHERE id = 1").scalar_one(), "{}")
            self.assertEqual(connection.exec_driver_sql("SELECT cash_permissions FROM mirror_users WHERE id = 1").scalar_one(), "[]")
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        with Session(engine) as db:
            shop, other = Client(company="Boutique"), Client(company="Autre boutique")
            db.add_all([shop, other])
            db.flush()
            user = MirrorUser(client_id=shop.id, email="seller@test.invalid", role="vendeur")
            installation = Installation(client_id=shop.id, uid="shop-1", token="unit-test-token")
            now = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
            db.add(user)
            db.add(installation)
            for index, total in enumerate((190000, 157000, 124000)):
                db.add(MirrorSale(client_id=shop.id, reference=f"V-{index}", date=now,
                                  total=total, seller_email=user.email))
                db.add(MirrorReturn(client_id=shop.id, reference=f"AVR-{index+3}", date=now,
                                    sale_reference="VENTE-DU-MOIS-PRECEDENT", total=total, seller_email=user.email))
            db.add_all([
                MirrorSale(client_id=shop.id, reference="PREVIOUS-DAY", date=datetime(2026, 11, 1),
                           total=529000, seller_email=user.email),
                MirrorReturn(client_id=shop.id, reference="PREVIOUS-DAY", date=datetime(2026, 11, 2),
                             total=29000, seller_email=user.email),
                MirrorReturn(client_id=shop.id, reference="PREVIOUS-MONTH", date=datetime(2026, 10, 31),
                             total=999999, seller_email=user.email),
                MirrorSale(client_id=shop.id, reference="OTHER-SELLER", date=now, total=400, seller_email="other@test.invalid"),
                MirrorReturn(client_id=shop.id, reference="OTHER-SELLER", date=now, total=100, seller_email="other@test.invalid"),
                MirrorSale(client_id=other.id, reference="OTHER-SHOP", date=now, total=999999, seller_email=user.email),
                MirrorReturn(client_id=other.id, reference="OTHER-SHOP", date=now, total=999999, seller_email=user.email),
            ])
            db.commit()
            app = FastAPI()
            app.include_router(mobile.router)
            app.include_router(provisioning.router)
            app.dependency_overrides[get_db] = lambda: db
            app.dependency_overrides[mobile.current_mobile] = lambda: (user, shop)
            with TestClient(app) as client, patch.object(mobile, "utcnow", return_value=now):
                def summary():
                    response = client.get("/api/central/mobile/summary")
                    self.assertEqual(response.status_code, 200, response.text)
                    return response.json()

                result = summary()
                self.assertIsNone(result["today_expected_cash"])
                self.assertEqual(result["today_gross_total"], 471000)
                self.assertEqual(result["today_total"], 0)
                self.assertEqual(result["today_count"], 3)
                self.assertEqual(result["today_returns_total"], 471000)
                self.assertEqual(result["today_returns_count"], 3)
                self.assertEqual(result["month_total"], 500000)
                self.assertEqual(result["month_returns_total"], 500000)
                self.assertEqual(result["month_returns_count"], 4)
                self.assertEqual(result, summary())
                cash_snapshot = {"day": now.date().isoformat(), "generated_at": now.isoformat(), "sessions": [
                    {"key": "session-1", "seller_email": user.email, "expected_cash": 185, "closed": False},
                    {"key": "session-2", "seller_email": "other@test.invalid", "expected_cash": 50, "closed": False},
                ]}
                payload = {"installation_uid": installation.uid, "token": installation.token,
                           "users": [{"email": user.email, "role": "vendeur", "cash_permissions": ["soldes_consulter"]}],
                           "cash_balances": cash_snapshot}
                response = client.post("/api/central/public/mirror", json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(summary()["today_expected_cash"], 185)
                duplicate = Installation(client_id=shop.id, uid="shop-copy", token="unused",
                                         cash_balances=json.dumps(cash_snapshot))
                db.add(duplicate)
                db.commit()
                self.assertEqual(summary()["today_expected_cash"], 185)
                cash_snapshot["sessions"][0]["closed"] = True
                installation.cash_balances = duplicate.cash_balances = json.dumps(cash_snapshot)
                db.commit()
                self.assertIsNone(summary()["today_expected_cash"])
                user.cash_permissions = json.dumps(["soldes_consulter", "caisse_z"])
                db.commit()
                self.assertEqual(summary()["today_expected_cash"], 185)
                user.role = "admin"
                user.cash_permissions = json.dumps(["soldes_consulter", "clotures_consulter"])
                db.commit()
                self.assertEqual(summary()["today_expected_cash"], 235)
                self.assertEqual(summary()["today_total"], 300)
                self.assertEqual(summary()["today_count"], 4)
                self.assertEqual(summary()["today_returns_count"], 4)
                cash_snapshot["day"] = "2026-11-17"
                installation.cash_balances = duplicate.cash_balances = json.dumps(cash_snapshot)
                db.commit()
                self.assertIsNone(summary()["today_expected_cash"])
                db.query(MirrorSale).delete()
                db.query(MirrorReturn).delete()
                db.commit()
                empty = summary()
                self.assertEqual(empty["today_total"], 0)
                self.assertEqual(empty["month_returns_count"], 0)


if __name__ == "__main__":
    unittest.main()
