import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.schema import CreateTable

import test_wholesale as wholesale
from app import migrate as migration
from app.database import Base
from app.models import AppMigration, Category, InventoryCount, InventorySession, Product, ProductPackaging, RolePermission, StockMovement
from app.permissions import role_matrix, save_matrix
from app.routers import inventory


class InventorySessionTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    sell = wholesale.WholesaleTests.sell
    grant = wholesale.WholesaleTests.grant
    open = wholesale.WholesaleTests.open

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        self.app.include_router(inventory.router)
        self.product.quantity = 0
        self.product.rayon = "Alimentation"
        self.product.emplacement = "A-01"
        self.second = Product(name="Excédent", sku="SECOND", quantity=100, purchase_price=10, sale_price=20)
        self.third = Product(name="Non compté", sku="THIRD", quantity=7, purchase_price=5, sale_price=10)
        self.db.add_all([self.second, self.third])
        self.db.add(ProductPackaging(product_id=self.product.id, name="Carton", factor=24, barcode="PACK24"))
        self.db.commit()

    def session(self, **extra):
        return self.call("/api/inventory/sessions", "POST", {"name": "Inventaire test", **extra}, 201)

    def count(self, session, product, physical=None, **extra):
        return self.call(f"/api/inventory/sessions/{session['id']}/counts/{product.id}", "PUT", {"physical_qty": physical, **extra})

    def quantity(self, product):
        with self.sessions() as db:
            return db.get(Product, product.id).quantity

    def test_purchase_240_missing_excess_sale_during_count_and_report(self):
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Grossiste", "items": [{"product_id": self.product.id, "packaging_quantity": 10, "packaging_unit_cost": 960}]}, 201)
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.assertEqual(self.quantity(self.product), 240)
        session = self.session()
        path = f"/api/inventory/sessions/{session['id']}"
        self.call(path + "/start", "POST", {})
        self.count(session, self.product, packaging_quantity=9, piece_quantity=19)
        self.count(session, self.second, 107)
        self.sell([{"quantity": 4}])
        result = self.call(path + "/validate", "POST", {})
        self.assertEqual([self.quantity(product) for product in (self.product, self.second, self.third)], [231, 107, 7])
        self.assertEqual(result["stats"], {"counted": 2, "not_counted": 1, "conforme": 0, "manquant": 1, "excedent": 1, "variance_value": -130, "theoretical_value": 10635, "physical_value": 10470, "stock_after_value": 10345})
        self.assertEqual(result["rows"][2]["status"], "non compté")
        self.assertEqual(result["validated_by_id"], self.user.id)
        self.assertIsNotNone(result["validated_at"])
        with self.sessions() as db:
            moves = db.query(StockMovement).filter_by(kind="inventaire").all()
            self.assertEqual([(move.stock_before, move.stock_after, move.quantity) for move in moves], [(236, 231, -5), (100, 107, 7)])
            self.assertTrue(all(move.reason == "Inventaire " + session["reference"] and move.created_by_id == self.user.id for move in moves))
            db.get(Product, self.product.id).purchase_price = 999
            db.commit()
        self.assertEqual(self.call(path + "/report")["stats"], result["stats"])
        self.call(path + "/validate", "POST", {}, 409)
        self.call(path + "/cancel", "POST", {}, 409)
        self.call(path + "/scan", "POST", {"code": "PACK24"}, 409)
        self.call(path + f"/counts/{self.product.id}", "PUT", {"physical_qty": 500}, 409)

    def test_blind_hides_theory_values_and_variance_in_every_response(self):
        session = self.session(blind=True)
        path = f"/api/inventory/sessions/{session['id']}"
        self.call(path + "/start", "POST", {})
        self.user.role = "vendeur"
        self.db.commit()
        self.call(path, status=403)
        self.call("/api/inventory/sessions", "POST", {"name": "Forbidden"}, 403)
        self.grant("inventaire")
        options = self.call("/api/inventory/sessions/options")
        self.assertTrue(options["products"])
        for forbidden in ("quantity", "purchase_price", "theoretical_qty"):
            self.assertNotIn('"' + forbidden + '"', json.dumps(options))
        for result in (self.call(path), self.call(path + "/report"), self.count(session, self.second, 98), self.call(path + "/scan", "POST", {"code": "PACK24"})):
            self.assertFalse(result["theoretical_visible"])
            for key in ("theoretical_qty", "unit_cost", "variance", "variance_value", "physical_value", "stock_after_qty", "stock_after_value", "theoretical_value"):
                self.assertNotIn('"' + key + '"', json.dumps(result))
            self.assertNotIn("manquant", result["stats"])
        self.call(path + "/validate", "POST", {}, 403)
        self.grant("inventaire_valider", "inventaire_voir_theorique")
        visible = self.call(path + "/report")
        self.assertTrue(visible["theoretical_visible"])
        self.assertEqual(visible["rows"][1]["variance"], -2)

    def test_scan_packaging_helper_restart_and_cancel_are_persistent(self):
        session = self.session(scope_type="selection", scope={"product_ids": [self.product.id]})
        path = f"/api/inventory/sessions/{session['id']}"
        self.assertEqual(self.call(path + "/scan", "POST", {"code": "PACK24"})["rows"][0]["physical_qty"], 24)
        self.assertEqual(self.call(path + "/scan", "POST", {"code": self.product.sku})["rows"][0]["physical_qty"], 25)
        self.call(path + "/scan", "POST", {"code": "unknown"}, 404)
        self.count(session, self.product, packaging_quantity=2, piece_quantity=3)
        with TestClient(self.app) as restarted:
            self.assertEqual(restarted.get(path).json()["rows"][0]["physical_qty"], 51)
        self.count(session, self.product, None)
        self.assertEqual(self.call(path)["stats"]["not_counted"], 1)
        self.call(path + "/validate", "POST", {}, 400)
        self.call(path + "/cancel", "POST", {})
        self.call(path + "/start", "POST", {}, 409)
        self.call(path + "/scan", "POST", {"code": "PACK24"}, 409)
        with self.sessions() as db:
            self.assertEqual(db.query(InventoryCount).filter_by(session_id=session["id"]).count(), 1)

    def test_transaction_rolls_back_all_products_on_stock_conflict(self):
        session = self.session()
        self.count(session, self.product, 1)
        self.count(session, self.second, 0)
        with self.sessions() as db:
            db.get(Product, self.second.id).quantity = 0
            db.commit()
        path = f"/api/inventory/sessions/{session['id']}"
        self.call(path + "/validate", "POST", {}, 409)
        self.assertEqual(self.quantity(self.product), 0)
        with self.sessions() as db:
            self.assertEqual(db.query(StockMovement).filter_by(kind="inventaire").count(), 0)
            self.assertEqual(db.get(InventorySession, session["id"]).status, "in_progress")
        self.count(session, self.second, 100)
        self.call(path + "/validate", "POST", {})
        self.assertEqual(self.quantity(self.product), 1)

    def test_scopes_locations_old_payload_csv_and_history(self):
        category = Category(name="Rayon catégorie")
        self.db.add(category)
        self.db.flush()
        self.product.category_id = category.id
        self.db.commit()
        for scope_type, scope in (("category", {"category_id": category.id}), ("rayon", {"rayon": "Alimentation"}), ("emplacement", {"emplacement": "A-01"})):
            session = self.session(scope_type=scope_type, scope=scope)
            self.assertEqual(len(session["rows"]), 1)
        self.call("/api/inventory/sessions", "POST", {"name": "empty", "scope_type": "rayon", "scope": {"rayon": "absent"}}, 400)
        self.call("/api/inventory/sessions", "POST", {"name": "bad", "scope_type": "selection", "scope": {"product_ids": [999]}}, 400)
        product = self.call(f"/api/products/{self.product.id}")
        product.pop("rayon")
        product.pop("emplacement")
        result = self.call(f"/api/products/{self.product.id}", "PUT", product)
        self.assertEqual(result["rayon"], "Alimentation")
        response = self.client.post("/api/products/import", files={"file": ("locations.csv", f"sku;nom;shelf;location\n{self.product.sku};Article;Frais;B-02\n".encode(), "text/csv")})
        self.assertEqual(response.status_code, 200, response.text)
        result = self.call(f"/api/products/{self.product.id}")
        self.assertEqual((result["rayon"], result["emplacement"]), ("Frais", "B-02"))
        self.assertEqual(len(self.client.get("/api/inventory/sessions", params={"scope_type": "rayon", "status": "draft"}).json()), 1)
        self.call(f"/api/products/{self.product.id}", "DELETE", status=400)


