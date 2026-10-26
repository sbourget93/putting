"""Integration test: the admin replay/backfill endpoint, POST /admin/events.

Drives the real ASGI app with FastAPI's TestClient (Google verification stubbed,
S3 off, throwaway DB) to prove the one thing that separates this endpoint from
POST /commands: it keeps each event's own owner_sub instead of stamping the
caller's, so one admin can backfill events across many users. It also proves the
guards that make that safe are wired: admin-only, server-only types refused,
idempotent by event_id, and a missing owner_sub is a 400.

Needs httpx (requirements-dev.txt), so it runs in the backend container:
  docker-compose run --rm backend python -m unittest tests.test_admin_events
"""

import os
import tempfile
import unittest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")

import auth  # noqa: E402
import db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _putt_event(event_id, putt_id, batch_id, owner_sub):
    # A backfilled shadow putt: number/miss_type null, owner carried in the payload
    # (not stamped by the server), exactly as the backfill file emits them.
    return {
        "event_id": event_id,
        "type": "PuttRecorded",
        "aggregate_id": putt_id,
        "data": {
            "batch_id": batch_id,
            "made": True,
            "number": None,
            "miss_type": None,
            "owner_sub": owner_sub,
        },
        "created_at": "2026-08-20T00:00:00Z",
    }


class AdminEventsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None

        self._orig_admins = auth.ADMIN_SUBS
        auth.ADMIN_SUBS = {"sub-admin"}

        import s3_sync  # noqa: E402

        self._orig_bucket = s3_sync.BUCKET
        s3_sync.BUCKET = ""

        import main  # noqa: E402

        self._app = main.app

    def tearDown(self):
        import s3_sync

        auth.ADMIN_SUBS = self._orig_admins
        s3_sync.BUCKET = self._orig_bucket
        db._conn = None
        os.unlink(self._tmp.name)

    def _login_as(self, client, sub):
        original = auth.id_token.verify_oauth2_token
        auth.id_token.verify_oauth2_token = lambda *a, **k: {
            "sub": sub,
            "email": f"{sub}@example.com",
            "name": sub,
        }
        try:
            self.assertEqual(
                client.post("/auth/google", json={"credential": "fake"}).status_code, 200
            )
        finally:
            auth.id_token.verify_oauth2_token = original

    def test_admin_backfill_keeps_each_events_own_owner(self):
        # The whole point: an admin replays a putt owned by someone else, and it
        # lands under that owner — not stamped to the admin as /commands would.
        with TestClient(self._app) as client:
            self._login_as(client, "sub-admin")
            res = client.post(
                "/admin/events",
                json={"events": [_putt_event("e1", "p1", "b1", "sub-alice")]},
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["status"], "ok")

            # The persisted event keeps Alice's owner_sub, not the admin's.
            event = next(e for e in client.get("/events").json()["events"] if e["type"] == "PuttRecorded")
            self.assertEqual(event["data"]["owner_sub"], "sub-alice")

            # And it projected under Alice.
            with db.read() as conn:
                row = conn.execute(
                    "SELECT owner_sub FROM putts WHERE putt_id = ?", ("p1",)
                ).fetchone()
            self.assertEqual(row["owner_sub"], "sub-alice")

    def test_endpoint_is_admin_only(self):
        with TestClient(self._app) as client:
            # A plain signed-in user is refused and writes nothing.
            self._login_as(client, "sub-nobody")
            res = client.post(
                "/admin/events",
                json={"events": [_putt_event("e1", "p1", "b1", "sub-alice")]},
            )
            self.assertEqual(res.status_code, 403)
            # An anonymous visitor too.
            client.post("/auth/logout")
            res = client.post(
                "/admin/events",
                json={"events": [_putt_event("e1", "p1", "b1", "sub-alice")]},
            )
            self.assertEqual(res.status_code, 403)
            # Nothing landed.
            self._login_as(client, "sub-admin")
            self.assertEqual(client.get("/events").json()["events"], [])

    def test_server_only_event_type_is_refused(self):
        with TestClient(self._app) as client:
            self._login_as(client, "sub-admin")
            res = client.post(
                "/admin/events",
                json={
                    "events": [
                        {
                            "event_id": "e1",
                            "type": "UserRoleChanged",
                            "aggregate_id": "sub-admin",
                            "data": {"role": "op", "owner_sub": "sub-admin"},
                            "created_at": "2026-08-20T00:00:00Z",
                        }
                    ]
                },
            )
            self.assertEqual(res.status_code, 403)

    def test_replay_is_idempotent_by_event_id(self):
        with TestClient(self._app) as client:
            self._login_as(client, "sub-admin")
            event = {"events": [_putt_event("e1", "p1", "b1", "sub-alice")]}
            first = client.post("/admin/events", json=event)
            second = client.post("/admin/events", json=event)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            # The re-sent event is skipped, not duplicated: one row, version unchanged.
            self.assertEqual(first.json()["version"], second.json()["version"])
            putts = [e for e in client.get("/events").json()["events"] if e["type"] == "PuttRecorded"]
            self.assertEqual(len(putts), 1)

    def test_missing_owner_sub_is_a_400(self):
        with TestClient(self._app) as client:
            self._login_as(client, "sub-admin")
            bad = _putt_event("e1", "p1", "b1", "sub-alice")
            del bad["data"]["owner_sub"]
            res = client.post("/admin/events", json={"events": [bad]})
            self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
