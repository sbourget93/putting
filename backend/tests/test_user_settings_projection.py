"""Tests for the user_settings projection: validation, upsert, and per-owner isolation.

Applies events through projections.apply_event against a temp SQLite file, so it
needs no HTTP layer. The upsert assertions prove a user keeps one row per setting,
and the owner-scoping assertion proves two users' settings never collide.

Run (from the backend/ dir): python -m unittest tests.test_user_settings_projection
"""

import os
import tempfile
import unittest

import db  # noqa: E402
import projections  # noqa: E402

ALICE = "alice@example.com"
BOB = "bob@example.com"


class UserSettingsProjectionTest(unittest.TestCase):
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
    def _apply(self, event_type, aggregate_id, payload, created_at="2026-10-12T00:00:00Z"):
        with db.transaction() as conn:
            projections.apply_event(conn, event_type, aggregate_id, payload, created_at)

    def _rows(self, owner_sub):
        with db.read() as conn:
            return conn.execute(
                "SELECT * FROM user_settings WHERE owner_sub = ? ORDER BY name",
                (owner_sub,),
            ).fetchall()

    def _setting(self, **overrides):
        payload = {"owner_sub": ALICE, "name": "track_misses", "value": True}
        payload.update(overrides)
        return payload

    # -- recording --------------------------------------------------------
    def test_change_inserts_a_row(self):
        self._apply("UserSettingChanged", "s1", self._setting(value=True))
        rows = self._rows(ALICE)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "track_misses")
        self.assertEqual(rows[0]["value"], 1)

    def test_toggling_updates_the_same_row(self):
        # A second change for the same (owner, name) updates in place, keeping the
        # original id, rather than adding a row.
        self._apply("UserSettingChanged", "s1", self._setting(value=True))
        self._apply(
            "UserSettingChanged", "s2", self._setting(value=False), "2026-10-13T00:00:00Z"
        )
        rows = self._rows(ALICE)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["user_setting_id"], "s1")
        self.assertEqual(rows[0]["value"], 0)
        self.assertEqual(rows[0]["updated_at"], "2026-10-13T00:00:00Z")

    def test_each_owner_keeps_their_own_row(self):
        self._apply("UserSettingChanged", "s1", self._setting(owner_sub=ALICE, value=True))
        self._apply("UserSettingChanged", "s2", self._setting(owner_sub=BOB, value=False))
        self.assertEqual(self._rows(ALICE)[0]["value"], 1)
        self.assertEqual(self._rows(BOB)[0]["value"], 0)

    # -- validation -------------------------------------------------------
    def test_unknown_setting_name_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("UserSettingChanged", "s1", self._setting(name="track_everything"))

    def test_non_boolean_value_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("UserSettingChanged", "s1", self._setting(value=1))

    def test_missing_owner_is_rejected(self):
        with self.assertRaises(ValueError):
            self._apply("UserSettingChanged", "s1", self._setting(owner_sub=""))


if __name__ == "__main__":
    unittest.main()
