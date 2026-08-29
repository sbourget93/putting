"""Tests for the batches projection: validation and per-owner isolation.

Applies events through projections.apply_event against a temp SQLite file, so it
needs no HTTP layer. The owner-scoping assertions are
the important ones: they prove an edit or delete can only touch a row whose owner
matches the event, which is what keeps one user out of another's data.

Run (from the backend/ dir): python -m unittest tests.test_batches_projection
"""

import os
import tempfile
import unittest

import db  # noqa: E402
import projections  # noqa: E402

ALICE = "alice@example.com"
BOB = "bob@example.com"


class BatchesProjectionTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None
        db.get_connection().executescript(db.SCHEMA)

    def tearDown(self):
        db._conn = None
        os.unlink(self._tmp.name)

    # -- helpers ----------------------------------------------------------
    def _apply(self, event_type, aggregate_id, payload, created_at="2026-08-22T00:00:00Z"):
        with db.transaction() as conn:
            projections.apply_event(conn, event_type, aggregate_id, payload, created_at)

    def _row(self, batch_id):
        with db.read() as conn:
            return conn.execute(
                "SELECT * FROM batches WHERE batch_id = ?", (batch_id,)
            ).fetchone()

    def _batch(self, **overrides):
        payload = {"owner_sub": ALICE, "test_id": "t1", "distance": 20, "batch_size": 5, "made": 3}
        payload.update(overrides)
        return payload

    # -- recording --------------------------------------------------------
    def test_batch_is_recorded_with_its_test_id(self):
        self._apply("BatchRecorded", "b1", self._batch())
        row = self._row("b1")
        self.assertEqual(row["test_id"], "t1")
        self.assertEqual((row["distance"], row["batch_size"], row["made"]), (20, 5, 3))

    def test_batch_without_a_test_id_is_allowed(self):
        # test_id is optional (the two legacy pre-test rows carry none).
        self._apply("BatchRecorded", "b1", self._batch(test_id=""))
        self.assertIsNone(self._row("b1")["test_id"])

    def test_any_positive_batch_size_is_accepted(self):
        # Not restricted to the daily test's 5, so the legacy batches of 10 replay.
        self._apply("BatchRecorded", "b1", self._batch(batch_size=10, made=7))
        self.assertEqual(self._row("b1")["batch_size"], 10)

    def test_zero_batch_size_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("BatchRecorded", "b1", self._batch(batch_size=0, made=0))

    def test_distance_out_of_range_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("BatchRecorded", "b1", self._batch(distance=11))
        with self.assertRaises(ValueError):
            self._apply("BatchRecorded", "b2", self._batch(distance=34))

    def test_made_cannot_exceed_batch_size(self):
        with self.assertRaises(ValueError):
            self._apply("BatchRecorded", "b1", self._batch(made=6))

    def test_non_integer_made_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("BatchRecorded", "b1", self._batch(made="lots"))

    def test_missing_owner_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("BatchRecorded", "b1", self._batch(owner_sub=""))

    # -- editing ----------------------------------------------------------
    def test_edit_updates_fields_and_stamps_updated_at(self):
        self._apply("BatchRecorded", "b1", self._batch())
        self._apply(
            "BatchEdited",
            "b1",
            {"owner_sub": ALICE, "distance": 30, "batch_size": 5, "made": 4},
            "2026-08-23T00:00:00Z",
        )
        row = self._row("b1")
        self.assertEqual((row["distance"], row["made"]), (30, 4))
        self.assertEqual(row["updated_at"], "2026-08-23T00:00:00Z")

    def test_edit_by_a_different_owner_is_a_noop(self):
        self._apply("BatchRecorded", "b1", self._batch(owner_sub=ALICE))
        # Bob forges Alice's batch_id; the owner-scoped UPDATE matches nothing.
        self._apply("BatchEdited", "b1", {"owner_sub": BOB, "distance": 30, "batch_size": 5, "made": 0})
        row = self._row("b1")
        self.assertEqual(row["made"], 3)  # unchanged
        self.assertIsNone(row["updated_at"])

    # -- deleting ---------------------------------------------------------
    def test_delete_sets_a_timestamp(self):
        self._apply("BatchRecorded", "b1", self._batch())
        self._apply("BatchDeleted", "b1", {"owner_sub": ALICE}, "2026-08-24T00:00:00Z")
        self.assertEqual(self._row("b1")["deleted_at"], "2026-08-24T00:00:00Z")

    def test_delete_by_a_different_owner_is_a_noop(self):
        self._apply("BatchRecorded", "b1", self._batch(owner_sub=ALICE))
        self._apply("BatchDeleted", "b1", {"owner_sub": BOB})
        self.assertIsNone(self._row("b1")["deleted_at"])


if __name__ == "__main__":
    unittest.main()
