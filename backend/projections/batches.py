"""Putt-batch aggregate: one recorded set of putts thrown from a single distance.

A batch is the app's core write. `kind` is `free` (ad-hoc practice) or `test` (a
slot in a daily test). A test batch carries the `test_id` of the daily test it
belongs to (see projections/tests.py); a free batch carries none. Everything the
app shows is derived by querying these rows: history, per-distance make %, and
daily-test progress.

`owner` is stamped server-side from the session (see main.post_commands), never
trusted from the client. The edit and delete handlers scope their writes by owner
as well as id, so one user's event can only ever touch that user's own batch. A
forged aggregate_id updates zero rows rather than another user's data.

The projection owns payload validation, and a ValueError here becomes a 400. Free
putts are 10-60 ft with any batch size, test putts are 12-33 ft in a fixed batch
of 5, and `made` never exceeds the batch size.
"""

import sqlite3

FREE_MIN, FREE_MAX = 10, 60
TEST_MIN, TEST_MAX = 12, 33
TEST_BATCH_SIZE = 5

SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
    batch_id   TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    kind       TEXT NOT NULL,
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


def _owner(payload: dict, event_type: str) -> str:
    owner = (payload.get("owner") or "").strip()
    if not owner:
        raise ValueError(f"{event_type} requires a non-empty owner")
    return owner


def _int(payload: dict, key: str, event_type: str) -> int:
    value = payload.get(key)
    # JSON numbers arrive as int already; reject bools, floats, strings, and None.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{event_type} requires an integer {key}")
    return value


def _validate(
    kind: str, test_id: str | None, distance: int, batch_size: int, made: int, event_type: str
) -> None:
    if kind not in ("free", "test"):
        raise ValueError(f"{event_type} has invalid kind {kind!r}")
    if kind == "test":
        if not test_id:
            raise ValueError(f"{event_type} of kind test requires a test_id")
        if batch_size != TEST_BATCH_SIZE:
            raise ValueError(f"a test batch is always {TEST_BATCH_SIZE} putts")
        if not (TEST_MIN <= distance <= TEST_MAX):
            raise ValueError(f"test distance must be {TEST_MIN}-{TEST_MAX} ft")
    else:
        if not (FREE_MIN <= distance <= FREE_MAX):
            raise ValueError(f"free distance must be {FREE_MIN}-{FREE_MAX} ft")
        if batch_size < 1:
            raise ValueError("batch size must be at least 1")
    if not (0 <= made <= batch_size):
        raise ValueError("made must be between 0 and the batch size")


def _recorded(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner = _owner(payload, "BatchRecorded")
    kind = (payload.get("kind") or "").strip()
    test_id = (payload.get("test_id") or "").strip() or None
    distance = _int(payload, "distance", "BatchRecorded")
    batch_size = _int(payload, "batch_size", "BatchRecorded")
    made = _int(payload, "made", "BatchRecorded")
    _validate(kind, test_id, distance, batch_size, made, "BatchRecorded")
    # INSERT OR REPLACE keeps replay idempotent if a record is ever re-applied.
    conn.execute(
        "INSERT OR REPLACE INTO batches "
        "(batch_id, owner, kind, test_id, distance, batch_size, made, "
        "created_at, updated_at, deleted_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
        (aggregate_id, owner, kind, test_id, distance, batch_size, made, created_at),
    )


def _edited(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner = _owner(payload, "BatchEdited")
    # kind/test_id are fixed at record time and never edited, so validate the new
    # values against the existing row. A row this owner doesn't have (missing or
    # someone else's) matches nothing, and the edit is a harmless no-op.
    row = conn.execute(
        "SELECT kind, test_id FROM batches WHERE batch_id = ? AND owner = ?",
        (aggregate_id, owner),
    ).fetchone()
    if row is None:
        return
    distance = _int(payload, "distance", "BatchEdited")
    batch_size = _int(payload, "batch_size", "BatchEdited")
    made = _int(payload, "made", "BatchEdited")
    _validate(row["kind"], row["test_id"], distance, batch_size, made, "BatchEdited")
    conn.execute(
        "UPDATE batches SET distance = ?, batch_size = ?, made = ?, updated_at = ? "
        "WHERE batch_id = ? AND owner = ?",
        (distance, batch_size, made, created_at, aggregate_id, owner),
    )


def _deleted(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner = _owner(payload, "BatchDeleted")
    conn.execute(
        "UPDATE batches SET deleted_at = ? WHERE batch_id = ? AND owner = ?",
        (created_at, aggregate_id, owner),
    )


HANDLERS = {
    "BatchRecorded": _recorded,
    "BatchEdited": _edited,
    "BatchDeleted": _deleted,
}
