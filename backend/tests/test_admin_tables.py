"""Integration test: the admin raw-table viewer endpoints.

Drives the ASGI app with FastAPI's TestClient (Google verification stubbed, S3
off, throwaway DB) to prove the table viewer end to end:
  - the endpoints are admin-only (a plain user and an anonymous visitor get 403),
  - the table list is the two core tables plus every projection,
  - a table's rows come back with their columns, newest first,
  - a name outside the allowlist is a 404 (no arbitrary SQL reaches the DB).

Needs httpx (requirements-dev.txt), so it runs in the backend container:
  docker-compose run --rm backend python -m unittest tests.test_admin_tables
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
SUBS = {ADMIN: "sub-admin", ALICE: "sub-alice"}


class AdminTablesTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None

        self._orig_admins = auth.ADMIN_SUBS
        auth.ADMIN_SUBS = {SUBS[ADMIN]}

        import s3_sync  # noqa: E402

        self._orig_bucket = s3_sync.BUCKET
        s3_sync.BUCKET = ""

        import main  # noqa: E402
        from routers import putting  # noqa: E402

        # DEMO_OWNER_SUB lives on the putting router; patch it there.
        self._putting = putting
        self._orig_demo = putting.DEMO_OWNER_SUB
        putting.DEMO_OWNER_SUB = SUBS[ADMIN]
        self._app = main.app

    def tearDown(self):
        import s3_sync

        auth.ADMIN_SUBS = self._orig_admins
        s3_sync.BUCKET = self._orig_bucket
        self._putting.DEMO_OWNER_SUB = self._orig_demo
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
                        "data": {"distance": 25, "batch_size": 10, "made": 8},
                        "created_at": "2026-08-22T00:00:00Z",
                    }
                ]
            },
        )

    # --- tests -------------------------------------------------------------
    def test_table_list_is_core_plus_projections(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            res = client.get("/admin/tables")
            self.assertEqual(res.status_code, 200)
            tables = res.json()["tables"]
            self.assertIn("events", tables)
            self.assertIn("sync_state", tables)
            # Every projection table is browsable too.
            for expected in ("batches", "tests", "users"):
                self.assertIn(expected, tables)

    def test_owner_scoped_table_rows_carry_columns_and_newest_first(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            self._record_identity(client, "sub-admin", "Admin A")
            self._record_free(client, "b1", "e1")
            self._record_free(client, "b2", "e2")

            res = client.get("/admin/tables/batches?sub=sub-admin")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertEqual(body["table"], "batches")
            self.assertIn("owner_sub", body["columns"])
            self.assertEqual(body["count"], 2)
            self.assertEqual(body["window_days"], 30)
            # Newest first: the second batch recorded comes back first.
            self.assertEqual(body["rows"][0]["batch_id"], "b2")

    def test_owner_scoped_table_requires_an_owner(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            self._record_identity(client, "sub-admin", "Admin A")
            # batches and events are owner-scoped: a missing owner is a 400.
            self.assertEqual(client.get("/admin/tables/batches").status_code, 400)
            self.assertEqual(client.get("/admin/tables/events").status_code, 400)
            # An unknown owner is a 404.
            self.assertEqual(client.get("/admin/tables/batches?sub=nobody").status_code, 404)

    def test_owner_scoping_isolates_one_owners_rows(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            self._record_free(client, "ba", "ea")
            self._login_as(client, ADMIN)
            self._record_identity(client, "sub-admin", "Admin A")
            self._record_free(client, "bb", "eb")

            # Scoped to Alice: only her batch, never the admin's.
            body = client.get("/admin/tables/batches?sub=sub-alice").json()
            self.assertEqual([r["batch_id"] for r in body["rows"]], ["ba"])

    def test_events_table_is_owner_scoped_by_payload_owner(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            self._record_identity(client, "sub-admin", "Admin A")
            res = client.get("/admin/tables/events?sub=sub-admin")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertIn("payload", body["columns"])
            # The admin's own UserSignedIn (owner stamped in the payload) is returned.
            self.assertGreaterEqual(body["count"], 1)

    def test_non_owner_tables_ignore_sub_and_are_not_windowed(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            self._record_identity(client, "sub-admin", "Admin A")
            # users and sync_state need no owner and don't require sub.
            users = client.get("/admin/tables/users")
            self.assertEqual(users.status_code, 200)
            self.assertEqual(client.get("/admin/tables/sync_state").status_code, 200)
            # They are shown in full, not windowed to 30 days.
            self.assertIsNone(users.json()["window_days"])

    def test_unknown_table_is_a_404(self):
        with TestClient(self._app) as client:
            self._login_as(client, ADMIN)
            # A name outside the allowlist never reaches a query.
            self.assertEqual(client.get("/admin/tables/secrets").status_code, 404)
            self.assertEqual(
                client.get("/admin/tables/events;DROP TABLE events").status_code, 404
            )

    def test_endpoints_are_admin_only(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self._record_identity(client, "sub-alice", "Alice A")
            # A plain signed-in user is refused.
            self.assertEqual(client.get("/admin/tables").status_code, 403)
            self.assertEqual(client.get("/admin/tables/events").status_code, 403)
            # So is an anonymous visitor.
            client.post("/auth/logout")
            self.assertEqual(client.get("/admin/tables").status_code, 403)
            self.assertEqual(client.get("/admin/tables/events").status_code, 403)


if __name__ == "__main__":
    unittest.main()
