"""Tests for the putts projection: validation and per-owner isolation.

Applies events through projections.apply_event against a temp SQLite file, so it
needs no HTTP layer. The owner-scoping assertions prove an edit or delete can only
touch a row whose owner matches the event.

Run (from the backend/ dir): python -m unittest tests.test_putts_projection
"""

import os
import tempfile
import unittest

import db  # noqa: E402
import projections  # noqa: E402

ALICE = "alice@example.com"
BOB = "bob@example.com"


class PuttsProjectionTest(unittest.TestCase):
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

    def _row(self, putt_id):
        with db.read() as conn:
            return conn.execute(
                "SELECT * FROM putts WHERE putt_id = ?", (putt_id,)
            ).fetchone()

    def _putt(self, **overrides):
        payload = {"owner_sub": ALICE, "batch_id": "b1", "made": True, "number": None, "miss_type": None}
        payload.update(overrides)
        return payload

    # -- recording --------------------------------------------------------
    def test_putt_is_recorded_with_its_batch_id(self):
        self._apply("PuttRecorded", "p1", self._putt())
        row = self._row("p1")
        self.assertEqual(row["batch_id"], "b1")
        self.assertEqual(row["made"], 1)
        self.assertIsNone(row["number"])
        self.assertIsNone(row["miss_type"])

    def test_shadow_putt_has_null_number_and_miss_type(self):
        # The non-opted-in case: we know it went in, not which putt or where it missed.
        self._apply("PuttRecorded", "p1", self._putt(made=False))
        row = self._row("p1")
        self.assertEqual(row["made"], 0)
        self.assertIsNone(row["number"])
        self.assertIsNone(row["miss_type"])

    def test_opted_in_number_and_miss_type_are_accepted(self):
        self._apply("PuttRecorded", "p1", self._putt(made=False, number=3, miss_type="LOW_LEFT"))
        row = self._row("p1")
        self.assertEqual((row["number"], row["miss_type"]), (3, "LOW_LEFT"))

    def test_non_boolean_made_is_rejected(self):
        # made is a flag, not a count — reject the int the batch projection accepts.
        with self.assertRaises(ValueError):
            self._apply("PuttRecorded", "p1", self._putt(made=1))

    def test_number_out_of_range_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("PuttRecorded", "p1", self._putt(number=0))
        with self.assertRaises(ValueError):
            self._apply("PuttRecorded", "p2", self._putt(number=6))

    def test_unknown_miss_type_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("PuttRecorded", "p1", self._putt(miss_type="SIDEWAYS"))

    def test_missing_batch_id_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("PuttRecorded", "p1", self._putt(batch_id=""))

    def test_missing_owner_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("PuttRecorded", "p1", self._putt(owner_sub=""))

    # -- editing ----------------------------------------------------------
    def test_edit_updates_fields_and_stamps_updated_at(self):
        self._apply("PuttRecorded", "p1", self._putt(made=True))
        self._apply(
            "PuttEdited",
            "p1",
            {"owner_sub": ALICE, "made": False, "number": 2, "miss_type": "HIGH"},
            "2026-08-23T00:00:00Z",
        )
        row = self._row("p1")
        self.assertEqual((row["made"], row["number"], row["miss_type"]), (0, 2, "HIGH"))
        self.assertEqual(row["updated_at"], "2026-08-23T00:00:00Z")

    def test_edit_by_a_different_owner_is_a_noop(self):
        self._apply("PuttRecorded", "p1", self._putt(owner_sub=ALICE, made=True))
        self._apply("PuttEdited", "p1", {"owner_sub": BOB, "made": False, "number": None, "miss_type": None})
        row = self._row("p1")
        self.assertEqual(row["made"], 1)  # unchanged
        self.assertIsNone(row["updated_at"])

    # -- deleting ---------------------------------------------------------
    def test_delete_sets_a_timestamp(self):
        self._apply("PuttRecorded", "p1", self._putt())
        self._apply("PuttDeleted", "p1", {"owner_sub": ALICE}, "2026-08-24T00:00:00Z")
        self.assertEqual(self._row("p1")["deleted_at"], "2026-08-24T00:00:00Z")

    def test_delete_by_a_different_owner_is_a_noop(self):
        self._apply("PuttRecorded", "p1", self._putt(owner_sub=ALICE))
        self._apply("PuttDeleted", "p1", {"owner_sub": BOB})
        self.assertIsNone(self._row("p1")["deleted_at"])


if __name__ == "__main__":
    unittest.main()
