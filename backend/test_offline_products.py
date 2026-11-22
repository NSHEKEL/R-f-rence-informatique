import unittest

import test_wholesale as wholesale
from app import stock
from app.models import Category, ChangeLog, CompanySettings, PriceHistory, Product, ProductPackaging, ProductUpdateOperation, StockLot, StockMovement, Workstation
from app.database import SessionLocal
from app.routers import sync


class OfflineProductTests(unittest.TestCase):
    setUp = wholesale.WholesaleTests.setUp
    call = wholesale.WholesaleTests.call
    open = wholesale.WholesaleTests.open
    grant = wholesale.WholesaleTests.grant

    def test_catalogue_revision_ignores_heartbeats_but_keeps_product_stock_and_price_changes(self):
        with SessionLocal(bind=self.engine) as db:
            self.assertEqual(sync.get_version(db, self.user, scope="catalogue").version, 0)
            db.add(Workstation(ip="192.168.50.9", hostname="Poste"))
            db.commit()
            self.assertEqual(db.query(ChangeLog).count(), 0)
            product = db.get(Product, self.product.id)
            for field, value in (("sale_price", 125), ("quantity", 17), ("name", "Corrigé")):
                previous = sync.get_version(db, self.user, scope="catalogue").version
                setattr(product, field, value)
                db.commit()
                self.assertGreater(sync.get_version(db, self.user, scope="catalogue").version, previous)
            previous = sync.get_version(db, self.user, scope="catalogue").version
            db.add(ChangeLog(entities="workstations"))
            db.add(CompanySettings(name="Identité seulement"))
            db.commit()
            self.assertEqual(sync.get_version(db, self.user, scope="catalogue").version, previous)
            self.assertGreater(sync.get_version(db, self.user).version, previous)

    def test_catalogue_delta_has_created_ids_and_falls_back_for_metadata_or_legacy_changes(self):
        with SessionLocal(bind=self.engine) as db:
            product = db.get(Product, self.product.id)
            product.sale_price = 110
            db.commit()
            cursor = sync.get_version(db, self.user, scope="catalogue").version
            db.add(ProductPackaging(product_id=product.id, name="Carton", factor=12))
            created = Product(name="Créé", sku="DELTA-CREATED", quantity=1)
            db.add(created)
            db.commit()
            delta = sync.get_version(db, self.user, scope="catalogue", since=cursor)
            self.assertEqual(delta.product_ids, sorted([product.id, created.id]))
            self.assertEqual(sync.get_version(db, self.user, scope="catalogue", since=delta.version).product_ids, [])
            db.add(Category(name="Nouvelle catégorie"))
            db.commit()
            self.assertIsNone(sync.get_version(db, self.user, scope="catalogue", since=delta.version).product_ids)
            db.add(ChangeLog(entities="products", product_ids="invalid JSON"))
            db.commit()
            self.assertIsNone(sync.get_version(db, self.user, scope="catalogue", since=delta.version).product_ids)
        full = self.call("/api/products")
        for product in full:
            self.assertEqual(self.call(f"/api/products?ids={product['id']}&state=active"), [product])
        self.assertEqual(self.call("/api/products?ids=999999"), [])
        self.call("/api/products?ids=invalid", status=422)

    def test_offline_update_is_partial_atomic_and_idempotent(self):
        payload = {"operation_id": "10a370fd-b127-4dc0-899f-fc065b211001", "changes": {"sale_price": 120}, "originals": {"sale_price": 100}}
        path = f"/api/products/{self.product.id}/offline-update"
        result = self.call(path, "POST", payload)
        self.assertEqual((result["sale_price"], result["quantity"]), (120, 200))
        with self.sessions() as db:
            db.query(Product).filter_by(id=self.product.id).update({"sale_price": 140, "name": "Autre poste"})
            db.commit()
        replay = self.call(path, "POST", payload)
        self.assertEqual((replay["sale_price"], replay["name"]), (140, "Autre poste"))
        with self.sessions() as db:
            self.assertEqual(db.query(ProductUpdateOperation).count(), 1)
            history = db.query(PriceHistory).filter_by(product_id=self.product.id, field="sale_price").all()
            self.assertEqual([(row.old_value, row.new_value) for row in history], [(100, 120)])
            self.assertEqual(db.query(StockMovement).filter_by(product_id=self.product.id).count(), 0)
        self.call(path, "POST", {**payload, "changes": {"sale_price": 999}}, 409)

    def test_offline_update_conflict_force_invalid_and_permissions(self):
        path = f"/api/products/{self.product.id}/offline-update"
        payload = {"operation_id": "10a370fd-b127-4dc0-899f-fc065b211002", "changes": {"sale_price": 120}, "originals": {"sale_price": 80}}
        refused = self.call(path, "POST", payload, 409)
        self.assertIn("sale_price", refused["detail"])
        with self.sessions() as db:
            self.assertEqual(db.get(Product, self.product.id).sale_price, 100)
            self.assertEqual(db.query(ProductUpdateOperation).count(), 0)
        for invalid in ({"changes": {}}, {"originals": {}}, {"changes": {"active": False}, "originals": {"active": True}}, {"changes": {"semi_wholesale_price": -1}, "originals": {"semi_wholesale_price": None}}):
            self.call(path, "POST", {**payload, **invalid}, 422)
        result = self.call(path, "POST", {**payload, "force": True})
        self.assertEqual(result["sale_price"], 120)
        self.user.role = "vendeur"
        self.call(path, "POST", {**payload, "force": True}, 403)

    def test_same_uuid_creates_one_product_one_initial_movement_and_lot(self):
        payload = {"name": "Article hors ligne", "sku": "OFFLINE-ONE", "client_uuid": "10a370fd-b127-4dc0-899f-fc065b211000",
                   "quantity": 7, "purchase_price": 10, "initial_expiry_date": "2030-12-31",
                   "barcodes": [{"code": "OFF-VARIANT"}], "packagings": [{"name": "Carton", "factor": 6}]}
        first = self.call("/api/products", "POST", payload, 201)
        second = self.call("/api/products", "POST", {**payload, "quantity": 99}, 201)
        self.assertEqual((first["id"], first["quantity"]), (second["id"], 7))
        with self.sessions() as db:
            self.assertEqual(db.query(Product).filter_by(client_uuid=payload["client_uuid"]).count(), 1)
            movements = db.query(StockMovement).filter_by(product_id=first["id"]).all()
            self.assertEqual(len(movements), 1)
            self.assertEqual((movements[0].quantity, movements[0].stock_before, movements[0].stock_after), (7, 0, 7))
            self.assertEqual(movements[0].created_by_id, self.user.id)
            self.assertIsNotNone(movements[0].depot_id)
            self.assertEqual(db.query(StockLot).filter_by(product_id=first["id"]).one().quantity, 7)
            self.assertEqual(stock.inconsistencies(db), [])
        self.assertEqual(second["barcodes"][0]["code"], "OFF-VARIANT")
        self.assertEqual(second["packagings"][0]["factor"], 6)

    def test_conflicting_sku_or_barcode_does_not_create_and_can_be_corrected(self):
        for fields in ({"sku": self.product.sku}, {"barcodes": [{"code": self.product.sku}]}):
            payload = {"name": "Conflit", "sku": "OFF-CONFLICT", "quantity": 2, "client_uuid": "offline-conflict", **fields}
            self.call("/api/products", "POST", payload, 400)
            with self.sessions() as db:
                self.assertIsNone(db.query(Product).filter_by(client_uuid="offline-conflict").first())
        self.call("/api/products", "POST", {"name": "Corrigé", "sku": "OFF-CORRECT", "client_uuid": "offline-conflict", "quantity": 2}, 201)

    def test_empty_uuid_invalid_stock_and_permission_are_rejected(self):
        for fields, status in (({"client_uuid": ""}, 422), ({"quantity": -1}, 400), ({"quantity": 2147483648}, 400)):
            self.call("/api/products", "POST", {"name": "Invalide", "sku": "OFF-INVALID", "client_uuid": "offline-invalid", **fields}, status)
        self.user.role = "vendeur"
        self.call("/api/products", "POST", {"name": "Interdit", "sku": "OFF-DENIED", "client_uuid": "offline-denied"}, 403)

    def test_zero_initial_stock_and_legacy_payload_remain_supported(self):
        product = self.call("/api/products", "POST", {"name": "Zéro", "sku": "OFF-ZERO", "client_uuid": "offline-zero"}, 201)
        self.call("/api/products", "POST", {"name": "Zéro", "sku": "OFF-ZERO", "client_uuid": "offline-zero"}, 201)
        with self.sessions() as db:
            self.assertEqual(db.query(StockMovement).filter_by(product_id=product["id"]).count(), 0)
        legacy = self.call("/api/products", "POST", {"name": "Ancien payload", "sku": "OFF-LEGACY", "quantity": 3}, 201)
        self.assertEqual(legacy["quantity"], 3)
        self.assertIsNone(legacy["client_uuid"])


if __name__ == "__main__":
    unittest.main()
