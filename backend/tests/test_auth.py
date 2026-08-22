"""Tests for admin authorization.

Covers the core property of the auth refactor: `is_admin` is derived *live* from
the ADMIN_EMAILS allowlist on each request, never cached into the session. A
session holds identity only, so changing the allowlist re-decides admin for an
already-signed-in user without them logging in again.

auth.py raises at import time unless auth is configured, so we set a client id in
the environment before importing it. Runs in base python (no HTTP layer needed):
`is_admin`/`require_admin` only read `request.session`, which we stub.

Run (from the backend/ dir): python -m unittest tests.test_auth
"""

import os
import unittest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")

import auth  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class _StubRequest:
    """Minimal stand-in exposing the one attribute the auth helpers read."""

    def __init__(self, user=None):
        self.session = {"user": user} if user is not None else {}


class AdminAuthTest(unittest.TestCase):
    def setUp(self):
        # Isolate global auth state from the environment and other tests.
        self._orig_admins = auth.ADMIN_EMAILS
        auth.ADMIN_EMAILS = {"admin@example.com"}

    def tearDown(self):
        auth.ADMIN_EMAILS = self._orig_admins

    def test_allowlisted_email_is_admin(self):
        req = _StubRequest({"email": "admin@example.com"})
        self.assertTrue(auth.is_admin(req))

    def test_email_match_is_case_insensitive(self):
        req = _StubRequest({"email": "Admin@Example.COM"})
        self.assertTrue(auth.is_admin(req))

    def test_non_allowlisted_email_is_not_admin(self):
        req = _StubRequest({"email": "someone@example.com"})
        self.assertFalse(auth.is_admin(req))

    def test_anonymous_request_is_not_admin(self):
        self.assertFalse(auth.is_admin(_StubRequest()))

    def test_admin_is_decided_live_not_from_the_session(self):
        # Same session throughout; only the allowlist changes. The user does not
        # sign in again, yet their admin status follows the allowlist.
        req = _StubRequest({"email": "promoted@example.com"})
        self.assertFalse(auth.is_admin(req))

        auth.ADMIN_EMAILS = auth.ADMIN_EMAILS | {"promoted@example.com"}
        self.assertTrue(auth.is_admin(req))

        auth.ADMIN_EMAILS = auth.ADMIN_EMAILS - {"promoted@example.com"}
        self.assertFalse(auth.is_admin(req))

    def test_require_admin_rejects_non_admin(self):
        with self.assertRaises(HTTPException) as ctx:
            auth.require_admin(_StubRequest({"email": "someone@example.com"}))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_require_admin_allows_admin(self):
        # No exception means allowed.
        auth.require_admin(_StubRequest({"email": "admin@example.com"}))


if __name__ == "__main__":
    unittest.main()
