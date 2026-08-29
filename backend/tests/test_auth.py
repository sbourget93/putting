"""Tests for admin authorization and the signed-in write gate.

Covers the core property of the auth refactor: `is_admin` is derived *live* from
the ADMIN_SUBS allowlist on each request, never cached into the session. A session
holds identity only, so changing the allowlist re-decides admin for an already-
signed-in user without them logging in again. Also covers the write gate
(`require_writer`/`can_write`) for the two roles decidable without a DB read: a
signed-out visitor (`public`, rejected) and an admin (overlay, allowed). The
signed-in-user and downgraded-`public` write paths need the projection, so they
are exercised in the integration suites instead.

Admin is keyed on the Google `sub`, not email, so no email is read anywhere. auth.py
raises at import time unless auth is configured, so we set a client id in the
environment before importing it. Runs in base python (no HTTP layer needed):
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
        self._orig_admins = auth.ADMIN_SUBS
        auth.ADMIN_SUBS = {"sub-admin"}

    def tearDown(self):
        auth.ADMIN_SUBS = self._orig_admins

    def test_allowlisted_sub_is_admin(self):
        req = _StubRequest({"sub": "sub-admin"})
        self.assertTrue(auth.is_admin(req))

    def test_non_allowlisted_sub_is_not_admin(self):
        req = _StubRequest({"sub": "sub-someone"})
        self.assertFalse(auth.is_admin(req))

    def test_anonymous_request_is_not_admin(self):
        self.assertFalse(auth.is_admin(_StubRequest()))

    def test_admin_is_decided_live_not_from_the_session(self):
        # Same session throughout; only the allowlist changes. The user does not
        # sign in again, yet their admin status follows the allowlist.
        req = _StubRequest({"sub": "sub-promoted"})
        self.assertFalse(auth.is_admin(req))

        auth.ADMIN_SUBS = auth.ADMIN_SUBS | {"sub-promoted"}
        self.assertTrue(auth.is_admin(req))

        auth.ADMIN_SUBS = auth.ADMIN_SUBS - {"sub-promoted"}
        self.assertFalse(auth.is_admin(req))

    def test_require_admin_rejects_non_admin(self):
        with self.assertRaises(HTTPException) as ctx:
            auth.require_admin(_StubRequest({"sub": "sub-someone"}))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_require_admin_allows_admin(self):
        # No exception means allowed.
        auth.require_admin(_StubRequest({"sub": "sub-admin"}))

    def test_require_writer_rejects_anonymous(self):
        # A signed-out visitor resolves to the read-only `public` role, so the
        # write gate rejects them. (No DB needed: current_user is None.)
        self.assertFalse(auth.can_write(_StubRequest()))
        with self.assertRaises(HTTPException) as ctx:
            auth.require_writer(_StubRequest())
        self.assertEqual(ctx.exception.status_code, 403)

    def test_require_writer_allows_admin(self):
        # An admin is a writer via the overlay, decided without touching the DB.
        req = _StubRequest({"sub": "sub-admin"})
        self.assertTrue(auth.can_write(req))
        auth.require_writer(req)  # no exception means allowed

    def test_anonymous_effective_role_is_public(self):
        self.assertEqual(auth.effective_role(_StubRequest()), "public")

    def test_admin_effective_role_is_admin(self):
        self.assertEqual(
            auth.effective_role(_StubRequest({"sub": "sub-admin"})), "admin"
        )


if __name__ == "__main__":
    unittest.main()
