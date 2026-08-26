"""Integration test: per-user ownership through the real command/query path.

Drives the ASGI app with FastAPI's TestClient (Google verification stubbed, S3
off, throwaway DB) to prove the ownership rules end to end:
  - the server stamps `owner` from the session and ignores a client-supplied one,
  - a read is scoped to the caller's own data,
  - a logged-out visitor reads the demo owner's data instead,
  - the daily-test start and its first putt commit atomically.

Needs httpx (requirements-dev.txt), so it runs in the backend container:
  docker-compose run --rm backend python -m unittest tests.test_putting_ownership
"""

import json
import os
import tempfile
import unittest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id")

import auth  # noqa: E402
import db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ALICE = "alice@example.com"
BOB = "bob@example.com"


class PuttingOwnershipTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None

        self._orig_admins = auth.ADMIN_EMAILS
        auth.ADMIN_EMAILS = {ALICE, BOB}

        import s3_sync  # noqa: E402

        self._orig_bucket = s3_sync.BUCKET
        s3_sync.BUCKET = ""

        import main  # noqa: E402

        self._main = main
        self._orig_demo = main.DEMO_OWNER_EMAIL
        main.DEMO_OWNER_EMAIL = ALICE  # the signed-out demo view shows Alice
        self._app = main.app

    def tearDown(self):
        import s3_sync

        auth.ADMIN_EMAILS = self._orig_admins
        s3_sync.BUCKET = self._orig_bucket
        self._main.DEMO_OWNER_EMAIL = self._orig_demo
        db._conn = None
        os.unlink(self._tmp.name)

    def _login_as(self, client, email):
        original = auth.id_token.verify_oauth2_token
        auth.id_token.verify_oauth2_token = lambda *a, **k: {"email": email, "name": email}
        try:
            self.assertEqual(
                client.post("/auth/google", json={"credential": "fake"}).status_code, 200
            )
        finally:
            auth.id_token.verify_oauth2_token = original

    def _record_free(self, client, batch_id, event_id, spoof_owner=None):
        data = {"kind": "free", "distance": 25, "batch_size": 10, "made": 8}
        if spoof_owner is not None:
            data["owner"] = spoof_owner  # should be ignored by the server
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": event_id,
                        "type": "BatchRecorded",
                        "aggregate_id": batch_id,
                        "data": data,
                        "created_at": "2026-08-22T00:00:00Z",
                    }
                ]
            },
        )

    def test_read_is_scoped_to_the_caller(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self.assertEqual(self._record_free(client, "b1", "e1").status_code, 200)
            alice_batches = client.get("/batches").json()["batches"]
            self.assertEqual([b["batch_id"] for b in alice_batches], ["b1"])

            # Bob sees his own (empty) data, never Alice's.
            self._login_as(client, BOB)
            self.assertEqual(client.get("/batches").json()["batches"], [])

    def test_server_ignores_a_spoofed_owner(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            # Alice tries to write a batch owned by Bob; the server stamps her own.
            self.assertEqual(self._record_free(client, "b1", "e1", spoof_owner=BOB).status_code, 200)

            self._login_as(client, BOB)
            self.assertEqual(client.get("/batches").json()["batches"], [])  # not Bob's
            self._login_as(client, ALICE)
            self.assertEqual(len(client.get("/batches").json()["batches"]), 1)  # Alice's

    def test_logged_out_visitor_reads_the_demo_owner(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self.assertEqual(self._record_free(client, "b1", "e1").status_code, 200)

            client.post("/auth/logout")
            body = client.get("/batches").json()
            # The demo owner's data is served, but their email is never exposed.
            self.assertNotIn("owner", body)
            self.assertEqual([b["batch_id"] for b in body["batches"]], ["b1"])

    def test_identity_resolves_to_a_name_and_never_leaks_email(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self.assertEqual(
                client.post(
                    "/commands",
                    json={
                        "events": [
                            {
                                "event_id": "u1",
                                "type": "UserSignedIn",
                                "aggregate_id": "sub-alice",
                                "data": {"name": "Alice A", "picture": None},
                                "created_at": "2026-08-22T00:00:00Z",
                            }
                        ]
                    },
                ).status_code,
                200,
            )
            self.assertEqual(self._record_free(client, "b1", "e1").status_code, 200)

            # /users exposes the display name, keyed by the stable sub, never email.
            users = client.get("/users").json()["users"]
            self.assertEqual(users, [{"sub": "sub-alice", "name": "Alice A", "picture": None}])

            # The owner-scoped reads resolve the owner email to a public identity.
            body = client.get("/batches").json()
            self.assertEqual(body["owner_name"], "Alice A")
            self.assertEqual(body["owner_sub"], "sub-alice")

    def test_history_can_read_any_user_by_sub_without_leaking_email(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            self.assertEqual(self._record_identity(client, "sub-alice", "Alice A").status_code, 200)
            self.assertEqual(self._record_free(client, "b1", "e1").status_code, 200)

            # Bob (a different admin) browses Alice's history by her public sub.
            self._login_as(client, BOB)
            body = client.get("/batches", params={"sub": "sub-alice"}).json()
            self.assertEqual([b["batch_id"] for b in body["batches"]], ["b1"])
            self.assertEqual(body["owner_sub"], "sub-alice")
            self.assertEqual(body["owner_name"], "Alice A")
            self.assertNotIn("owner", body)
            self.assertNotIn(ALICE, json.dumps(body))

            # An unknown sub is a 404, not a fallback to the caller's own data.
            self.assertEqual(client.get("/batches", params={"sub": "nope"}).status_code, 404)
            self.assertEqual(client.get("/tests", params={"sub": "nope"}).status_code, 404)

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

    def _record_putt(self, client, batch_id, distance, batch_size, made):
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": batch_id,
                        "type": "BatchRecorded",
                        "aggregate_id": batch_id,
                        "data": {
                            "kind": "free",
                            "distance": distance,
                            "batch_size": batch_size,
                            "made": made,
                        },
                        "created_at": "2026-08-22T00:00:00Z",
                    }
                ]
            },
        )

    def test_stats_are_per_user_and_the_global_average_is_unweighted(self):
        with TestClient(self._app) as client:
            # Alice: a perfect 5-putt set at 12 ft. Bob: 0/100 at the same distance.
            self._login_as(client, ALICE)
            self.assertEqual(self._record_identity(client, "sub-alice", "Alice A").status_code, 200)
            self.assertEqual(self._record_putt(client, "a12", 12, 5, 5).status_code, 200)
            self._login_as(client, BOB)
            self.assertEqual(self._record_identity(client, "sub-bob", "Bob B").status_code, 200)
            self.assertEqual(self._record_putt(client, "b12", 12, 100, 0).status_code, 200)

            body = client.get("/stats").json()

            # Users are keyed by sub, carry a name, and never expose an email.
            self.assertNotIn("email", json.dumps(body))
            by_sub = {u["sub"]: u for u in body["users"]}
            self.assertEqual(set(by_sub), {"sub-alice", "sub-bob"})
            self.assertEqual(by_sub["sub-alice"]["name"], "Alice A")
            self.assertEqual(by_sub["sub-alice"]["stats"][0], {"distance": 12, "made": 5, "attempts": 5, "pct": 100.0})

            # Global at 12 ft is the mean of the two percentages (100, 0) = 50 —
            # unweighted, so Bob's 100 putts do not drag it toward 0.
            g12 = next(g for g in body["global"] if g["distance"] == 12)
            self.assertEqual(g12["pct"], 50.0)
            self.assertEqual(g12["users"], 2)

    def _record_test(self, client, test_id, batch_id, test_date, distance, made):
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": f"ts-{test_id}",
                        "type": "TestStarted",
                        "aggregate_id": test_id,
                        "data": {"test_date": test_date},
                        "created_at": f"{test_date}T09:00:00Z",
                    },
                    {
                        "event_id": batch_id,
                        "type": "BatchRecorded",
                        "aggregate_id": batch_id,
                        "data": {
                            "kind": "test",
                            "test_id": test_id,
                            "distance": distance,
                            "batch_size": 5,
                            "made": made,
                        },
                        "created_at": f"{test_date}T09:00:00Z",
                    },
                ]
            },
        )

    def test_leaderboard_ranks_by_overall_and_filters_by_date(self):
        with TestClient(self._app) as client:
            # Alice: a strong test today. Bob: a weaker test a month ago.
            self._login_as(client, ALICE)
            self.assertEqual(self._record_identity(client, "sub-alice", "Alice A").status_code, 200)
            self.assertEqual(self._record_test(client, "t-a", "b-a", "2026-08-26", 12, 5).status_code, 200)
            self._login_as(client, BOB)
            self.assertEqual(self._record_identity(client, "sub-bob", "Bob B").status_code, 200)
            self.assertEqual(self._record_test(client, "t-b", "b-b", "2026-07-26", 12, 2).status_code, 200)

            # All-time: both players, best overall % first (Alice 100 > Bob 40).
            body = client.get("/leaderboard").json()
            self.assertNotIn("email", json.dumps(body))
            self.assertEqual([u["sub"] for u in body["users"]], ["sub-alice", "sub-bob"])
            self.assertEqual(body["users"][0]["overall_pct"], 100.0)
            self.assertEqual(body["users"][0]["attempts"], 5)
            self.assertEqual(body["users"][0]["stats"][0]["distance"], 12)

            # Windowed to today: only Alice's test falls inside.
            today = client.get("/leaderboard", params={"start": "2026-08-26", "end": "2026-08-26"}).json()
            self.assertEqual([u["sub"] for u in today["users"]], ["sub-alice"])

    def test_daily_payload_is_bounded_and_baseline_excludes_today(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            # Yesterday's test (the baseline) and today's in-progress test.
            self.assertEqual(self._record_test(client, "t-old", "b-old", "2026-08-25", 12, 4).status_code, 200)
            self.assertEqual(self._record_test(client, "t-new", "b-new", "2026-08-26", 12, 5).status_code, 200)

            body = client.get("/daily", params={"day": "2026-08-26"}).json()
            # Today's test and only today's batches.
            self.assertEqual(body["test"], {"test_id": "t-new", "test_date": "2026-08-26"})
            self.assertEqual([b["batch_id"] for b in body["today_batches"]], ["b-new"])
            # Baseline is yesterday only (4/5 at 12 ft), never today's putt.
            self.assertEqual(body["baseline"], [{"distance": 12, "made": 4, "attempts": 5, "pct": 80.0}])

            # A day with no test: no test, no batches, but the baseline still stands.
            empty = client.get("/daily", params={"day": "2026-08-27"}).json()
            self.assertIsNone(empty["test"])
            self.assertEqual(empty["today_batches"], [])
            self.assertEqual(len(empty["baseline"]), 1)

    def test_daily_test_start_and_first_putt_commit_together(self):
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            res = client.post(
                "/commands",
                json={
                    "events": [
                        {
                            "event_id": "e1",
                            "type": "TestStarted",
                            "aggregate_id": "t1",
                            "data": {"test_date": "2026-08-22"},
                            "created_at": "2026-08-22T09:00:00Z",
                        },
                        {
                            "event_id": "e2",
                            "type": "BatchRecorded",
                            "aggregate_id": "b1",
                            "data": {
                                "kind": "test",
                                "test_id": "t1",
                                "distance": 20,
                                "batch_size": 5,
                                "made": 4,
                            },
                            "created_at": "2026-08-22T09:00:00Z",
                        },
                    ]
                },
            )
            self.assertEqual(res.status_code, 200)
            tests = client.get("/tests").json()["tests"]
            self.assertEqual([t["test_id"] for t in tests], ["t1"])
            batch = client.get("/batches").json()["batches"][0]
            self.assertEqual(batch["test_id"], "t1")
            self.assertEqual(batch["made"], 4)

    def test_a_rejected_event_rolls_back_the_whole_batch(self):
        # The test batch is invalid (6 putts), so the TestStarted before it must
        # not land either.
        with TestClient(self._app) as client:
            self._login_as(client, ALICE)
            res = client.post(
                "/commands",
                json={
                    "events": [
                        {
                            "event_id": "e1",
                            "type": "TestStarted",
                            "aggregate_id": "t1",
                            "data": {"test_date": "2026-08-22"},
                            "created_at": "2026-08-22T09:00:00Z",
                        },
                        {
                            "event_id": "e2",
                            "type": "BatchRecorded",
                            "aggregate_id": "b1",
                            "data": {
                                "kind": "test",
                                "test_id": "t1",
                                "distance": 20,
                                "batch_size": 6,
                                "made": 4,
                            },
                            "created_at": "2026-08-22T09:00:00Z",
                        },
                    ]
                },
            )
            self.assertEqual(res.status_code, 400)
            self.assertEqual(client.get("/tests").json()["tests"], [])


if __name__ == "__main__":
    unittest.main()
