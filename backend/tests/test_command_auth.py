"""Integration test: the command endpoint's write gate.

Where test_auth.py unit-tests the auth helpers in isolation, this drives the real
ASGI app with FastAPI's TestClient to prove `POST /commands` is actually wired to
`require_writer`: an anonymous caller gets 403 and writes nothing, while any
signed-in user's batch commits and projects. The raw `/events` log stays
admin-only. Delete the `dependencies=` line on the route and these tests fail —
that's the point.

The only thing stubbed is Google token verification (we never call Google in a
test); the rest of the auth path — session cookie -> require_writer -> role ->
allowlist — runs for real. S3 stays disabled (no S3_BUCKET) and the DB is a
throwaway temp file, so nothing here touches app.db or AWS.

Needs httpx (see requirements-dev.txt), so it runs in the backend container:
  docker-compose run --rm backend python -m unittest tests.test_command_auth
"""

import os
import tempfile
import unittest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")

import auth  # noqa: E402
import db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _foo_created_event():
    return {
        "event_id": "e1",
        "type": "FooCreated",
        "aggregate_id": "f1",
        "data": {"public_value": "hello", "private_value": "secret"},
        "created_at": "2026-08-20T00:00:00Z",
    }


class CommandAuthTest(unittest.TestCase):
    def setUp(self):
        # Throwaway DB so the test never touches the real app.db.
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None

        self._orig_admins = auth.ADMIN_EMAILS
        auth.ADMIN_EMAILS = {"admin@example.com"}

        # Force S3 off for this test regardless of other suites: test_s3_sync sets
        # S3_BUCKET at import, and discovery imports every module before any run,
        # so without this the app's startup would attempt a real S3 restore.
        # Imported here (not at module load) so we don't fix s3_sync.BUCKET before
        # test_s3_sync's own env setup runs.
        import s3_sync  # noqa: E402

        self._orig_bucket = s3_sync.BUCKET
        s3_sync.BUCKET = ""

        # Import main only after DB_PATH is set: the TestClient context runs the
        # app's lifespan, which calls db.init_db() against the temp file.
        import main  # noqa: E402

        self._app = main.app

    def tearDown(self):
        import s3_sync

        auth.ADMIN_EMAILS = self._orig_admins
        s3_sync.BUCKET = self._orig_bucket
        db._conn = None
        os.unlink(self._tmp.name)

    def _login_as(self, client, email):
        # Stub Google verification, then hit the real /auth/google so the client
        # picks up the session cookie the rest of the flow relies on.
        original = auth.id_token.verify_oauth2_token
        auth.id_token.verify_oauth2_token = lambda *a, **k: {"email": email, "name": email}
        try:
            res = client.post("/auth/google", json={"credential": "fake-token"})
            self.assertEqual(res.status_code, 200)
        finally:
            auth.id_token.verify_oauth2_token = original

    def test_anonymous_caller_is_rejected_and_writes_nothing(self):
        with TestClient(self._app) as client:
            res = client.post("/commands", json={"events": [_foo_created_event()]})
            self.assertEqual(res.status_code, 403)
            self.assertEqual(client.get("/foos").json()["version"], 0)

    def test_signed_in_non_admin_can_write(self):
        # The multi-user swap: being signed in — not being an admin — is what the
        # write path requires now. A plain user's batch commits and projects.
        with TestClient(self._app) as client:
            self._login_as(client, "nobody@example.com")
            res = client.post("/commands", json={"events": [_foo_created_event()]})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["status"], "ok")
            foos = client.get("/foos").json()["foos"]
            self.assertEqual([f["public_value"] for f in foos], ["hello"])
            # A non-admin still never sees the private field.
            self.assertNotIn("private_value", foos[0])

    def test_events_log_requires_admin(self):
        # The raw event log carries fields /foos hides from non-admins (e.g.
        # private_value), so it is admin-gated: an anonymous caller is rejected.
        with TestClient(self._app) as client:
            res = client.get("/events")
            self.assertEqual(res.status_code, 403)

    def test_non_admin_cannot_read_events_log(self):
        with TestClient(self._app) as client:
            self._login_as(client, "nobody@example.com")
            res = client.get("/events")
            self.assertEqual(res.status_code, 403)

    def test_admin_reads_full_event_payloads(self):
        # The admin who authored the write can sync the log back with the private
        # payload intact — this is what the offline client store folds.
        with TestClient(self._app) as client:
            self._login_as(client, "admin@example.com")
            self.assertEqual(
                client.post("/commands", json={"events": [_foo_created_event()]}).status_code,
                200,
            )
            res = client.get("/events")
            self.assertEqual(res.status_code, 200)
            events = res.json()["events"]
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["type"], "FooCreated")
            self.assertEqual(events[0]["data"]["private_value"], "secret")

    def test_admin_command_commits_and_projects(self):
        with TestClient(self._app) as client:
            self._login_as(client, "admin@example.com")
            res = client.post("/commands", json={"events": [_foo_created_event()]})
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["status"], "ok")

            # The write landed in the projection, and the admin sees private_value.
            foos = client.get("/foos").json()["foos"]
            self.assertEqual(len(foos), 1)
            self.assertEqual(foos[0]["public_value"], "hello")
            self.assertEqual(foos[0]["private_value"], "secret")


if __name__ == "__main__":
    unittest.main()
