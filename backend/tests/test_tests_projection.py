"""Tests for the daily-test projection.

The aggregate is deliberately thin (its only event is TestStarted), so this suite
is small: it confirms the row is written with its owner and local date, and that a
start is required to carry both. Run (from the backend/ dir):
python -m unittest tests.test_tests_projection
"""

import os
import tempfile
import unittest

import db  # noqa: E402
import projections  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
