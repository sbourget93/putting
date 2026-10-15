"""Daily Test aggregate: one row per (owner_sub, local calendar day).

A daily test is the container the 5-putt test batches hang off of. It carries no
state that isn't derivable from its batches. Completion and per-distance results
are all computed from the batches that reference this test's id (see
projections/batches.py), so its only event is its own creation. The test exists
to give those batches a stable id to point at and to record which local day it
belongs to. The client supplies `test_date`, since only the device knows its
timezone, and the test resets at local midnight.

`owner_sub` is the Google `sub` of the authoring account, stamped server-side from
the session (see routers/commands.py), so the client can't forge it. Queries filter
by `owner_sub` so each user sees only their own tests (see get_tests in putting.py).
"""

import sqlite3

# A day's optional message is shown alongside the owner's daily leaderboard score.
# Capped so a single row can never carry an unbounded blob (the UI truncates what
# it displays; this bounds what is stored). Kept in step with the frontend limit.
MESSAGE_MAX_LENGTH = 1000


def _required(payload: dict, key: str, event_type: str) -> str:
    value = (payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{event_type} requires a non-empty {key}")
    return value


SCHEMA = """
CREATE TABLE IF NOT EXISTS tests (
    test_id    TEXT PRIMARY KEY,
    owner_sub  TEXT NOT NULL,
    test_date  TEXT NOT NULL,
    message    TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

TABLES = ("tests",)


def _started(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _required(payload, "owner_sub", "TestStarted")
    test_date = _required(payload, "test_date", "TestStarted")
    # INSERT OR REPLACE keeps replay idempotent if a start is ever re-applied.
    conn.execute(
        "INSERT OR REPLACE INTO tests "
        "(test_id, owner_sub, test_date, message, created_at, updated_at, deleted_at) "
        "VALUES (?, ?, ?, NULL, ?, NULL, NULL)",
        (aggregate_id, owner_sub, test_date, created_at),
    )


def _message_set(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _required(payload, "owner_sub", "TestMessageSet")
    message = payload.get("message")
    if message is not None and not isinstance(message, str):
        raise ValueError("TestMessageSet requires a string message")
    message = (message or "").strip()
    if len(message) > MESSAGE_MAX_LENGTH:
        raise ValueError(f"TestMessageSet message must be at most {MESSAGE_MAX_LENGTH} characters")
    # An empty message clears the note (stored as NULL). A row this owner doesn't
    # have (missing or someone else's) matches nothing, so the set is a harmless
    # no-op, like the batch edit/delete handlers.
    conn.execute(
        "UPDATE tests SET message = ?, updated_at = ? WHERE test_id = ? AND owner_sub = ?",
        (message or None, created_at, aggregate_id, owner_sub),
    )


HANDLERS = {"TestStarted": _started, "TestMessageSet": _message_set}
