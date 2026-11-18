import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select

from app import backup, migrate
from app.models import AppMigration, CompanySettings, ProductPackaging, Sale, SaleItem
import test_product_packagings as packs


class PackagingPriceSyncTests(unittest.TestCase):
    setUp = packs.ProductPackagingsTests.setUp
    call = packs.ProductPackagingsTests.call
    sell = packs.ProductPackagingsTests.sell
    stock = packs.ProductPackagingsTests.stock
    open = packs.ProductPackagingsTests.open
    grant = packs.ProductPackagingsTests.grant
    balances = packs.ProductPackagingsTests.balances
    update = packs.ProductPackagingsTests.update

    def test_save_and_import_sync_positive_gros_only(self):
        result = self.update(packagings=[{"name": "Carton", "factor": 6, "price_detail": 9000, "price_gros": 6000}])
        row = result["packagings"][0]
        self.assertEqual(row["price_detail"], 6000)
        row = self.update(packagings=[{**row, "price_detail": 7000, "price_gros": 0}])["packagings"][0]
        self.assertEqual(row["price_detail"], 7000)
        csv = f"reference;nom;conditionnement_1;facteur_1;prix_gros_conditionnement_1\n{self.product.sku};Test;Carton;6;8000\n"
        response = self.client.post("/api/products/import", files={"file": ("prix.csv", csv.encode(), "text/csv")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(response.json().get("errors"), response.text)
        imported = self.call(f"/api/products/{self.product.id}")["packagings"][0]
        self.assertEqual((imported["price_detail"], imported["price_gros"]), (8000, 8000))

    def test_migration_changes_only_retail_and_is_backed_up_idempotent(self):
        positive = ProductPackaging(product_id=self.product.id, name="Carton", factor=6, price_detail=9000, price_gros=6000, purchase_price=3000)
        zero = ProductPackaging(product_id=self.product.id, name="Sac", factor=2, price_detail=900, price_gros=0)
        self.db.add_all([positive, zero]); self.db.commit()
        sale = self.sell([{"quantity": 1}])
        self.db.expire_all()
        def rows(model):
            return [dict(row) for row in self.db.execute(select(model.__table__)).mappings()]
        before = rows(ProductPackaging)
        sales, items = rows(Sale), rows(SaleItem)
        product_before = dict(self.call(f"/api/products/{self.product.id}"))
        binding = self.db.get_bind()
        real_backup = backup.create
        def backed_up(*args, **kwargs):
            self.assertEqual(rows(ProductPackaging), before)
            self.assertEqual(kwargs["reason"], "migration-packaging-retail-v1")
            path = real_backup(*args, **kwargs)
            with zipfile.ZipFile(path) as archive:
                self.assertIsNone(archive.testzip())
                self.assertIn("easygest.db", archive.namelist())
            return path
        with patch.object(migrate, "engine", binding), patch.object(backup, "engine", binding), patch.object(backup, "IS_SQLITE", True), patch.object(backup, "backups_dir", return_value=Path(self.temp.name)), patch.object(backup, "create", side_effect=backed_up) as saved:
            migrate._packaging_retail_from_wholesale()
            migrate._packaging_retail_from_wholesale()
            saved.assert_called_once()
        self.db.expire_all()
        expected = [{**row, "price_detail": row["price_gros"]} if row["price_gros"] and row["price_gros"] > 0 else row for row in before]
        self.assertEqual(rows(ProductPackaging), expected)
        self.assertEqual(rows(Sale), sales); self.assertEqual(rows(SaleItem), items)
        after = self.call(f"/api/products/{self.product.id}")
        self.assertEqual({key: value for key, value in after.items() if key != "packagings"}, {key: value for key, value in product_before.items() if key != "packagings"})
        self.assertIsNotNone(self.db.get(AppMigration, "packaging_retail_from_wholesale_v1"))
        self.assertEqual(sale["items"], self.call(f"/api/sales/{sale['id']}")["items"])

    def test_failed_backup_leaves_prices_and_marker_untouched(self):
        self.db.add(ProductPackaging(product_id=self.product.id, name="Carton", factor=6, price_detail=9000, price_gros=6000)); self.db.commit()
        with patch.object(migrate, "engine", self.db.get_bind()), patch.object(backup, "create", side_effect=OSError("Backup indisponible")):
            with self.assertLogs("app.migrate", level="ERROR"):
                migrate._packaging_retail_from_wholesale()
        self.db.expire_all()
        self.assertEqual(self.db.query(ProductPackaging).one().price_detail, 9000)
        self.assertIsNone(self.db.get(AppMigration, "packaging_retail_from_wholesale_v1"))

    def test_unavailable_mirror_does_not_block_verified_local_backup_or_migration(self):
        self.db.add(ProductPackaging(product_id=self.product.id, name="Carton", factor=6, price_detail=9000, price_gros=6000))
        settings = self.db.query(CompanySettings).first()
        if settings is None:
            settings = CompanySettings(name="Boutique")
            self.db.add(settings)
        settings.backup_dir = str(Path(self.temp.name) / "miroir")
        self.db.commit()
        binding = self.db.get_bind()
        directory = Path(self.temp.name) / "backups"
        directory.mkdir()
        with patch.object(migrate, "engine", binding), patch.object(backup, "engine", binding), patch.object(backup, "IS_SQLITE", True), patch.object(backup, "backups_dir", return_value=directory), patch.object(backup.shutil, "copy2", side_effect=OSError("Miroir déconnecté")):
            with self.assertLogs("app.backup", level="WARNING") as logged:
                migrate._packaging_retail_from_wholesale()
            self.assertIn("Miroir déconnecté", " ".join(logged.output))
            archives = list(directory.glob("*"))
            self.assertEqual(len(archives), 1)
            backup.inspect_backup(archives[0].read_bytes())
        self.db.expire_all()
        self.assertEqual(self.db.query(ProductPackaging).one().price_detail, 6000)
        self.assertIsNotNone(self.db.get(AppMigration, "packaging_retail_from_wholesale_v1"))
