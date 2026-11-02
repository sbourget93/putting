"""Integration test: the comment flow through the real command/query path.

Drives the ASGI app with FastAPI's TestClient (Google verification stubbed, S3 off,
throwaway DB) to prove end to end that:
  - a writer can comment on *another* player's test (comments are cross-user),
  - GET /comments returns them in server arrival order with the author's identity,
  - the daily leaderboard reports each test's comment count,
  - edit and delete are owner-scoped (the server stamps the acting user, so one user
    cannot edit or delete another's comment), and never expose an email,
  - an over-length body is rejected.

Needs httpx (requirements-dev.txt), so it runs in the backend container:
  docker-compose run --rm backend python -m unittest tests.test_comments_api
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
SUBS = {ALICE: "sub-alice", BOB: "sub-bob"}


class CommentsApiTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None

        self._orig_admins = auth.ADMIN_SUBS
        auth.ADMIN_SUBS = {SUBS[ALICE], SUBS[BOB]}

        import s3_sync  # noqa: E402

        self._orig_bucket = s3_sync.BUCKET
        s3_sync.BUCKET = ""

        import main  # noqa: E402
        from routers import putting  # noqa: E402

        self._putting = putting
        self._orig_demo = putting.DEMO_OWNER_SUB
        putting.DEMO_OWNER_SUB = SUBS[ALICE]
        self._app = main.app

    def tearDown(self):
        import s3_sync

        auth.ADMIN_SUBS = self._orig_admins
        s3_sync.BUCKET = self._orig_bucket
        self._putting.DEMO_OWNER_SUB = self._orig_demo
        db._conn = None
        os.unlink(self._tmp.name)

    def _login_as(self, client, email):
        original = auth.id_token.verify_oauth2_token
        auth.id_token.verify_oauth2_token = lambda *a, **k: {
            "sub": SUBS[email],
            "email": email,
            "name": email,
        }
        try:
            self.assertEqual(
                client.post("/auth/google", json={"credential": "fake"}).status_code, 200
            )
        finally:
            auth.id_token.verify_oauth2_token = original

    def _record_identity(self, client, sub, name, picture=None):
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": f"id-{sub}",
                        "type": "UserSignedIn",
                        "aggregate_id": sub,
                        "data": {"name": name, "picture": picture},
                        "created_at": "2026-08-22T00:00:00Z",
                    }
                ]
            },
        )

    def _record_full_test(self, client, test_id, test_date, made=5):
        events = [
            {
                "event_id": f"ts-{test_id}",
                "type": "TestStarted",
                "aggregate_id": test_id,
                "data": {"test_date": test_date},
                "created_at": f"{test_date}T09:00:00Z",
            }
        ]
        for distance in range(12, 34):
            events.append(
                {
                    "event_id": f"{test_id}-{distance}",
                    "type": "BatchRecorded",
                    "aggregate_id": f"{test_id}-b{distance}",
                    "data": {"test_id": test_id, "distance": distance, "batch_size": 5, "made": made},
                    "created_at": f"{test_date}T09:00:00Z",
                }
            )
        return client.post("/commands", json={"events": events})

    def _comment(self, client, comment_id, test_id, body, spoof_owner=None):
        data = {"test_id": test_id, "body": body}
        if spoof_owner is not None:
            data["owner_sub"] = spoof_owner  # should be ignored by the server
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": f"e-{comment_id}",
                        "type": "TestCommentAdded",
                        "aggregate_id": comment_id,
                        "data": data,
                        "created_at": "2026-08-27T09:00:00Z",
                    }
                ]
            },
        )

    def _edit(self, client, comment_id, body):
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": f"edit-{comment_id}-{body}",
                        "type": "TestCommentEdited",
                        "aggregate_id": comment_id,
                        "data": {"body": body},
                        "created_at": "2026-08-27T10:00:00Z",
                    }
                ]
            },
        )

    def _delete(self, client, comment_id, tag=""):
        # `tag` keeps the event_id unique when the same comment is deleted twice (a
        # no-op attempt by a non-owner, then the real one), so idempotency doesn't
        # skip the second as a duplicate.
        return client.post(
            "/commands",
            json={
                "events": [
                    {
                        "event_id": f"del-{comment_id}-{tag}",
                        "type": "TestCommentDeleted",
                        "aggregate_id": comment_id,
                        "data": {},
                        "created_at": "2026-08-27T11:00:00Z",
                    }
                ]
            },
        )

    def _setup_alices_test(self, client):
        """Alice completes a test; both players have an identity. Returns the test id."""
        self._login_as(client, ALICE)
        self.assertEqual(self._record_identity(client, "sub-alice", "Alice A").status_code, 200)
        self.assertEqual(self._record_full_test(client, "t-alice", "2026-08-27").status_code, 200)
        self._login_as(client, BOB)
        self.assertEqual(
            self._record_identity(client, "sub-bob", "Bob B", picture="http://x/b.png").status_code,
            200,
        )
        return "t-alice"

    def test_comment_on_another_users_test_in_server_order(self):
        with TestClient(self._app) as client:
            test_id = self._setup_alices_test(client)

            # Bob comments on Alice's test; Alice replies on her own.
            self.assertEqual(self._comment(client, "c1", test_id, "nice round").status_code, 200)
            self._login_as(client, ALICE)
            self.assertEqual(self._comment(client, "c2", test_id, "thanks!").status_code, 200)

            body = client.get("/comments", params={"test_id": test_id}).json()
            self.assertNotIn("email", json.dumps(body))
            # Server arrival order: Bob's first, then Alice's.
            self.assertEqual([c["comment_id"] for c in body["comments"]], ["c1", "c2"])
            self.assertEqual(body["comments"][0]["owner_sub"], "sub-bob")
            self.assertEqual(body["comments"][0]["name"], "Bob B")
            self.assertEqual(body["comments"][0]["picture"], "http://x/b.png")
            self.assertFalse(body["comments"][0]["edited"])

    def test_server_ignores_a_spoofed_comment_owner(self):
        with TestClient(self._app) as client:
            test_id = self._setup_alices_test(client)
            # Bob posts but claims Alice as the owner; the server stamps Bob.
            self.assertEqual(
                self._comment(client, "c1", test_id, "spoofed", spoof_owner="sub-alice").status_code,
                200,
            )
            comments = client.get("/comments", params={"test_id": test_id}).json()["comments"]
            self.assertEqual(comments[0]["owner_sub"], "sub-bob")

    def test_leaderboard_reports_comment_count(self):
        with TestClient(self._app) as client:
            test_id = self._setup_alices_test(client)
            # No comments yet: the count is zero.
            board = client.get("/leaderboard", params={"mode": "daily", "day": "2026-08-27"}).json()
            alice = next(u for u in board["users"] if u["sub"] == "sub-alice")
            self.assertEqual(alice["comment_count"], 0)
            self.assertEqual(alice["test_id"], test_id)

            self.assertEqual(self._comment(client, "c1", test_id, "one").status_code, 200)
            self.assertEqual(self._comment(client, "c2", test_id, "two").status_code, 200)
            board = client.get("/leaderboard", params={"mode": "daily", "day": "2026-08-27"}).json()
            alice = next(u for u in board["users"] if u["sub"] == "sub-alice")
            self.assertEqual(alice["comment_count"], 2)

            # A deleted comment stops counting and drops out of the thread.
            self.assertEqual(self._delete(client, "c1").status_code, 200)
            board = client.get("/leaderboard", params={"mode": "daily", "day": "2026-08-27"}).json()
            alice = next(u for u in board["users"] if u["sub"] == "sub-alice")
            self.assertEqual(alice["comment_count"], 1)
            remaining = client.get("/comments", params={"test_id": test_id}).json()["comments"]
            self.assertEqual([c["comment_id"] for c in remaining], ["c2"])

    def test_edit_is_owner_scoped_and_flags_edited(self):
        with TestClient(self._app) as client:
            test_id = self._setup_alices_test(client)
            self.assertEqual(self._comment(client, "c1", test_id, "original").status_code, 200)

            # Alice (not the author) cannot change Bob's comment: server stamps her as
            # owner, which matches no row, so it is a harmless no-op (still 200).
            self._login_as(client, ALICE)
            self.assertEqual(self._edit(client, "c1", "hijacked").status_code, 200)
            comments = client.get("/comments", params={"test_id": test_id}).json()["comments"]
            self.assertEqual(comments[0]["body"], "original")
            self.assertFalse(comments[0]["edited"])

            # The author can, and the comment is flagged edited.
            self._login_as(client, BOB)
            self.assertEqual(self._edit(client, "c1", "fixed").status_code, 200)
            comments = client.get("/comments", params={"test_id": test_id}).json()["comments"]
            self.assertEqual(comments[0]["body"], "fixed")
            self.assertTrue(comments[0]["edited"])

    def test_delete_is_owner_scoped(self):
        with TestClient(self._app) as client:
            test_id = self._setup_alices_test(client)
            self.assertEqual(self._comment(client, "c1", test_id, "keep me").status_code, 200)
            # Alice cannot delete Bob's comment (no-op), the author can.
            self._login_as(client, ALICE)
            self.assertEqual(self._delete(client, "c1", tag="alice").status_code, 200)
            self.assertEqual(
                len(client.get("/comments", params={"test_id": test_id}).json()["comments"]), 1
            )
            self._login_as(client, BOB)
            self.assertEqual(self._delete(client, "c1", tag="bob").status_code, 200)
            self.assertEqual(
                client.get("/comments", params={"test_id": test_id}).json()["comments"], []
            )

    def test_over_length_body_is_rejected(self):
        with TestClient(self._app) as client:
            test_id = self._setup_alices_test(client)
            res = self._comment(client, "c1", test_id, "x" * 1001)
            self.assertEqual(res.status_code, 400)
            self.assertEqual(
                client.get("/comments", params={"test_id": test_id}).json()["comments"], []
            )


if __name__ == "__main__":
    unittest.main()
