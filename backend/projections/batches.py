"""Putt-batch aggregate: one recorded set of putts thrown from a single distance.

A batch is the app's core write. A batch carries the `test_id` of the daily test it
belongs to (see projections/tests.py). Everything the app shows is derived by
querying these rows: history, per-distance make %, and daily-test progress.

`owner_sub` is the Google `sub` of the authoring account, stamped server-side from
the session (see routers/commands.py), never trusted from the client. The edit and
delete handlers scope their writes by `owner_sub` as well as id, so one user's event
can only ever touch that user's own batch. A forged aggregate_id updates zero rows
rather than another user's data.

The projection owns payload validation, and a ValueError here becomes a 400. A putt
is thrown from a 12-33 ft circle-1 distance, in a batch of at least one, and `made`
never exceeds the batch size. (Validation intentionally accepts any batch size, not
only the daily test's 5, so the two legacy pre-test rows — batches of 10 — still
replay from the immutable event log.)
"""

import sqlite3

TEST_MIN, TEST_MAX = 12, 33
# How many distances a full daily test covers (12-33 ft inclusive). A test is
# "complete" once it has a putt recorded at every one of these; stats count only
# complete tests. Derived, never stored (see documentation/models/projections/tests.md).
TEST_DISTANCE_COUNT = TEST_MAX - TEST_MIN + 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
    batch_id   TEXT PRIMARY KEY,
    owner_sub  TEXT NOT NULL,
    test_id    TEXT,
    distance   INTEGER NOT NULL,
    batch_size INTEGER NOT NULL,
    made       INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

TABLES = ("batches",)


def _owner_sub(payload: dict, event_type: str) -> str:
    owner_sub = (payload.get("owner_sub") or "").strip()
    if not owner_sub:
        raise ValueError(f"{event_type} requires a non-empty owner_sub")
    return owner_sub


def _int(payload: dict, key: str, event_type: str) -> int:
    value = payload.get(key)
    # JSON numbers arrive as int already; reject bools, floats, strings, and None.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{event_type} requires an integer {key}")
    return value


def _validate(distance: int, batch_size: int, made: int, event_type: str) -> None:
    if not (TEST_MIN <= distance <= TEST_MAX):
        raise ValueError(f"{event_type} distance must be {TEST_MIN}-{TEST_MAX} ft")
    if batch_size < 1:
        raise ValueError(f"{event_type} batch size must be at least 1")
    if not (0 <= made <= batch_size):
        raise ValueError(f"{event_type} made must be between 0 and the batch size")


def _recorded(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "BatchRecorded")
    test_id = (payload.get("test_id") or "").strip() or None
    distance = _int(payload, "distance", "BatchRecorded")
    batch_size = _int(payload, "batch_size", "BatchRecorded")
    made = _int(payload, "made", "BatchRecorded")
    _validate(distance, batch_size, made, "BatchRecorded")
    # INSERT OR REPLACE keeps replay idempotent if a record is ever re-applied.
    conn.execute(
        "INSERT OR REPLACE INTO batches "
        "(batch_id, owner_sub, test_id, distance, batch_size, made, "
        "created_at, updated_at, deleted_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
        (aggregate_id, owner_sub, test_id, distance, batch_size, made, created_at),
    )


def _edited(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "BatchEdited")
    # A row this owner doesn't have (missing or someone else's) matches nothing, and
    # the edit is a harmless no-op. test_id is fixed at record time and never edited.
    row = conn.execute(
        "SELECT 1 FROM batches WHERE batch_id = ? AND owner_sub = ?",
        (aggregate_id, owner_sub),
    ).fetchone()
    if row is None:
        return
    distance = _int(payload, "distance", "BatchEdited")
    batch_size = _int(payload, "batch_size", "BatchEdited")
    made = _int(payload, "made", "BatchEdited")
    _validate(distance, batch_size, made, "BatchEdited")
    conn.execute(
        "UPDATE batches SET distance = ?, batch_size = ?, made = ?, updated_at = ? "
        "WHERE batch_id = ? AND owner_sub = ?",
        (distance, batch_size, made, created_at, aggregate_id, owner_sub),
    )


def _deleted(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "BatchDeleted")
    conn.execute(
        "UPDATE batches SET deleted_at = ? WHERE batch_id = ? AND owner_sub = ?",
        (created_at, aggregate_id, owner_sub),
    )


HANDLERS = {
    "BatchRecorded": _recorded,
    "BatchEdited": _edited,
    "BatchDeleted": _deleted,
}
