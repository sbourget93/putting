"""Tests for the daily-test projection.

The aggregate is thin: TestStarted writes the row, and TestMessageSet updates its
optional message. This suite confirms the row carries its owner and local date,
that a start requires both, and that a message is set, cleared, length-capped, and
owner-scoped. Run (from the backend/ dir):
python -m unittest tests.test_tests_projection
"""

import os
import tempfile
import unittest

import db  # noqa: E402
import projections  # noqa: E402
from projections.tests import MESSAGE_MAX_LENGTH  # noqa: E402


class TestsProjectionTest(unittest.TestCase):
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

    def test_started_records_owner_and_date(self):
        self._apply("TestStarted", "t1", {"owner_sub": "sub-alice", "test_date": "2026-08-22"})
        with db.read() as conn:
            row = conn.execute("SELECT * FROM tests WHERE test_id = ?", ("t1",)).fetchone()
        self.assertEqual(row["owner_sub"], "sub-alice")
        self.assertEqual(row["test_date"], "2026-08-22")

    def test_started_requires_a_date(self):
        with self.assertRaises(ValueError):
            self._apply("TestStarted", "t1", {"owner_sub": "sub-alice"})

    def test_started_requires_an_owner(self):
        with self.assertRaises(ValueError):
            self._apply("TestStarted", "t1", {"test_date": "2026-08-22"})

    def test_message_set_and_cleared(self):
        self._apply("TestStarted", "t1", {"owner_sub": "sub-alice", "test_date": "2026-08-22"})
        self._apply("TestMessageSet", "t1", {"owner_sub": "sub-alice", "message": "  new PB!  "})
        with db.read() as conn:
            row = conn.execute("SELECT message FROM tests WHERE test_id = ?", ("t1",)).fetchone()
        self.assertEqual(row["message"], "new PB!")  # trimmed
        # An empty message clears the note back to NULL.
        self._apply("TestMessageSet", "t1", {"owner_sub": "sub-alice", "message": "   "})
        with db.read() as conn:
            row = conn.execute("SELECT message FROM tests WHERE test_id = ?", ("t1",)).fetchone()
        self.assertIsNone(row["message"])

    def test_message_rejects_over_limit(self):
        self._apply("TestStarted", "t1", {"owner_sub": "sub-alice", "test_date": "2026-08-22"})
        with self.assertRaises(ValueError):
            self._apply(
                "TestMessageSet",
                "t1",
                {"owner_sub": "sub-alice", "message": "x" * (MESSAGE_MAX_LENGTH + 1)},
            )

    def test_message_is_owner_scoped(self):
        # A set from another owner matches no row and is a harmless no-op.
        self._apply("TestStarted", "t1", {"owner_sub": "sub-alice", "test_date": "2026-08-22"})
        self._apply("TestMessageSet", "t1", {"owner_sub": "sub-mallory", "message": "hi"})
        with db.read() as conn:
            row = conn.execute("SELECT message FROM tests WHERE test_id = ?", ("t1",)).fetchone()
        self.assertIsNone(row["message"])


if __name__ == "__main__":
    unittest.main()
