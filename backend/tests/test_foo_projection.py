"""Tests for the demo aggregate's projection and for replay.

The foo-specific assertions are throwaway (delete them with projections/foo.py),
but the replay test is not: it covers the mechanism every aggregate depends on —
rebuilding the read model from the event log after an S3 restore.

Uses a temp SQLite file and applies events through projections.apply_event, so it
needs no fastapi/HTTP layer and runs in base python like the other suites.

Run (from the backend/ dir): python -m unittest tests.test_foo_projection
"""

import json
import os
import tempfile
import unittest

import db  # noqa: E402
import projections  # noqa: E402


class FooProjectionTest(unittest.TestCase):
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
    def _apply(self, event_type, aggregate_id, payload, created_at="2026-07-28T00:00:00Z"):
        with db.transaction() as conn:
            projections.apply_event(conn, event_type, aggregate_id, payload, created_at)

    def _rows(self):
        with db.read() as conn:
            return conn.execute(
                "SELECT foo_id, public_value, private_value, updated_at, deleted_at "
                "FROM foos ORDER BY created_at"
            ).fetchall()

    # -- projection -------------------------------------------------------
    def test_created_with_both_values(self):
        self._apply("FooCreated", "f1", {"public_value": "shown", "private_value": "hidden"})

        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["public_value"], "shown")
        self.assertEqual(rows[0]["private_value"], "hidden")

    def test_private_value_is_optional(self):
        self._apply("FooCreated", "f1", {"public_value": "shown"})
        self.assertEqual(self._rows()[0]["private_value"], "")

    def test_each_event_changes_only_its_own_field(self):
        # The point of narrow events under last-write-wins: changing one value
        # must not carry the other along.
        self._apply("FooCreated", "f1", {"public_value": "shown", "private_value": "hidden"})
        self._apply(
            "FooPublicValueChanged", "f1", {"public_value": "changed"}, "2026-07-29T00:00:00Z"
        )

        row = self._rows()[0]
        self.assertEqual(row["public_value"], "changed")
        self.assertEqual(row["private_value"], "hidden")
        self.assertEqual(row["updated_at"], "2026-07-29T00:00:00Z")

    def test_private_value_can_be_cleared(self):
        self._apply("FooCreated", "f1", {"public_value": "shown", "private_value": "hidden"})
        self._apply("FooPrivateValueChanged", "f1", {"private_value": "  "})
        self.assertEqual(self._rows()[0]["private_value"], "")

    def test_delete_is_a_timestamp_not_a_row_removal(self):
        self._apply("FooCreated", "f1", {"public_value": "shown"})
        self._apply("FooDeleted", "f1", {}, "2026-07-30T00:00:00Z")

        rows = self._rows()
        self.assertEqual(len(rows), 1)  # row survives; only deleted_at is set
        self.assertEqual(rows[0]["deleted_at"], "2026-07-30T00:00:00Z")

    def test_blank_public_value_is_rejected(self):
        # Handlers own payload validation; the command endpoint turns this into a 400.
        with self.assertRaises(ValueError):
            self._apply("FooCreated", "f1", {"public_value": "   "})

    def test_unknown_event_type_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("NotARealEvent", "f1", {})

    # -- replay -----------------------------------------------------------
    def test_replay_rebuilds_projections_from_the_log(self):
        events = [
            ("e1", "FooCreated", "f1", {"public_value": "one", "private_value": "secret"}),
            ("e2", "FooCreated", "f2", {"public_value": "two"}),
            ("e3", "FooPublicValueChanged", "f1", {"public_value": "one changed"}),
            ("e4", "FooDeleted", "f2", {}),
        ]
        with db.transaction() as conn:
            for event_id, event_type, aggregate_id, payload in events:
                conn.execute(
                    "INSERT INTO events (event_id, event_type, aggregate_id, payload, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (event_id, event_type, aggregate_id, json.dumps(payload), "2026-07-28T00:00:00Z"),
                )
            # Projections empty but the log intact: the state a fresh instance is
            # in after restoring from S3.
            conn.execute("DELETE FROM foos")

        db.replay()

        rows = self._rows()
        self.assertEqual([r["foo_id"] for r in rows], ["f1", "f2"])
        self.assertEqual(rows[0]["public_value"], "one changed")
        self.assertEqual(rows[0]["private_value"], "secret")
        self.assertIsNotNone(rows[1]["deleted_at"])

    def test_replay_skips_when_projections_are_already_populated(self):
        # A normal restart must not re-fold the log over a live read model.
        with db.transaction() as conn:
            conn.execute(
                "INSERT INTO events (event_id, event_type, aggregate_id, payload, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    "e1",
                    "FooPublicValueChanged",
                    "f1",
                    json.dumps({"public_value": "from-log"}),
                    "2026-07-28T00:00:00Z",
                ),
            )
        self._apply("FooCreated", "f1", {"public_value": "live"})

        db.replay()

        self.assertEqual(self._rows()[0]["public_value"], "live")


if __name__ == "__main__":
    unittest.main()
