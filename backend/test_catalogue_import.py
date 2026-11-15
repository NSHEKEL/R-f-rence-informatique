import io
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

import test_wholesale as wholesale
from app.models import Product


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
            self.assertEqual(result, {"created": 0, "updated": 2, "errors": []})
            self.assertEqual(self.db.query(Product).count(), 2)
        self.db.refresh(self.product)
        self.assertEqual(self.product.barcode, "1234567890123")
        self.assertEqual((self.product.purchase_price, self.product.sale_price, self.product.wholesale_price, self.product.min_stock), (45, 110, 85, 7))
        self.assertEqual(self.product.category.name, "Épicerie")

    def test_accented_semicolon_csv_and_typographic_apostrophe(self):
        body = f"Référence;Désignation;Prix d’achat;Prix-de-vente;Stock minimum;Code-barres;Quantité et équivalence;Fournisseur\n{self.product.sku};Riz;45,5;125,75;8;12345678;ignoré;ignoré\n"
        self.assertEqual(self.upload("produits.csv", body.encode("utf-8-sig")), {"created": 0, "updated": 1, "errors": []})
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
        self.assertEqual(self.upload("produits.xlsx", archive.getvalue()), {"created": 0, "updated": 1, "errors": []})
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


if __name__ == "__main__":
    unittest.main()
