import json
import unittest

import test_cash_global as fixtures
from app.models import CashClosure, DebtPayment
from app.routers import cash


class GlobalDataWarningsTests(unittest.TestCase):
    setUp = fixtures.CashGlobalTests.setUp
    call = fixtures.CashGlobalTests.call
    grant = fixtures.CashGlobalTests.grant
    open = fixtures.CashGlobalTests.open
    prepare = fixtures.CashGlobalTests.prepare
    close = fixtures.CashGlobalTests.close
    global_close = fixtures.CashGlobalTests.global_close

    def test_empty_or_clean_global_has_no_warnings(self):
        self.prepare()
        self.assertEqual(cash._global_totals(self.db, [], self.user)["data_warnings"], [])
        self.assertEqual(self.call("/api/cash-sessions/global")["data_warnings"], [])

    def test_orphan_warning_survives_global_preview_and_frozen_archive_without_blocking(self):
        till = self.prepare()
        before = self.call("/api/cash-sessions/current")["expected_cash"]
        orphan = DebtPayment(debt_id=99999, cash_session_id=till["id"], amount=1234, method="Espèces", created_by_id=self.user.id)
        self.db.add(orphan)
        self.db.commit()
        current = self.call("/api/cash-sessions/current")
        preview = self.call("/api/cash-sessions/global")
        self.assertEqual(preview["expected_cash"], before)
        self.assertEqual(len(preview["data_warnings"]), 1)
        warning = preview["data_warnings"][0]
        self.assertIn(f"Caisse #{till['id']}", warning)
        self.assertIn(current["data_warnings"][0], warning)
        self.assertIn(f"Règlement #{orphan.id}", warning)
        self.close(before)
        preview = self.call("/api/cash-sessions/global")
        archived = self.global_close(preview, before)
        self.assertEqual(archived["data_warnings"], [warning])
        history = self.call("/api/cash-sessions/global/closures")
        self.assertEqual(history[0]["data_warnings"], [warning])
        stored = self.db.get(CashClosure, archived["id"])
        self.assertEqual(json.loads(stored.report)["data_warnings"], [warning])
        self.assertEqual(self.db.get(DebtPayment, orphan.id).amount, 1234)
        print("GLOBAL_ORPHAN_WARNING_OK preview=True archived=True original_preserved=True close_http=201 expected_cash_unchanged=True")
