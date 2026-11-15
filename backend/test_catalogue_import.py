import io
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

import test_wholesale as wholesale
from app.models import Category, Product


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

    def test_names_repeated_only_inside_file_are_all_created(self):
        result = self.upload("new.csv", "Référence;Nom\nNEW-A;Nouveau\nNEW-B;Nouveau\n;Nouveau\n".encode())
        self.assertEqual(result, {"created": 3, "updated": 0, "errors": [], "duplicates": []})
        self.assertEqual(self.db.query(Product).filter(Product.name == "Nouveau").count(), 3)
        self.assertEqual(self.db.query(Product).count(), 4)

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
