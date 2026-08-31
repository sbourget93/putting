"""Tests for the S3 event-log backup/compaction/restore (backend/s3_sync.py).

Uses an in-memory fake S3 client (no boto3, no network) and a temp SQLite file.
BLOCK_SIZE is overridden to a small value per test: the compaction logic is what
matters here, and the production value (1000) would mean thousands of inserts and
commits per test for no extra coverage.

Run (from the backend/ dir): python -m unittest tests.test_s3_sync
"""

import json
import os
import tempfile
import unittest

# Configure before importing the app modules: enable S3, isolate the DB file.
os.environ["S3_BUCKET"] = "test-bucket"
os.environ["S3_EVENTS_PREFIX"] = "events/"

import db  # noqa: E402
import s3_sync  # noqa: E402

TEST_BLOCK_SIZE = 10


class FakeS3:
    """Minimal in-memory stand-in for the boto3 S3 client used by s3_sync."""

    def __init__(self):
        self.store: dict[str, bytes] = {}
        self.fail_on_key = None  # set to a key to simulate a PUT failure

    def put_object(self, Bucket, Key, Body):
        if self.fail_on_key is not None and Key == self.fail_on_key:
            raise RuntimeError(f"simulated S3 outage on {Key}")
        self.store[Key] = Body

    def delete_objects(self, Bucket, Delete):
        for obj in Delete["Objects"]:
            self.store.pop(obj["Key"], None)

    def get_object(self, Bucket, Key):
        return {"Body": _Body(self.store[Key])}

    def get_paginator(self, _name):
        return _Paginator(self)


class _Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


class _Paginator:
    def __init__(self, client):
        self._client = client

    def paginate(self, Bucket, Prefix):
        contents = [{"Key": k} for k in sorted(self._client.store) if k.startswith(Prefix)]
        yield {"Contents": contents}


