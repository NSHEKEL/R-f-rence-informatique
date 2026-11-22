import time
import unittest
import uuid
from unittest.mock import patch

from fastapi import HTTPException

import test_treasury_permissions as fixtures
from app.models import CompanySettings
from app.offline_auth import current_account, issue, read_grant
from app.offline_crypto import private_key, public_key
from app.settings_access import check_company_update


class OfflineAuthorizationTests(unittest.TestCase):
    setUp = fixtures.TreasuryPermissionsTests.setUp
    grant = fixtures.TreasuryPermissionsTests.grant

    def test_password_login_grants_are_bounded_bound_and_revocable(self):
        self.grant("caisse", "vente_nouvelle")
        private = private_key()
        with patch("app.offline_auth.signing_key", return_value=private), patch("app.offline_auth.has_feature", return_value=True), patch("app.offline_auth.installation_uid", return_value="shop-test"):
            device = str(uuid.uuid4())
            self.assertEqual(issue(self.db, self.user, device, public_key(private), False), {})
            first = issue(self.db, self.user, device, public_key(private), True)
            claims = read_grant(self.db, first["offline_grant"])
            self.assertEqual(claims["exp"] - claims["auth_at"], 24 * 3600)
            self.assertEqual(claims["device_id"], device)
            self.assertEqual(current_account(self.db, claims)[0].id, self.user.id)
            with self.assertRaises(HTTPException):
                read_grant(self.db, first["offline_grant"] + "tampered")
            self.user.is_active = False
            self.db.commit()
            with self.assertRaises(HTTPException):
                current_account(self.db, claims)

    def test_expired_grant_and_nonadmin_policy_changes_are_refused(self):
        self.grant("caisse", "vente_nouvelle")
        with self.assertRaises(HTTPException):
            check_company_update(self.db, self.user, {"offline_authorization_hours": 72})
        private = private_key()
        with patch("app.offline_auth.signing_key", return_value=private), patch("app.offline_auth.has_feature", return_value=True), patch("app.offline_auth.installation_uid", return_value="shop-test"):
            with patch("app.offline_auth.time.time", return_value=time.time() - 25 * 3600):
                result = issue(self.db, self.user, str(uuid.uuid4()), public_key(private), True)
            with self.assertRaises(HTTPException):
                read_grant(self.db, result["offline_grant"])
            self.assertIsNotNone(read_grant(self.db, result["offline_grant"], expired=True))
