"""Integration test: role assignment and the role-based write gate.

Drives the ASGI app with FastAPI's TestClient (Google verification stubbed, S3
off, throwaway DB) to prove the multi-user role model end to end:
  - a brand-new signed-in user defaults to `user` and may write,
  - admin is the live ADMIN_EMAILS overlay, never a stored role,
  - an admin can promote a user to `op`, and an `op` can then change roles,
  - a promotion survives the user signing in again (role is not reset),
  - downgrading a user to `public` leaves them signed in but read-only,
  - `UserRoleChanged` is refused on POST /commands, so no self-promotion,
  - only an op/admin may reach the role endpoint at all.

Needs httpx (requirements-dev.txt), so it runs in the backend container:
  docker-compose run --rm backend python -m unittest tests.test_roles
"""

import os
import tempfile
import unittest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")

import auth  # noqa: E402
import db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ADMIN = "admin@example.com"
ALICE = "alice@example.com"
BOB = "bob@example.com"

# Google's stable per-account id. In production the login `sub` and the id the
# client records the UserSignedIn aggregate under are the same value, and the role
# lookup keys on it, so the stubbed login must carry it too.
SUBS = {ADMIN: "sub-admin", ALICE: "sub-alice", BOB: "sub-bob"}


class RolesTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None

        self._orig_admins = auth.ADMIN_EMAILS
        auth.ADMIN_EMAILS = {ADMIN}  # ALICE/BOB are ordinary users

        import s3_sync  # noqa: E402

        self._orig_bucket = s3_sync.BUCKET
        s3_sync.BUCKET = ""

        import main  # noqa: E402

        self._main = main
        self._orig_demo = main.DEMO_OWNER_EMAIL
        main.DEMO_OWNER_EMAIL = ADMIN
        self._app = main.app

    def tearDown(self):
        import s3_sync

        auth.ADMIN_EMAILS = self._orig_admins
        s3_sync.BUCKET = self._orig_bucket
        self._main.DEMO_OWNER_EMAIL = self._orig_demo
        db._conn = None
        os.unlink(self._tmp.name)

    # --- helpers -----------------------------------------------------------
    def _login_as(self, client, email):
        original = auth.id_token.verify_oauth2_token
        claims = {"email": email, "name": email, "sub": SUBS[email]}
        auth.id_token.verify_oauth2_token = lambda *a, **k: claims
        try:
            self.assertEqual(
                client.post("/auth/google", json={"credential": "fake"}).status_code, 200
            )
        finally:
            auth.id_token.verify_oauth2_token = original

    def _record_identity(self, client, sub, name):
        """The signed-in user records their own UserSignedIn (as the real client does)."""
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": f"id-{sub}",
                        "type": "UserSignedIn",
                        "aggregate_id": sub,
                        "data": {"name": name, "picture": None},
                        "created_at": "2026-08-22T00:00:00Z",
                    }
                ]
            },
        )

    def _record_free(self, client, batch_id, event_id):
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": event_id,
                        "type": "BatchRecorded",
                        "aggregate_id": batch_id,
                        "data": {"kind": "free", "distance": 25, "batch_size": 10, "made": 8},
                        "created_at": "2026-08-22T00:00:00Z",
                    }
                ]
            },
        )

    def _set_role(self, client, sub, role):
        return client.post(f"/users/{sub}/role", json={"role": role})

    # --- tests -------------------------------------------------------------
    def test_new_user_defaults_to_user_and_can_write(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self.assertEqual(self._record_identity(client, "sub-alice", "Alice A").status_code, 200)
            self.assertEqual(client.get("/auth/me").json()["role"], "user")
            # A plain user may record their own putts.
            self.assertEqual(self._record_free(client, "b1", "e1").status_code, 200)

    def test_admin_role_is_the_overlay_not_stored(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            me = client.get("/auth/me").json()
            self.assertTrue(me["is_admin"])
            self.assertEqual(me["role"], "admin")

    def test_admin_promotes_a_user_to_op(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")

            self._login_as(client, ADMIN)
            res = self._set_role(client, "sub-alice", "op")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["role"], "op")

            # Alice now sees her elevated role live, without signing in again.
            self._login_as(client, ALICE)
            self.assertEqual(client.get("/auth/me").json()["role"], "op")

    def test_op_can_change_roles(self):
        with TestClient(self._app) as client:
            # Alice signs in and is promoted to op by the admin.
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            self._login_as(client, BOB)
            self._record_identity(client, "sub-bob", "Bob B")
            self._login_as(client, ADMIN)
            self.assertEqual(self._set_role(client, "sub-alice", "op").status_code, 200)

            # The op (not an admin) can now change Bob's role.
            self._login_as(client, ALICE)
            self.assertEqual(self._set_role(client, "sub-bob", "op").status_code, 200)
            self._login_as(client, BOB)
            self.assertEqual(client.get("/auth/me").json()["role"], "op")

    def test_a_plain_user_cannot_change_roles(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            self._login_as(client, BOB)
            self._record_identity(client, "sub-bob", "Bob B")
            # Bob is a plain user; he may not touch Alice's role.
            self.assertEqual(self._set_role(client, "sub-alice", "op").status_code, 403)

    def test_anonymous_cannot_change_roles(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            client.post("/auth/logout")
            self.assertEqual(self._set_role(client, "sub-alice", "op").status_code, 403)

    def test_promotion_survives_re_signin(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            self._login_as(client, ADMIN)
            self.assertEqual(self._set_role(client, "sub-alice", "op").status_code, 200)

            # Alice signs in again: the re-recorded UserSignedIn must not reset her role.
            self._login_as(client, ALICE)
            self.assertEqual(self._record_identity(client, "sub-alice", "Alice A").status_code, 200)
            self.assertEqual(client.get("/auth/me").json()["role"], "op")

    def test_downgrade_to_public_blocks_writing(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            self.assertEqual(self._record_free(client, "b1", "e1").status_code, 200)

            # Admin downgrades Alice to read-only public.
            self._login_as(client, ADMIN)
            self.assertEqual(self._set_role(client, "sub-alice", "public").status_code, 200)

            # Alice is still signed in, but her writes are now rejected.
            self._login_as(client, ALICE)
            self.assertEqual(client.get("/auth/me").json()["role"], "public")
            self.assertEqual(self._record_free(client, "b2", "e2").status_code, 403)

    def test_role_change_is_refused_on_the_command_path(self):
        # A user cannot forge a UserRoleChanged through POST /commands to promote
        # themselves — the server-only event type is rejected before any write.
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            res = client.post(
                "/commands",
                json={
                    "events": [
                        {
                            "event_id": "hack1",
                            "type": "UserRoleChanged",
                            "aggregate_id": "sub-alice",
                            "data": {"role": "op"},
                            "created_at": "2026-08-22T00:00:00Z",
                        }
                    ]
                },
            )
            self.assertEqual(res.status_code, 403)
            self.assertEqual(client.get("/auth/me").json()["role"], "user")

    def test_invalid_role_is_rejected(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            self._login_as(client, ADMIN)
            # `admin` is not assignable (it is the overlay), nor is a made-up role.
            self.assertEqual(self._set_role(client, "sub-alice", "admin").status_code, 400)
            self.assertEqual(self._set_role(client, "sub-alice", "wizard").status_code, 400)

    def test_unknown_target_is_a_404(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            self.assertEqual(self._set_role(client, "sub-nobody", "op").status_code, 404)

    def test_admin_users_lists_roles_flags_admins_and_never_leaks_email(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            self._login_as(client, ADMIN)
            self._record_identity(client, "sub-admin", "Admin A")

            res = client.get("/admin/users")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            # No email leaks even to the admin listing.
            self.assertNotIn(ADMIN, str(body))
            self.assertNotIn(ALICE, str(body))
            by_sub = {u["sub"]: u for u in body["users"]}
            self.assertEqual(by_sub["sub-alice"]["role"], "user")
            self.assertFalse(by_sub["sub-alice"]["is_admin"])
            # The allowlisted account is flagged, though its stored role is still user.
            self.assertTrue(by_sub["sub-admin"]["is_admin"])
            self.assertEqual(by_sub["sub-admin"]["role"], "user")

    def test_admin_users_is_gated(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            # A plain user cannot list users for management.
            self.assertEqual(client.get("/admin/users").status_code, 403)
            client.post("/auth/logout")
            self.assertEqual(client.get("/admin/users").status_code, 403)


if __name__ == "__main__":
    unittest.main()