class S3SyncTest(unittest.TestCase):
    def setUp(self):
        # Fresh temp DB and fresh fake S3 per test.
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None
        db.get_connection().executescript(db.SCHEMA)

        self._real_block_size = s3_sync.BLOCK_SIZE
        s3_sync.BLOCK_SIZE = TEST_BLOCK_SIZE

        self.s3 = FakeS3()
        s3_sync.set_client_for_testing(self.s3)

    def tearDown(self):
        s3_sync.BLOCK_SIZE = self._real_block_size
        db._conn = None
        s3_sync.set_client_for_testing(None)
        os.unlink(self._tmp.name)

    # -- helpers ----------------------------------------------------------
    def _insert(self, n):
        """Append n simple events to the local log (seq assigned by SQLite)."""
        with db.transaction() as conn:
            for i in range(n):
                conn.execute(
                    "INSERT INTO events (event_id, event_type, aggregate_id, payload, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (f"evt-{i}", "TestEvent", f"agg-{i}", json.dumps({"n": i}), "2026-07-28T00:00:00Z"),
                )

    def _keys(self):
        return sorted(self.s3.store)

    def _fresh_db(self):
        """Point db at a brand-new empty file (simulates a fresh instance)."""
        db._conn = None
        os.unlink(self._tmp.name)
        self._tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self._tmp.close()
        db.DB_PATH = self._tmp.name
        db._conn = None
        db.get_connection().executescript(db.SCHEMA)

    # -- tests ------------------------------------------------------------
    def test_uploads_each_event_in_order(self):
        self._insert(5)
        s3_sync.sync_once()
        self.assertEqual(
            self._keys(),
            [f"events/{i:012d}.json" for i in range(1, 6)],
        )
        self.assertEqual(s3_sync._get_state("uploaded_through"), 5)

    def test_stops_at_gap_on_failure_then_recovers(self):
        self._insert(6)
        # seq 5's upload fails: 6 must NOT be uploaded ahead of it.
        self.s3.fail_on_key = "events/000000000005.json"
        s3_sync.sync_once()

        self.assertEqual(self._keys(), [f"events/{i:012d}.json" for i in range(1, 5)])
        self.assertEqual(s3_sync._get_state("uploaded_through"), 4)

        # Outage clears; next sweep fills 5 and 6 with no gap left behind.
        self.s3.fail_on_key = None
        s3_sync.sync_once()
        self.assertEqual(self._keys(), [f"events/{i:012d}.json" for i in range(1, 7)])
        self.assertEqual(s3_sync._get_state("uploaded_through"), 6)

    def test_compacts_full_blocks_and_deletes_singles(self):
        self._insert(25)
        s3_sync.sync_once()

        # 2 compacted blocks + 5 remaining singles = 7 objects.
        self.assertEqual(
            set(self._keys()),
            {
                "events/agg-000000000001-000000000010.json",
                "events/agg-000000000011-000000000020.json",
                "events/000000000021.json",
                "events/000000000022.json",
                "events/000000000023.json",
                "events/000000000024.json",
                "events/000000000025.json",
            },
        )
        self.assertEqual(s3_sync._get_state("merged_through"), 20)
        # The compacted object holds exactly its block of events.
        block1 = self.s3.store["events/agg-000000000001-000000000010.json"].decode()
        self.assertEqual(len(block1.strip().splitlines()), TEST_BLOCK_SIZE)

    def test_partial_block_is_not_compacted(self):
        # Compaction only fires on a full block, so a log shorter than BLOCK_SIZE
        # stays as one object per event. This is the steady state for a small app.
        self._insert(TEST_BLOCK_SIZE - 1)
        s3_sync.sync_once()

        self.assertEqual(s3_sync._get_state("merged_through"), 0)
        self.assertEqual(len(self._keys()), TEST_BLOCK_SIZE - 1)
        self.assertFalse([k for k in self._keys() if "agg-" in k])

    def test_restore_rebuilds_log_preserving_seq(self):
        # Populate S3 from one DB (with compaction), then restore into a fresh DB.
        self._insert(25)
        s3_sync.sync_once()

        self._fresh_db()
        s3_sync.restore_from_s3()

        with db.read() as conn:
            rows = conn.execute("SELECT seq, event_id FROM events ORDER BY seq").fetchall()
        self.assertEqual(len(rows), 25)
        self.assertEqual(rows[0]["seq"], 1)
        self.assertEqual(rows[-1]["seq"], 25)
        self.assertEqual(rows[0]["event_id"], "evt-0")
        # Cursors restored so the next sweep neither re-uploads nor re-compacts.
        self.assertEqual(s3_sync._get_state("uploaded_through"), 25)
        self.assertEqual(s3_sync._get_state("merged_through"), 20)

    def test_restore_survives_overlap_from_interrupted_compaction(self):
        # Simulate a crash mid-compaction: the agg object AND its singles both exist.
        self._insert(15)
        s3_sync.sync_once()  # compacts [1-10], leaves 11-15 as singles
        # Re-create the singles for the compacted block (as if the delete never ran).
        with db.read() as conn:
            rows = conn.execute("SELECT * FROM events WHERE seq <= 10 ORDER BY seq").fetchall()
        for r in rows:
            self.s3.store[f"events/{r['seq']:012d}.json"] = s3_sync._body_for([r])

        # The compacted block's singles are present alongside its agg object.
        self.assertIn("events/000000000001.json", self.s3.store)
        self.assertIn("events/agg-000000000001-000000000010.json", self.s3.store)

        self._fresh_db()
        s3_sync.restore_from_s3()
        with db.read() as conn:
            count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        self.assertEqual(count, 15)  # dedup by seq: no duplicates from the overlap

        # Orphaned singles inside the compacted block are cleaned up on restore...
        for seq in range(1, 11):
            self.assertNotIn(f"events/{seq:012d}.json", self.s3.store)
        # ...while the agg object and the still-uncompacted singles remain.
        self.assertIn("events/agg-000000000001-000000000010.json", self.s3.store)
        self.assertIn("events/000000000011.json", self.s3.store)


    def test_readonly_bootstraps_but_never_writes(self):
        # A QA box points at prod's prefix in read-only mode: it must restore the
        # log but never upload, compact, or delete anything under that prefix.
        self._insert(25)
        s3_sync.sync_once()  # seed S3 as if prod had written it
        seeded = dict(self.s3.store)

        s3_sync.READONLY = True
        try:
            # A fresh box with unsynced events: sync_once must be a total no-op...
            self._fresh_db()
            s3_sync.restore_from_s3()  # bootstrap still works
            with db.read() as conn:
                count = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            self.assertEqual(count, 25)

            # Force a full backlog to look unsynced: sync_once must still write
            # nothing (no uploads, no compaction, no deletes) under prod's prefix.
            s3_sync._set_state("uploaded_through", 0)
            s3_sync._set_state("merged_through", 0)
            s3_sync.sync_once()
            self.assertEqual(self.s3.store, seeded)  # S3 untouched

            # The background sync thread must not start in read-only mode.
            s3_sync.start_background_sync()
            self.assertIsNone(s3_sync._thread)
        finally:
            s3_sync.READONLY = False


if __name__ == "__main__":
    unittest.main()
