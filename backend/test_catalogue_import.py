import io
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

import test_wholesale as wholesale
from app.models import Category, PriceHistory, Product, ProductPackaging, StockMovement


class CatalogueImportTests(unittest.TestCase):
    setUp = wholesale.WholesaleTests.setUp
    call = wholesale.WholesaleTests.call
    open = wholesale.WholesaleTests.open

    def upload(self, filename, body, status=200):
        response = self.client.post("/api/products/import", files={"file": (filename, body)})
        self.assertEqual(response.status_code, status, response.text)
        return response.json()

    def test_easygest_spreadsheetml_export_round_trip_updates_without_duplicates(self):
        self.product.barcode = "1234567890123"
        self.db.commit()
        other = self.call("/api/products", "POST", {"name": "Savon & soin", "sku": "SAVON", "sale_price": 250, "purchase_price": 100}, 201)
        headers = ["Nom", "Référence", "Catégorie", "Fournisseur", "Prix d'achat", "Prix de vente", "Prix de gros", "Stock", "Stock minimum", "Code-barres", "Quantité et équivalence"]
        rows = [[self.product.name, self.product.sku, "Épicerie", "Grossiste", 45, 110, 85, 200, 7, self.product.barcode, "8 cartons + 8 pièces"],
                [other["name"], other["sku"], "", "Autre fournisseur", 100, 250, 200, 0, 5, "", "0"]]
        def cell(value):
            kind = "Number" if isinstance(value, (float, int)) else "String"
            return f'<Cell><Data ss:Type="{kind}">{escape(str(value))}</Data></Cell>'
        # Same SpreadsheetML worksheet and typed cells as exportCsv.ts.
        body = ('<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'
                '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
                '<Worksheet ss:Name="Export"><Table>' + "".join("<Row>" + "".join(cell(v) for v in row) + "</Row>" for row in [headers, *rows]) + "</Table></Worksheet></Workbook>").encode()
        for _ in range(2):
            result = self.upload("produits.xls", body)
            self.assertEqual(result, {"created": 0, "updated": 2, "errors": [], "duplicates": []})
            self.assertEqual(self.db.query(Product).count(), 2)
        self.db.refresh(self.product)
        self.assertEqual(self.product.barcode, "1234567890123")
        self.assertEqual((self.product.purchase_price, self.product.sale_price, self.product.wholesale_price, self.product.min_stock), (45, 110, 85, 7))
        self.assertEqual(self.product.category.name, "Épicerie")

    def test_accented_semicolon_csv_and_typographic_apostrophe(self):
        body = f"Référence;Désignation;Prix d’achat;Prix-de-vente;Stock minimum;Code-barres;Quantité et équivalence;Fournisseur\n{self.product.sku};Riz;45,5;125,75;8;12345678;ignoré;ignoré\n"
        self.assertEqual(self.upload("produits.csv", body.encode("utf-8-sig")), {"created": 0, "updated": 1, "errors": [], "duplicates": []})
        self.db.refresh(self.product)
        self.assertEqual((self.product.name, self.product.purchase_price, self.product.sale_price, self.product.min_stock, self.product.barcode), ("Riz", 45.5, 125.75, 8, "12345678"))

    def test_xlsx_shared_inline_numeric_sparse_cells_and_first_sheet(self):
        archive = io.BytesIO()
        with ZipFile(archive, "w") as book:
            book.writestr("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Articles" sheetId="8" r:id="r8"/><sheet name="Ignorée" sheetId="1" r:id="r1"/></sheets></workbook>')
            book.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r8" Target="/xl/worksheets/sheet8.xml"/><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>')
            strings = ["Référence", "Désignation", "Prix d'achat", "Prix de vente", self.product.sku]
            book.writestr("xl/sharedStrings.xml", "<sst>" + "".join(f"<si><t>{escape(s)}</t></si>" for s in strings) + "</sst>")
            book.writestr("xl/worksheets/sheet8.xml", '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c><c r="E1" t="s"><v>3</v></c></row><row><c r="A2" t="s"><v>4</v></c><c r="B2" t="inlineStr"><is><r><t>Riz </t></r><r><t>local</t></r></is></c><c r="D2"><v>32.5</v></c><c r="E2"><v>150</v></c></row></sheetData></worksheet>')
            book.writestr("xl/worksheets/sheet1.xml", "not a worksheet")
        self.assertEqual(self.upload("produits.xlsx", archive.getvalue()), {"created": 0, "updated": 1, "errors": [], "duplicates": []})
        self.db.refresh(self.product)
        self.assertEqual((self.product.name, self.product.purchase_price, self.product.sale_price), ("Riz local", 32.5, 150))
        self.assertEqual(self.product.quantity, 200)

    def test_empty_unknown_corrupt_and_binary_files_report_actionable_errors(self):
        for filename, body, expected in (("empty.csv", b"", "vide"), ("wrong.csv", b"Autre;Colonne\n1;2", "Colonnes attendues"),
                                         ("old.xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", ".xlsx ou .csv"),
                                         ("broken.xlsx", b"PK broken", "illisible"), ("broken.xls", b"<Workbook>", "illisible")):
            with self.subTest(filename=filename):
                self.assertIn(expected, self.upload(filename, body, 400)["detail"])
        self.assertEqual(self.db.query(Product).count(), 1)

    def test_csv_can_create_and_still_reports_invalid_row_without_losing_good_rows(self):
        result = self.upload("new.csv", "Référence;Nom;Code-barres\nNEW;Nouveau;87654321\nBAD;Invalide;ABC\n".encode())
        self.assertEqual((result["created"], result["updated"], len(result["errors"])), (1, 0, 1))
        self.assertIsNotNone(self.db.query(Product).filter_by(sku="NEW").one())
        self.assertIsNone(self.db.query(Product).filter_by(sku="BAD").first())

    def test_preexisting_name_is_skipped_with_original_file_reference_or_no_sku(self):
        self.product.name = "Riz local"
        self.db.commit()
        body = "Référence;Nom;Catégorie;Prix achat\nOTHER;Riz local;Ne pas créer;999\n;Riz local;Ne pas créer;888\n"
        result = self.upload("duplicates.csv", body.encode())
        self.assertEqual(result, {"created": 0, "updated": 0, "errors": [], "duplicates": [
            {"line": line, "name": "Riz local", "sku": sku, "existing": {"id": self.product.id, "name": "Riz local", "sku": self.product.sku}}
            for line, sku in ((2, "OTHER"), (3, ""))]})
        self.db.refresh(self.product)
        self.assertEqual(self.product.purchase_price, 40)
        self.assertEqual(self.db.query(Product).count(), 1)
        self.assertEqual(self.db.query(Category).count(), 0)

    def test_inactive_accent_case_and_whitespace_variant_is_detected(self):
        self.product.name = "Crème   Brûlée"
        self.product.active = False
        self.db.commit()
        result = self.upload("duplicates.csv", "Référence;Nom\nNEW;  CREME  bru\u0302le\u0301e  \n".encode())
        self.assertEqual((result["created"], result["updated"], result["errors"]), (0, 0, []))
        self.assertEqual(result["duplicates"], [{"line": 2, "name": "CREME  bru\u0302le\u0301e", "sku": "NEW", "existing": {
            "id": self.product.id, "name": "Crème   Brûlée", "sku": self.product.sku}}])
        self.assertEqual(self.db.query(Product).count(), 1)

    def test_same_sku_still_updates_even_when_name_matches_another_product(self):
        other = self.call("/api/products", "POST", {"name": "Déjà présent", "sku": "OTHER", "sale_price": 10, "purchase_price": 5}, 201)
        result = self.upload("update.csv", f"Référence;Nom;Prix achat\n{self.product.sku};Déjà présent;75\n".encode())
        self.assertEqual(result, {"created": 0, "updated": 1, "errors": [], "duplicates": []})
        self.db.refresh(self.product)
        self.assertEqual((self.product.name, self.product.purchase_price), ("Déjà présent", 75))
        self.assertEqual(self.db.get(Product, other["id"]).purchase_price, 5)
        self.assertEqual(self.db.query(Product).count(), 2)

    def test_explicit_skus_stay_distinct_and_missing_sku_merges_in_file(self):
        result = self.upload("new.csv", "Référence;Nom\nNEW-A;Nouveau\nNEW-B;Nouveau\n;Nouveau\n".encode())
        self.assertEqual(result, {"created": 2, "updated": 1, "errors": [], "duplicates": []})
        self.assertEqual(self.db.query(Product).filter(Product.name == "Nouveau").count(), 2)
        self.assertEqual(self.db.query(Product).count(), 3)

    def test_import_units_packagings_and_initial_quantity_without_implicit_multiplier(self):
        body = "Référence;Nom;Prix achat;Prix vente;Quantité à la création;Unité;Conditionnement;Facteur;Prix gros conditionnement;Nom du conditionnement 2;Facteur unité de base2;Prix de vente en gros du conditionnement_2\nHUILE;Huile;9500;1500;100;;Carton;10;10000;Colis;20;19000\nKG;Farine;;;7; kg ;;;;;;\n"
        result = self.upload("units.csv", body.encode())
        self.assertEqual((result["created"], result["errors"]), (2, []))
        product = self.db.query(Product).filter_by(sku="HUILE").one()
        self.assertEqual((product.base_unit, product.quantity, product.purchase_price, product.sale_price), ("", 100, 9500, 1500))
        self.assertEqual((product.packaging_unit, product.units_per_packaging), ("", 1))
        self.assertEqual([(p.name, p.factor, p.price_gros) for p in product.packagings], [("Carton", 10, 10000), ("Colis", 20, 19000)])
        self.assertIn("100 pièce = 10 Carton", self.call(f"/api/products/{product.id}")["quantity_label"])
        self.assertEqual(self.db.query(Product).filter_by(sku="KG").one().base_unit, "kg")
        self.upload("again.csv", "Référence;Nom;Stock initial;Conditionnement;Facteur;Prix gros conditionnement\nHUILE;Huile;999;cárton;10;11000\n".encode())
        self.db.expire_all()
        self.assertEqual((product.base_unit, product.quantity), ("", 100))
        self.assertEqual(len(product.packagings), 2)
        self.assertTrue(all(p.active for p in product.packagings))
        self.assertEqual(product.packagings[0].price_gros, 11000)
        self.assertEqual(self.db.query(PriceHistory).filter_by(field=f"packaging:{product.packagings[0].id}:price_gros").one().new_value, 11000)

    def test_quantity_unit_explicitly_converts_only_matching_active_packaging(self):
        result = self.upload("quantities.csv", "Référence;Nom;Stock;Unité de base;Unité de la quantité;Conditionnement;Facteur\nPACK;Conditionné;3;;cartón;Carton;10\nBASE;Base;3;;pièces;Carton;10\nSAME;Même unité;3;Carton;Carton;Carton;10\nBAD;Erreur;3;;Inconnue;Carton;10\n".encode())
        self.assertEqual((result["created"], len(result["errors"])), (3, 1))
        self.assertIn("Unité de la quantité inconnue", result["errors"][0]["message"])
        for sku, expected in (("PACK", 30), ("BASE", 3), ("SAME", 3)):
            self.assertEqual(self.db.query(Product).filter_by(sku=sku).one().quantity, expected)
        self.assertIsNone(self.db.query(Product).filter_by(sku="BAD").first())
        self.upload("existing.csv", "Référence;Nom;Quantité;Unité de la quantité\nPACK;Conditionné;4;carton\n".encode())
        self.assertEqual(self.db.query(Product).filter_by(sku="PACK").one().quantity, 40)

    def test_invalid_packaging_groups_leave_no_product_category_or_stock(self):
        for index, cells in enumerate(("Carton;;100", ";10;100", "Carton;1.5;100", "Carton;0;100", "Carton;bad;100", "Carton;10;-1", "Carton;10;NaN", "Carton;10;bad")):
            with self.subTest(cells=cells):
                result = self.upload("bad.csv", f"Référence;Nom;Catégorie;Stock;Conditionnement;Facteur;Prix gros conditionnement\nBAD-{index};Mauvais;Fantôme;7;{cells}\n".encode())
                self.assertEqual((result["created"], len(result["errors"])), (0, 1))
                self.assertIn("Conditionnement", result["errors"][0]["message"])
        self.assertEqual(self.db.query(Product).count(), 1)
        self.assertEqual(self.db.query(Category).count(), 0)
        self.assertEqual(self.db.query(ProductPackaging).count(), 0)
        result = self.upload("same.csv", "Référence;Nom;Conditionnement;Facteur;Conditionnement2;Facteur2\nBAD;Mauvais;Boîte;10;boite;20\n".encode())
        self.assertIn("répété", result["errors"][0]["message"])

    def test_missing_sku_rows_merge_packagings_and_only_initialize_stock_once(self):
        result = self.upload("merge.csv", "Nom;Quantité initiale;Unité;Conditionnement;Facteur;Prix détail conditionnement;Prix semi-gros conditionnement\nHuile;100;;Carton;10;15000;12000\n húile ;999;;Colis;20;29000;25000\nHUILE;888;;CARTON;10;;\n".encode())
        self.assertEqual(result, {"created": 1, "updated": 2, "errors": [], "duplicates": []})
        product = self.db.query(Product).filter(Product.id != self.product.id).one()
        self.assertEqual(product.quantity, 100)
        self.assertEqual(len(product.packagings), 2)
        self.assertEqual((product.packagings[0].price_detail, product.packagings[0].price_semi_gros), (15000, 12000))

    def test_late_row_failure_rolls_back_existing_prices_packaging_and_category(self):
        body = f"Référence;Nom;Catégorie;Stock;Code-barres;Conditionnement;Facteur;Codes supplémentaires;Prix vente\n{self.product.sku};Modifié;Fantôme;20;12345678;Carton;10;GOOD;999\nOK;Bon;;2;12345678;;;;5\n"
        self.call("/api/products", "POST", {"sku": "TAKEN", "name": "Pris", "barcodes": [{"code": "GOOD"}]}, 201)
        result = self.upload("atomic.csv", body.encode())
        self.assertEqual((result["created"], len(result["errors"])), (1, 1))
        self.db.refresh(self.product)
        self.assertEqual((self.product.quantity, self.product.name), (200, "Produit test"))
        self.assertEqual(self.product.sale_price, 100)
        self.assertEqual(self.db.query(PriceHistory).count(), 0)
        self.assertEqual(self.db.query(Category).count(), 0)
        self.assertEqual(self.db.query(ProductPackaging).count(), 0)

    def test_imported_empty_unit_packaging_sales_purchases_and_inventory(self):
        from app.routers import inventory

        self.app.include_router(inventory.router)
        self.upload("huile.csv", "Référence;Nom;Prix achat;Prix vente;Stock initial;Unité;Conditionnement;Facteur;Prix gros conditionnement\nHUILE;Huile;9500;1500;100;;Carton;10;10000\n".encode())
        product = self.db.query(Product).filter_by(sku="HUILE").one()
        pid, packid = product.id, product.packagings[0].id
        carton = self.call("/api/sales", "POST", {"items": [{"product_id": pid, "packaging_id": packid, "packaging_quantity": 1, "price_tier": "gros"}]}, 201)
        self.assertEqual((carton["items"][0]["quantity"], carton["items"][0]["base_unit"], carton["total"]), (10, "", 10000))
        self.assertEqual(self.call(f"/api/products/{pid}")["quantity"], 90)
        piece = self.call("/api/sales", "POST", {"items": [{"product_id": pid, "quantity": 1}]}, 201)
        self.assertEqual((piece["items"][0]["quantity"], piece["items"][0]["base_unit"]), (1, ""))
        self.assertEqual(self.call(f"/api/products/{pid}")["quantity"], 89)
        purchase = self.call("/api/purchases", "POST", {"supplier_name": "Fournisseur", "items": [{"product_id": pid, "packaging_id": packid, "packaging_quantity": 1}]}, 201)
        self.assertEqual((purchase["items"][0]["quantity"], purchase["items"][0]["base_unit"]), (10, ""))
        self.call(f"/api/purchases/{purchase['id']}/receive", "POST", {})
        self.assertEqual(self.call(f"/api/products/{pid}")["quantity"], 99)
        session = self.call("/api/inventory/sessions", "POST", {"name": "Comptage", "scope_type": "selection", "scope": {"product_ids": [pid]}}, 201)
        path = f"/api/inventory/sessions/{session['id']}"
        count = self.call(path + f"/counts/{pid}", "PUT", {"packaging_id": packid, "packaging_quantity": 3, "piece_quantity": 1})
        self.assertEqual(count["rows"][0]["physical_qty"], 31)
        self.call(path + "/validate", "POST", {})
        self.assertEqual(self.call(f"/api/products/{pid}")["quantity"], 31)
        moves = self.call("/api/inventory/apply", "POST", {"lines": [{"product_id": pid, "packaging_id": packid, "packaging_quantity": 4, "piece_quantity": 1}]})
        self.assertEqual((moves[0]["stock_after"], moves[0]["base_unit"], moves[0]["units_per_packaging"]), (41, "", 10))
        self.assertEqual(self.call(f"/api/products/{pid}")["quantity"], 41)
        self.call("/api/inventory/apply", "POST", {"lines": [{"product_id": pid, "packaging_id": 999999, "packaging_quantity": 1}]}, 400)
        self.assertEqual(self.call(f"/api/products/{pid}")["quantity"], 41)
        self.db.expire_all()
        self.assertGreater(self.db.query(StockMovement).filter_by(product_id=pid).count(), 0)
        self.assertTrue(all(move.base_unit == "" for move in self.db.query(StockMovement).filter_by(product_id=pid)))
        self.assertEqual(self.call(f"/api/sales/{carton['id']}")["items"], carton["items"])

    def test_api_empty_base_unit_survives_create_update_and_omission(self):
        product = self.call("/api/products", "POST", {"sku": "EMPTY", "name": "Vide", "base_unit": ""}, 201)
        self.assertEqual(product["base_unit"], "")
        updated = self.call(f"/api/products/{product['id']}", "PUT", {"sku": "EMPTY", "name": "Vide modifié", "base_unit": ""})
        self.assertEqual(updated["base_unit"], "")
        omitted = self.call(f"/api/products/{product['id']}", "PUT", {"sku": "EMPTY", "name": "Sans unité"})
        self.assertEqual(omitted["base_unit"], "")
        default = self.call("/api/products", "POST", {"sku": "DEFAULT", "name": "Défaut"}, 201)
        self.assertEqual(default["base_unit"], "pièce")

    def test_empty_groups_preserve_all_existing_packagings_and_legacy_columns(self):
        payload = self.call(f"/api/products/{self.product.id}")
        self.call(f"/api/products/{self.product.id}", "PUT", {**payload, "packagings": [
            {"name": "Boîte", "factor": 10, "price_gros": 1000, "price_detail": 1200, "active": True},
            {"name": "Ancien", "factor": 20, "active": False}]})
        body = f"Référence;Nom;Quantité;Stock initial;Unité de la quantité;Conditionnement;Facteur;Prix gros conditionnement;Conditionnement9;Facteur conditionnement_9\n{self.product.sku};Test;3;999;boite;;;;Sac;5\n"
        result = self.upload("merge.csv", body.encode())
        self.assertEqual((result["updated"], result["errors"]), (1, []))
        self.db.refresh(self.product)
        self.assertEqual((self.product.quantity, self.product.packaging_unit, self.product.units_per_packaging), (30, "carton", 24))
        packs = self.db.query(ProductPackaging).filter_by(product_id=self.product.id).order_by(ProductPackaging.id).all()
        self.assertEqual([(p.name, p.active) for p in packs], [("Boîte", True), ("Ancien", False), ("Sac", True)])
        self.assertEqual((packs[0].price_gros, packs[0].price_detail), (1000, 1200))
        result = self.upload("inactive.csv", f"Référence;Nom;Stock;Unité de la quantité\n{self.product.sku};Test;3;Ancien\n".encode())
        self.assertEqual(len(result["errors"]), 1)
        self.db.refresh(self.product)
        self.assertEqual(self.product.quantity, 30)

    def test_name_snapshot_does_not_change_when_existing_product_is_renamed(self):
        self.product.name = "Ancien nom"
        self.db.commit()
        body = f"Référence;Nom\n{self.product.sku};Nouveau nom\nNEW-A;Ancien nom\nNEW-B;Nouveau nom\n"
        result = self.upload("snapshot.csv", body.encode())
        self.assertEqual((result["created"], result["updated"], result["errors"]), (1, 1, []))
        self.assertEqual(result["duplicates"], [{"line": 3, "name": "Ancien nom", "sku": "NEW-A", "existing": {
            "id": self.product.id, "name": "Ancien nom", "sku": self.product.sku}}])
        self.assertEqual(self.db.query(Product).count(), 2)


if __name__ == "__main__":
    unittest.main()
