import ast
import json
import logging
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine, inspect, text

import test_cash_register as cash_tests
from app import migrate as migration
from app.models import CompanySettings, Product
from app.routers import products, settings


class PosDisplayTests(unittest.TestCase):
    call = cash_tests.CashRegisterTests.call
    grant = cash_tests.CashRegisterTests.grant
    open = cash_tests.CashRegisterTests.open

    def setUp(self):
        cash_tests.CashRegisterTests.setUp(self)
        self.app.include_router(products.router)
        self.app.include_router(settings.router)
        self.open()

    def test_stock_masked_across_catalogue_routes_and_sale_checked_on_server(self):
        for path in ('/api/products', '/api/products/pos', '/api/products/by-code/CASH-TEST', f'/api/products/{self.product.id}'):
            data = self.call(path)
            row = data[0] if isinstance(data, list) else data
            self.assertIsNone(row.get('quantity'), path)
            self.assertIsNone(row.get('min_stock'), path)
            self.assertIsNone(row.get('quantity_label'), path)
        self.call('/api/sales', 'POST', {'items': [{'product_id': self.product.id, 'quantity': 21}]}, status=400)
        self.call('/api/sales', 'POST', {'items': [{'product_id': self.product.id, 'quantity': 1}]}, status=201)
        self.grant('produits')
        self.assertEqual(self.call('/api/products/pos')[0]['quantity'], 19)

    def test_settings_admin_persistence_defaults_and_invalid_values(self):
        defaults = self.call('/api/settings/pos-display')
        self.assertEqual((defaults['mode'], defaults['images'], defaults['stock'], defaults['columns']), ('nom', False, False, 0))
        self.call('/api/settings/pos-display', 'PUT', {'mode': 'nom+prix'}, status=403)
        self.user.role = 'admin'
        self.db.commit()
        saved = self.call('/api/settings/pos-display', 'PUT', {'mode': 'nom+prix+stock', 'width': 190, 'stock': True})
        with patch.object(migration, 'engine', self.engine):
            migration.migrate()
            migration.migrate()
        self.assertEqual(self.call('/api/settings/pos-display'), saved)
        self.db.expire_all()
        self.assertEqual(json.loads(self.db.query(CompanySettings).one().pos_display)['width'], 190)
        for payload in ({'width': 0}, {'background': 'url(javascript:x)'}, {'mode': 'other'}, {'columns': 13}):
            self.call('/api/settings/pos-display', 'PUT', payload, status=422)
        self.assertEqual(self.call('/api/settings/pos-display'), saved)
        self.assertEqual(self.call('/api/settings/pos-display', 'PUT', defaults), defaults)

    def test_pos_catalogue_no_images_by_default_empty_and_best_sellers_masked(self):
        self.product.image = 'data:image/png;base64,AA=='
        self.db.commit()
        self.assertEqual(self.call('/api/products/pos')[0]['image'], '')
        self.call('/api/sales', 'POST', {'items': [{'product_id': self.product.id, 'quantity': 1}]}, status=201)
        top = self.call('/api/products/best-sellers')[0]
        self.assertIsNone(top['quantity'])
        self.assertIsNone(top['quantity_label'])
        self.db.expire_all()
        self.db.get(Product, self.product.id).quantity = 0
        self.db.commit()
        self.assertEqual(self.call('/api/products/pos'), [])

    def test_old_company_schema_keeps_rows_and_gets_nullable_json_column_once(self):
        engine = create_engine('sqlite:///:memory:')
        self.addCleanup(engine.dispose)
        with engine.begin() as connection:
            connection.execute(text('CREATE TABLE company_settings (id INTEGER PRIMARY KEY, name VARCHAR)'))
            connection.execute(text("INSERT INTO company_settings VALUES (1, 'Magasin conservé')"))
        with patch.object(migration, 'engine', engine):
            migration.migrate()
            migration.migrate()
        with engine.connect() as connection:
            self.assertEqual(connection.execute(text('SELECT name, pos_display FROM company_settings')).one(), ('Magasin conservé', '{}'))
        column = next(item for item in inspect(engine).get_columns('company_settings') if item['name'] == 'pos_display')
        self.assertTrue(column['nullable'])

    def test_desktop_printer_status_reports_disconnection_without_launching_app(self):
        source = ast.parse(Path(__file__).with_name('run.py').read_text(encoding='utf-8'))
        desktop = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == 'DesktopApi')
        method = next(node for node in desktop.body if isinstance(node, ast.FunctionDef) and node.name == '_printer_problem')
        device = SimpleNamespace(available=False, status='Hors ligne')
        fake = SimpleNamespace(queue_status=lambda _name: device, default_printer=lambda: 'Ticket')
        namespace = {'printing': fake, 'logging': logging}
        exec(compile(ast.Module(body=[method], type_ignores=[]), 'printer-status-test', 'exec'), namespace)
        self.assertEqual(namespace['_printer_problem'](None, 'Ticket'), 'Hors ligne')
        device.available = True
        self.assertEqual(namespace['_printer_problem'](None, ''), '')