class InventoryMigrationTests(unittest.TestCase):
    def test_old_columns_and_effective_apply_permissions_migrate_once(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        ddl = str(CreateTable(Product.__table__).compile(engine))
        ddl = "\n".join(line for line in ddl.splitlines() if not line.strip().startswith(("rayon ", "emplacement ")))
        with engine.begin() as conn:
            conn.execute(text(ddl))
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO products (id, name, sku, quantity, purchase_price) VALUES (1, 'Ancien', 'OLD', 42, 10)"))
            conn.execute(RolePermission.__table__.insert(), [{"role": "vendeur", "permission": "inventaire_appliquer", "allowed": True}, {"role": "gestionnaire", "permission": "inventaire_appliquer", "allowed": False}])
        with patch.object(migration, "engine", engine):
            migration.migrate()
        with engine.begin() as conn:
            self.assertEqual(conn.execute(text("SELECT quantity, rayon, emplacement FROM products")).one(), (42, None, None))
            values = dict(conn.execute(text("SELECT role, allowed FROM role_permissions WHERE permission='inventaire_valider'")).all())
            self.assertEqual(values, {"vendeur": 1, "gestionnaire": 0})
            conn.execute(text("UPDATE role_permissions SET allowed=0 WHERE permission='inventaire_valider' AND role='vendeur'"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT allowed FROM role_permissions WHERE role='vendeur' AND permission='inventaire_valider'")).scalar_one(), 0)
            self.assertEqual(conn.execute(text("SELECT count(*) FROM app_migrations WHERE name='inventory_session_permissions_v1'")).scalar_one(), 1)
            self.assertFalse(conn.execute(text("SELECT count(*) FROM role_permissions WHERE permission='inventaire_voir_theorique' AND allowed=1")).scalar_one())
        self.assertTrue({"inventory_sessions", "inventory_counts"}.issubset(inspect(engine).get_table_names()))
