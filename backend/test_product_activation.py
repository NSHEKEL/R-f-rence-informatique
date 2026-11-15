import unittest

import test_wholesale as wholesale
from app import stock
from app.models import Product, Sale, SaleItem
from app.routers import deliveries, orders, proformas


class ProductActivationTests(unittest.TestCase):
    call = wholesale.WholesaleTests.call
    sell = wholesale.WholesaleTests.sell
    grant = wholesale.WholesaleTests.grant
    open = wholesale.WholesaleTests.open
    stock = wholesale.WholesaleTests.stock

    def setUp(self):
        wholesale.WholesaleTests.setUp(self)
        for router in (orders.router, deliveries.router, proformas.router):
            self.app.include_router(router)

    def activate(self, active, status=200):
        return self.call(f"/api/products/{self.product.id}/activation", "PUT", {"active": active}, status)

    def test_deactivation_hides_every_code_and_blocks_new_documents_without_losing_history(self):
        payload = self.call(f"/api/products/{self.product.id}")
        self.call(f"/api/products/{self.product.id}", "PUT", {**payload, "barcode": "1234567890123", "qr_code": "QR-CODE",
            "barcodes": [{"code": "ALIAS", "label": "Rouge"}],
            "packagings": [{"name": "Colis", "factor": 12, "barcode": "PACK-CODE"}]})
        sale_payload = {"client_id": "before-deactivation", "items": [{"product_id": self.product.id, "quantity": 3}]}
        sale = self.call("/api/sales", "POST", sale_payload, 201)
        order = self.call("/api/orders", "POST", {"customer_name": "Client", "items": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        delivery = self.call("/api/delivery-notes", "POST", {"customer_name": "Client", "items": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        proforma = self.call("/api/proformas", "POST", {"customer_name": "Client", "items": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        before = self.stock()
        self.assertFalse(self.activate(False)["active"])
        self.assertFalse(self.activate(False)["active"])
        self.assertEqual(self.stock(), before)
        self.assertEqual(self.call("/api/products"), [])
        self.assertEqual(self.call("/api/products/pos"), [])
        self.assertEqual(self.call("/api/products/best-sellers"), [])
        self.assertEqual([row["id"] for row in self.call("/api/products?state=inactive")], [self.product.id])
        self.assertEqual(len(self.call("/api/products?state=all")), 1)
        for code in (self.product.sku, "1234567890123", "QR-CODE", "ALIAS", "PACK-CODE"):
            self.call(f"/api/products/by-code/{code}", status=404)
        error = self.sell([{"quantity": 1}], status=400)
        self.assertIn("désactivé", error["detail"])
        items = [{"product_id": self.product.id, "quantity": 1}]
        for path, data in (
            ("/api/purchases", {"supplier_name": "Grossiste", "items": items}),
            ("/api/orders", {"customer_name": "Client", "items": items}),
            ("/api/delivery-notes", {"customer_name": "Client", "items": items}),
            (f"/api/orders/{order['id']}/duplicate", {}),
            (f"/api/orders/{order['id']}/deliver", {}),
            (f"/api/delivery-notes/{delivery['id']}/validate", {}),
            (f"/api/proformas/{proforma['id']}/transformer", {"target": "commande"}),
        ):
            with self.subTest(path=path):
                self.assertIn("désactivé", self.call(path, "POST", data, 400)["detail"])
        self.assertEqual(self.stock(), before)
        self.assertEqual(self.call("/api/sales", "POST", sale_payload, 201)["id"], sale["id"])
        self.assertEqual(self.call(f"/api/sales/{sale['id']}")["items"], sale["items"])
        self.call("/api/returns", "POST", {"sale_reference": sale["reference"], "lines": [{
            "product_id": self.product.id, "sale_item_id": sale["items"][0]["id"], "quantity": 1}]}, 201)
        self.assertEqual(self.stock(), 198)
        self.assertEqual(self.db.query(SaleItem).count(), 1)
        self.assertEqual(self.db.query(Sale).count(), 1)
        self.call(f"/api/sales/{sale['id']}", "DELETE", status=204)
        self.assertEqual(self.stock(), 200)
        self.db.expire_all()
        self.assertFalse(self.db.get(Product, self.product.id).active)
        self.assertEqual(stock.inconsistencies(self.db), [])
        self.assertTrue(self.activate(True)["active"])
        self.assertEqual(self.call("/api/products/by-code/ALIAS")["id"], self.product.id)
        self.assertEqual(len(self.call("/api/products/pos")), 1)
        self.assertEqual(self.call("/api/products?state=inactive"), [])
        self.sell([{"quantity": 1}])
        self.call("/api/purchases", "POST", {"supplier_name": "Grossiste", "items": [{"product_id": self.product.id, "quantity": 1}]}, 201)
        self.call("/api/orders", "POST", {"customer_name": "Client", "items": items}, 201)

    def test_permission_validation_and_legacy_product_edits_cannot_reactivate(self):
        self.user.role = "vendeur"
        self.grant("vente_nouvelle")
        self.activate(False, 403)
        self.call(f"/api/products/{self.product.id}", "DELETE", status=403)
        self.call("/api/products?state=all", status=403)
        self.assertTrue(self.db.get(Product, self.product.id).active)
        self.grant("produits_gerer", "produits")
        self.activate(False)
        self.call("/api/products/999999/activation", "PUT", {"active": False}, 404)
        self.call(f"/api/products/{self.product.id}/activation", "PUT", {}, 422)
        self.call("/api/products?state=unknown", status=422)
        payload = self.call(f"/api/products/{self.product.id}")
        payload.pop("active")
        edited = self.call(f"/api/products/{self.product.id}", "PUT", {**payload, "name": "Nouveau nom"})
        self.assertFalse(edited["active"])
        self.assertEqual(edited["name"], "Nouveau nom")
        self.activate(True)

    def test_legacy_delete_endpoint_deactivates_instead_of_erasing_product_or_stock(self):
        sale = self.sell([{"quantity": 1}])
        self.call(f"/api/products/{self.product.id}", "DELETE", status=204)
        self.db.expire_all()
        self.assertFalse(self.db.get(Product, self.product.id).active)
        self.assertEqual(self.stock(), 199)
        self.assertEqual(self.call(f"/api/sales/{sale['id']}")["items"], sale["items"])
        self.assertEqual(stock.inconsistencies(self.db), [])
