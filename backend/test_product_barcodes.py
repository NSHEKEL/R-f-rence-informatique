import unittest

import test_wholesale as wholesale
from app import stock
from app.models import ProductBarcode


class ProductBarcodeTests(unittest.TestCase):
    setUp = wholesale.WholesaleTests.setUp
    call = wholesale.WholesaleTests.call
    sell = wholesale.WholesaleTests.sell
    open = wholesale.WholesaleTests.open
    grant = wholesale.WholesaleTests.grant

    def update(self, **values):
        product = self.call(f"/api/products/{self.product.id}")
        return self.call(f"/api/products/{self.product.id}", "PUT", {**product, **values})

    def test_variant_lookup_stock_snapshots_and_deactivation(self):
        product = self.update(barcodes=[{"code": "NOVA-RED", "label": "NOVA Rouge"}, {"code": "NOVA-BLUE", "label": "NOVA Bleu"}])
        self.assertEqual(len(product["barcodes"]), 2)
        lookup = self.call("/api/products/by-code/nova-red")
        self.assertEqual((lookup["id"], lookup["scanned_label"]), (self.product.id, "NOVA Rouge"))
        sale = self.sell([{"quantity": 2, "scanned_code": "NOVA-RED"}, {"quantity": 3, "scanned_code": "NOVA-BLUE"}])
        self.assertEqual([line["scanned_label"] for line in sale["items"]], ["NOVA Rouge", "NOVA Bleu"])
        with self.sessions() as db:
            self.assertEqual(stock.inconsistencies(db), [])
            self.assertEqual(stock.quantity(db, self.product.id), 195)
            alias = db.query(ProductBarcode).filter_by(code="NOVA-RED").one()
            self.assertEqual(alias.created_by_id, self.user.id)
            self.assertIsNotNone(alias.created_at)
        self.update(barcodes=[])
        self.call("/api/products/by-code/NOVA-RED", status=404)
        self.assertEqual(self.call(f"/api/sales/{sale['id']}")["items"], sale["items"])
        self.assertEqual(self.call(f"/api/products/{self.product.id}")["barcodes"][0]["active"], False)
        self.call("/api/products", "POST", {"name": "Autre", "sku": "NOVA-RED"}, 400)

    def test_uniqueness_all_code_namespaces_same_product_allowed_and_rollback(self):
        self.update(qr_code="QR-ONLY", barcodes=[{"code": "VAR-ONLY", "label": "Variante"}], packagings=[{"name": "Colis", "factor": 6, "barcode": "PACK-ONLY"}])
        for code in (self.product.sku, "QR-ONLY", "VAR-ONLY", "PACK-ONLY"):
            for field in ("sku", "qr_code"):
                self.call("/api/products", "POST", {"name": "Collision", "sku": "OTHER", field: code.lower()}, 400)
            self.call("/api/products", "POST", {"name": "Collision", "sku": "OTHER", "barcodes": [{"code": code.lower()}]}, 400)
            self.call("/api/products", "POST", {"name": "Collision", "sku": "OTHER", "packagings": [{"name": "Boîte", "factor": 2, "barcode": code.lower()}]}, 400)
        self.update(barcodes=[{"code": self.product.sku, "label": "Même fiche"}])
        self.assertEqual(self.call(f"/api/products/by-code/{self.product.sku}")["id"], self.product.id)
        other = self.call("/api/products", "POST", {"name": "Autre", "sku": "OTHER-OK", "barcodes": [{"code": "FOREIGN"}]}, 201)
        self.assertNotEqual(other["id"], self.product.id)
        self.sell([{"quantity": 1}, {"quantity": 1, "scanned_code": "FOREIGN"}], status=400)
        with self.sessions() as db:
            self.assertEqual(stock.quantity(db, self.product.id), 200)
            self.assertEqual(stock.inconsistencies(db), [])
        self.update(barcodes=[])
        self.sell([{"quantity": 1}])

    def test_empty_duplicate_missing_codes_and_permissions(self):
        self.call("/api/products/by-code/UNKNOWN", status=404)
        product = self.call(f"/api/products/{self.product.id}")
        for codes, status in (([{"code": " "}], 400), ([{"code": "ABC"}, {"code": "abc"}], 400), ([{"id": 9999, "code": "ABC"}], 400)):
            self.call(f"/api/products/{self.product.id}", "PUT", {**product, "barcodes": codes}, status)
        self.assertEqual(self.call(f"/api/products/{self.product.id}")["barcodes"], [])
        self.user.role = "vendeur"
        self.call(f"/api/products/{self.product.id}", "PUT", {**product, "barcodes": [{"code": "DENIED"}]}, 403)

    def test_csv_extra_codes_append_and_collision_rolls_back_the_row(self):
        data = "sku;nom;extra_codes\nCSV-NEW;Variante;CSV-RED|CSV-BLUE\n"
        response = self.client.post("/api/products/import", files={"file": ("codes.csv", data.encode(), "text/csv")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"created": 1, "updated": 0, "errors": []})
        red = self.call("/api/products/by-code/CSV-RED")
        self.assertEqual(red["id"], self.call("/api/products/by-code/CSV-BLUE")["id"])
        data = "sku;nom;extra_codes\nCSV-COLLISION;Conflit;CSV-RED\n"
        response = self.client.post("/api/products/import", files={"file": ("codes.csv", data.encode(), "text/csv")})
        self.assertEqual(response.json()["created"], 0)
        self.assertEqual(len(response.json()["errors"]), 1)
        self.call("/api/products/by-code/CSV-COLLISION", status=404)
