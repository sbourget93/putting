"""Daily Test aggregate: one row per (owner, local calendar day).

A daily test is the container the 5-putt test batches hang off of. It carries no
state that isn't derivable from its batches. Completion and per-distance results
are all computed from the batches that reference this test's id (see
projections/batches.py), so its only event is its own creation. The test exists
to give those batches a stable id to point at and to record which local day it
belongs to. The client supplies `test_date`, since only the device knows its
timezone, and the test resets at local midnight.

`owner` is stamped server-side from the session (see main.post_commands), so the
client can't forge it. Queries filter by owner so each user sees only their own
tests (see get_tests in main.py).
"""

import sqlite3


def _required(payload: dict, key: str, event_type: str) -> str:
    value = (payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{event_type} requires a non-empty {key}")
    return value


SCHEMA = """
CREATE TABLE IF NOT EXISTS tests (
    test_id    TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    test_date  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

TABLES = ("tests",)


def _started(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner = _required(payload, "owner", "TestStarted")
    test_date = _required(payload, "test_date", "TestStarted")
    # INSERT OR REPLACE keeps replay idempotent if a start is ever re-applied.
    conn.execute(
        "INSERT OR REPLACE INTO tests "
        "(test_id, owner, test_date, created_at, updated_at, deleted_at) "
        "VALUES (?, ?, ?, ?, NULL, NULL)",
        (aggregate_id, owner, test_date, created_at),
    )


HANDLERS = {"TestStarted": _started}
