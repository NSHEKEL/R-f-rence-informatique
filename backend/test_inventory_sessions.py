import json
import csv
import io
import unittest
from xml.sax.saxutils import escape
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.schema import CreateTable

import test_wholesale as wholesale
from app import migrate as migration
from app.database import Base
from app.models import AppMigration, Category, InventoryCount, InventorySession, Product, ProductBarcode, ProductPackaging, RolePermission, StockMovement
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
            self.assertTrue(all(move.reason.startswith("Inventaire " + session["reference"]) and move.created_by_id == self.user.id for move in moves))
            db.get(Product, self.product.id).purchase_price = 999
            db.commit()
        self.assertEqual(self.call(path + "/report")["stats"], result["stats"])
        self.call(path + "/validate", "POST", {}, 409)
        self.call(path + "/cancel", "POST", {}, 409)
        self.call(path + "/scan", "POST", {"code": "PACK24"}, 409)
        self.call(path + f"/counts/{self.product.id}", "PUT", {"physical_qty": 500}, 409)

    def test_variant_scan_and_packaging_code_keep_their_quantities(self):
        self.db.add(ProductBarcode(product_id=self.product.id, code="VAR-INVENTORY", label="Variante", active=True))
        self.db.add(ProductBarcode(product_id=self.product.id, code="PACK24", label="Variante carton", active=True))
        self.db.commit()
        session = self.session()
        path = f"/api/inventory/sessions/{session['id']}"
        for code in ("var-inventory", "PACK24"):
            result = self.call(path + "/scan", "POST", {"code": code})
        row = next(item for item in result["rows"] if item["product_id"] == self.product.id)
        self.assertEqual(row["physical_qty"], 25)
        self.call(path + "/scan", "POST", {"code": "UNKNOWN"}, 404)

    def test_mass_multi_packaging_resume_upsert_scan_focus_and_validation(self):
        self.product.units_per_packaging = 12
        self.product.quantity = 150
        pack = self.db.query(ProductPackaging).filter_by(product_id=self.product.id).one()
        pack.name, pack.factor = "Colis", 6
        self.db.add(ProductPackaging(product_id=self.product.id, name="Inactif", factor=99, active=False))
        self.db.add(Product(name="Inactif", sku="INACTIVE", active=False))
        self.db.add(ProductBarcode(product_id=self.product.id, code="PACK24", active=True))
        self.db.commit()
        session = self.session()
        self.assertEqual(len(session["rows"]), 3)
        path = f"/api/inventory/sessions/{session['id']}"
        counts = {"primary": 10, str(pack.id): 3, "base": 5}
        for _ in range(2):
            result = self.call(path + f"/counts/{self.product.id}?line_only=true", "PUT", {"counts": counts, "note": "Rayon terminé"})
            self.assertEqual(len(result["rows"]), 1)
            self.assertEqual(result["rows"][0]["physical_qty"], 143)
        with TestClient(self.app) as resumed:
            row = next(row for row in resumed.get(path).json()["rows"] if row["product_id"] == self.product.id)
            self.assertEqual(row["counts"], counts)
            self.assertEqual(row["counted_by_id"], self.user.id)
            self.assertIsNotNone(row["counted_at"])
        scanned = self.call(path + "/scan", "POST", {"code": "PACK24", "focus_only": True})
        self.assertEqual(scanned["scan_match"], {"product_id": self.product.id, "key": str(pack.id), "already_counted": True})
        self.assertEqual(scanned["rows"][0]["physical_qty"], 143)
        variant = self.call(path + "/scan", "POST", {"code": "pack24", "focus_only": True})
        self.assertEqual(variant["scan_match"]["key"], str(pack.id))
        self.assertIn("PACK24", variant["rows"][0]["barcodes"])
        self.sell([{"quantity": 2}])
        result = self.call(path + "/validate", "POST", {})
        self.assertEqual(self.quantity(self.product), 141)
        self.assertEqual(result["stats"]["not_counted"], 2)
        with self.sessions() as db:
            self.assertEqual(db.query(InventoryCount).filter_by(session_id=session["id"], product_id=self.product.id).count(), 1)
            move = db.query(StockMovement).filter_by(kind="inventaire").one()
            self.assertEqual(move.quantity, -7)
            self.assertIn("10 carton ×12", move.reason)
            self.assertIn("3 Colis ×6", move.reason)
            self.assertIn(session["reference"], move.reason)
            self.assertIn("Rayon terminé", move.reason)

    def test_mass_empty_zero_and_invalid_counts(self):
        session = self.session()
        path = f"/api/inventory/sessions/{session['id']}"
        endpoint = path + f"/counts/{self.product.id}"
        for counts in ({}, {"primary": None, "base": None}):
            result = self.call(endpoint, "PUT", {"counts": counts})
            self.assertEqual(result["stats"]["counted"], 0)
            self.assertIsNone(result["rows"][0]["counted_at"])
        result = self.call(endpoint, "PUT", {"counts": {"base": 0}})
        self.assertEqual(result["stats"]["counted"], 1)
        self.assertEqual(result["rows"][0]["physical_qty"], 0)
        for counts, status in [({"unknown": 1}, 400), ({"base": -1}, 422), ({"base": 1.5}, 422), ({"primary": 2147483647}, 400), ({"base": True}, 422)]:
            self.call(endpoint, "PUT", {"counts": counts}, status)
        self.assertEqual(self.call(path)["rows"][0]["physical_qty"], 0)
        self.call(path + "/validate", "POST", {})
        self.assertEqual(self.quantity(self.third), 7)

    def test_offline_upsert_is_idempotent_and_last_timestamp_wins(self):
        session = self.session()
        path = f"/api/inventory/sessions/{session['id']}/counts/{self.product.id}"
        first = {"counts": {"base": 8}, "client_id": "warehouse-a", "client_updated_at": "2026-01-01T12:00:00Z"}
        saved = self.call(path, "PUT", first)["rows"][0]
        repeated = self.call(path, "PUT", {**first, "counts": {"base": 99}})["rows"][0]
        self.assertEqual(saved, repeated)
        newer = {**first, "client_id": "warehouse-b", "client_updated_at": "2026-01-01T12:00:01Z", "counts": {"base": 0}}
        self.assertEqual(self.call(path, "PUT", newer)["rows"][0]["physical_qty"], 0)
        self.assertEqual(self.call(path, "PUT", first)["rows"][0]["physical_qty"], 0)
        self.call(path, "PUT", {"counts": {"base": 2}, "client_id": "missing-date"}, 422)
        self.call(path, "PUT", {**first, "client_updated_at": "2026-01-01T12:00:00"}, 422)
        with self.sessions() as db:
            self.assertEqual(db.query(InventoryCount).filter_by(session_id=session["id"], product_id=self.product.id).count(), 1)
            self.assertEqual(db.query(StockMovement).filter_by(kind="inventaire").count(), 0)

    def test_mass_excel_grid_roundtrip_empty_zero_and_errors(self):
        session = self.session()
        path = f"/api/inventory/sessions/{session['id']}"
        self.call(path + f"/counts/{self.product.id}", "PUT", {"counts": {"primary": 2, "base": 5}})
        self.call(path + f"/counts/{self.second.id}", "PUT", {"counts": {"base": 0}})
        grid = self.call(path + "/grid-export")
        self.assertEqual(grid["headers"][:4], ["Référence", "Désignation", "Catégorie", "Stock théorique"])
        self.assertEqual(grid["rows"][1][-1], 0)
        self.assertEqual(grid["rows"][2][-1], "")
        matrix = [grid["headers"], *grid["rows"]]
        xml = '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table>' + ''.join('<Row>' + ''.join(f'<Cell><Data ss:Type="String">{escape(str(value))}</Data></Cell>' for value in row) + '</Row>' for row in matrix) + '</Table></Worksheet></Workbook>'
        target = self.session()
        imported = self.client.post(f"/api/inventory/sessions/{target['id']}/grid-import", files={"file": ("grille.xls", xml.encode(), "application/vnd.ms-excel")})
        self.assertEqual(imported.status_code, 200, imported.text)
        result = imported.json()
        self.assertEqual(result["errors"], [])
        self.assertEqual([row["physical_qty"] for row in result["report"]["rows"]], [53, 0, None])
        self.assertEqual(self.call(f"/api/inventory/sessions/{target['id']}/grid-export"), grid)
        bad = list(grid["rows"][0]); bad[4] = "Inconnu"
        stream = io.StringIO(); writer = csv.writer(stream); writer.writerows([grid["headers"], ["UNKNOWN"], bad])
        response = self.client.post(path + "/grid-import", files={"file": ("erreurs.csv", stream.getvalue().encode(), "text/csv")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["errors"]), 2)
        self.assertEqual(response.json()["updated"], 0)

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

    def test_old_inventory_count_migrates_without_losing_count(self):
        engine = create_engine("sqlite:///:memory:")
        self.addCleanup(engine.dispose)
        ddl = str(CreateTable(InventoryCount.__table__).compile(engine))
        ddl = "\n".join(line for line in ddl.splitlines() if not line.strip().startswith(("counts_json ", "client_updated_at ", "client_id ")))
        with engine.begin() as conn:
            conn.execute(text(ddl))
        Base.metadata.create_all(engine)
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO inventory_counts (id,session_id,product_id,product_snapshot,theoretical_qty,physical_qty,unit_cost,note) VALUES (1,1,1,'{}',12,10,5,'ancien')"))
        with patch.object(migration, "engine", engine):
            migration.migrate()
            migration.migrate()
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT physical_qty, counts_json, note FROM inventory_counts")).one(), (10, "{}", "ancien"))
