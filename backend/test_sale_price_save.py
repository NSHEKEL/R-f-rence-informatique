import unittest

from app.models import PriceHistory, ProductPackaging, Sale, StockMovement
import test_product_packagings as packs


class SalePriceSaveTests(unittest.TestCase):
    setUp = packs.ProductPackagingsTests.setUp
    call = packs.ProductPackagingsTests.call
    open = packs.ProductPackagingsTests.open
    grant = packs.ProductPackagingsTests.grant

    def sell(self, line=None, **payload):
        return self.call('/api/sales', 'POST', {'items': [{'product_id': self.product.id, 'quantity': 1, **(line or {})}], **payload}, 201)

    def test_manual_base_price_replaces_missing_or_existing_price_before_discounts(self):
        for old in (None, 0, 100):
            self.product.sale_price = old
            self.db.commit()
            result = self.sell({'unit_price': 150, 'price_edited': True, 'discount': 20}, discount=10)
            self.db.expire_all()
            self.assertEqual(result['total'], 120)
            self.assertEqual(self.product.sale_price, 150)
            history = self.db.query(PriceHistory).order_by(PriceHistory.id.desc()).first()
            self.assertEqual((history.field, history.old_value, history.new_value, history.changed_by_id), ('sale_price', old, 150, self.user.id))

    def test_unedited_legacy_override_and_discount_do_not_write_catalogue(self):
        self.sell({'unit_price': 125, 'discount': 10})
        self.sell({'discount': 5})
        self.db.expire_all()
        self.assertEqual(self.product.sale_price, 100)
        self.assertEqual(self.db.query(PriceHistory).count(), 0)

    def test_packaging_tiers_and_positive_gros_detail_sync(self):
        row = ProductPackaging(product_id=self.product.id, name='Carton', factor=6, price_detail=None)
        self.db.add(row)
        self.db.commit()
        for tier, field, value in [('detail', 'price_detail', 600), ('semi_gros', 'price_semi_gros', 720), ('gros', 'price_gros', 900)]:
            self.sell({'packaging_id': row.id, 'packaging_quantity': 1, 'unit_price': value / 6, 'price_tier': tier, 'price_edited': True, 'discount': 30})
            self.db.expire_all()
            self.assertEqual(getattr(row, field), value)
            self.assertEqual(self.product.sale_price, 100)
            if tier == 'detail':
                self.assertIsNone(row.price_gros)
            if tier == 'gros':
                self.assertEqual(row.price_detail, value)
        self.assertEqual(self.db.query(PriceHistory).count(), 4)

    def test_base_tiers_and_legacy_carton_target_the_sold_unit(self):
        self.sell({'price_tier': 'semi_gros', 'unit_price': 70, 'price_edited': True})
        self.sell({'price_tier': 'gros', 'unit_price': 60, 'price_edited': True})
        self.sell({'packaging_quantity': 1, 'unit_price': 50, 'price_edited': True})
        self.db.expire_all()
        self.assertEqual((self.product.sale_price, self.product.semi_wholesale_price, self.product.wholesale_price, self.product.packaging_sale_price), (100, 70, 60, 1200))

    def test_offline_replay_applies_price_and_history_once_even_after_another_edit(self):
        result = self.sell({'unit_price': 140, 'price_edited': True}, client_id='typed-offline')
        self.db.expire_all()
        self.product.sale_price = 180
        self.db.commit()
        replay = self.sell({'unit_price': 140, 'price_edited': True}, client_id='typed-offline')
        self.db.expire_all()
        self.assertEqual(result['id'], replay['id'])
        self.assertEqual(self.product.sale_price, 180)
        self.assertEqual(self.db.query(PriceHistory).count(), 1)
        self.assertEqual(self.db.query(Sale).count(), 1)
        self.assertEqual(self.db.query(StockMovement).filter_by(kind='vente').count(), 1)

    def test_validation_failure_rolls_back_prices_and_history(self):
        self.call('/api/sales', 'POST', {'items': [{'product_id': self.product.id, 'quantity': 1, 'unit_price': 155, 'price_edited': True}], 'payments': [{'method': 'Espèces', 'amount': 1}]}, 400)
        self.db.expire_all()
        self.assertEqual(self.product.sale_price, 100)
        self.assertEqual(self.db.query(PriceHistory).count(), 0)

    def test_price_edit_permission_required_even_when_price_matches_catalogue(self):
        self.user.role = 'vendeur'
        self.grant('vente_nouvelle')
        self.db.commit()
        self.call('/api/sales', 'POST', {'items': [{'product_id': self.product.id, 'quantity': 1, 'unit_price': 100, 'price_edited': True}]}, 403)
        self.db.expire_all()
        self.assertEqual(self.db.query(PriceHistory).count(), 0)
