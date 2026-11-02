"""Tests for the test-comment projection.

A comment is cross-user: owner_sub is the commenter, test_id is whatever test is
being commented on. This suite confirms a comment is added, edited, length-capped,
and soft-deleted; that add/edit require a non-empty body; that edit and delete are
owner-scoped so only the author can change a comment; and that one user can comment
on another user's test. Run (from the backend/ dir):
python -m unittest tests.test_test_comments_projection
"""

import os
import tempfile
import unittest

import db  # noqa: E402
import projections  # noqa: E402
from projections.test_comments import BODY_MAX_LENGTH  # noqa: E402


class TestCommentsProjectionTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None
        db.get_connection().executescript(db.SCHEMA)

    def tearDown(self):
        db._conn = None
        os.unlink(self._tmp.name)

    def _apply(self, event_type, aggregate_id, payload, created_at="2026-08-22T09:00:00Z"):
        with db.transaction() as conn:
            projections.apply_event(conn, event_type, aggregate_id, payload, created_at)

    def _row(self, comment_id):
        with db.read() as conn:
            return conn.execute(
                "SELECT * FROM test_comments WHERE comment_id = ?", (comment_id,)
            ).fetchone()

    def test_added_records_author_test_and_body(self):
        self._apply(
            "TestCommentAdded",
            "c1",
            {"owner_sub": "sub-bob", "test_id": "t-alice", "body": "  nice round!  "},
        )
        row = self._row("c1")
        self.assertEqual(row["owner_sub"], "sub-bob")
        self.assertEqual(row["test_id"], "t-alice")
        self.assertEqual(row["body"], "nice round!")  # trimmed
        self.assertIsNone(row["updated_at"])
        self.assertIsNone(row["deleted_at"])

    def test_added_requires_test_and_body(self):
        with self.assertRaises(ValueError):
            self._apply("TestCommentAdded", "c1", {"owner_sub": "sub-bob", "body": "hi"})
        with self.assertRaises(ValueError):
            self._apply(
                "TestCommentAdded",
                "c1",
                {"owner_sub": "sub-bob", "test_id": "t-alice", "body": "   "},
            )

    def test_added_rejects_over_limit(self):
        with self.assertRaises(ValueError):
            self._apply(
                "TestCommentAdded",
                "c1",
                {"owner_sub": "sub-bob", "test_id": "t-alice", "body": "x" * (BODY_MAX_LENGTH + 1)},
            )

    def test_edit_updates_body_and_stamps_updated_at(self):
        self._apply(
            "TestCommentAdded",
            "c1",
            {"owner_sub": "sub-bob", "test_id": "t-alice", "body": "frist"},
        )
        self._apply(
            "TestCommentEdited",
            "c1",
            {"owner_sub": "sub-bob", "body": "fixed"},
            created_at="2026-08-22T10:00:00Z",
        )
        row = self._row("c1")
        self.assertEqual(row["body"], "fixed")
        self.assertEqual(row["updated_at"], "2026-08-22T10:00:00Z")

    def test_edit_is_owner_scoped(self):
        # An edit from another account matches no row and is a harmless no-op.
        self._apply(
            "TestCommentAdded",
            "c1",
            {"owner_sub": "sub-bob", "test_id": "t-alice", "body": "original"},
        )
        self._apply("TestCommentEdited", "c1", {"owner_sub": "sub-mallory", "body": "hijacked"})
        self.assertEqual(self._row("c1")["body"], "original")

    def test_delete_is_owner_scoped(self):
        self._apply(
            "TestCommentAdded",
            "c1",
            {"owner_sub": "sub-bob", "test_id": "t-alice", "body": "keep me"},
        )
        # Another account can't delete it.
        self._apply("TestCommentDeleted", "c1", {"owner_sub": "sub-mallory"})
        self.assertIsNone(self._row("c1")["deleted_at"])
        # The author can.
        self._apply(
            "TestCommentDeleted",
            "c1",
            {"owner_sub": "sub-bob"},
            created_at="2026-08-22T11:00:00Z",
        )
        self.assertEqual(self._row("c1")["deleted_at"], "2026-08-22T11:00:00Z")

    def test_can_comment_on_another_users_test(self):
        # No ownership check ties a comment's author to the test it's on.
        self._apply(
            "TestCommentAdded",
            "c1",
            {"owner_sub": "sub-bob", "test_id": "t-alice", "body": "well played"},
        )
        row = self._row("c1")
        self.assertEqual(row["owner_sub"], "sub-bob")
        self.assertEqual(row["test_id"], "t-alice")


if __name__ == "__main__":
    unittest.main()
