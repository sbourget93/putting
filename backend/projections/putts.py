"""Putt aggregate: one row per individual putt, grouped under a batch.

Today putts are written in "shadow mode": the client emits five PuttRecorded
events alongside each BatchRecorded, with `number`/`miss_type` null. Nothing reads
them yet; individual-putt tracking fills those in and reads them later. The model
is documented in documentation/models/projections/putts.md; this module owns the
payload validation (a ValueError here becomes a 400).
"""

import sqlite3

# Kept in step with the frontend MissType union and the putts.md model doc.
MISS_TYPES = frozenset(
    {
        "HIGH",
        "LOW",
        "LEFT",
        "RIGHT",
        "HIGH_LEFT",
        "HIGH_RIGHT",
        "LOW_LEFT",
        "LOW_RIGHT",
        "SPIT_OUT",
    }
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS putts (
    putt_id    TEXT PRIMARY KEY,
    owner_sub  TEXT NOT NULL,
    batch_id   TEXT NOT NULL,
    number     INTEGER,
    made       INTEGER NOT NULL,
    miss_type  TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

TABLES = ("putts",)


def _owner_sub(payload: dict, event_type: str) -> str:
    owner_sub = (payload.get("owner_sub") or "").strip()
    if not owner_sub:
        raise ValueError(f"{event_type} requires a non-empty owner_sub")
    return owner_sub


def _bool(payload: dict, key: str, event_type: str) -> bool:
    value = payload.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{event_type} requires a boolean {key}")
    return value


def _opt_number(payload: dict, event_type: str) -> int | None:
    value = payload.get("number")
    if value is None:
        return None
    # JSON numbers arrive as int already; reject bools, floats, strings.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{event_type} number must be an integer or null")
    if not (1 <= value <= 5):
        raise ValueError(f"{event_type} number must be 1-5")
    return value


def _opt_miss_type(payload: dict, event_type: str) -> str | None:
    value = payload.get("miss_type")
    if value is None:
        return None
    if value not in MISS_TYPES:
        raise ValueError(f"{event_type} miss_type must be null or one of {sorted(MISS_TYPES)}")
    return value


def _recorded(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "PuttRecorded")
    batch_id = (payload.get("batch_id") or "").strip()
    if not batch_id:
        raise ValueError("PuttRecorded requires a non-empty batch_id")
    made = _bool(payload, "made", "PuttRecorded")
    number = _opt_number(payload, "PuttRecorded")
    miss_type = _opt_miss_type(payload, "PuttRecorded")
    # INSERT OR REPLACE keeps replay idempotent if a record is ever re-applied.
    conn.execute(
        "INSERT OR REPLACE INTO putts "
        "(putt_id, owner_sub, batch_id, number, made, miss_type, "
        "created_at, updated_at, deleted_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
        (aggregate_id, owner_sub, batch_id, number, int(made), miss_type, created_at),
    )


def _edited(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "PuttEdited")
    # A row this owner doesn't have (missing or someone else's) matches nothing, and
    # the edit is a harmless no-op. batch_id is fixed at record time and never edited.
    row = conn.execute(
        "SELECT 1 FROM putts WHERE putt_id = ? AND owner_sub = ?",
        (aggregate_id, owner_sub),
    ).fetchone()
    if row is None:
        return
    made = _bool(payload, "made", "PuttEdited")
    number = _opt_number(payload, "PuttEdited")
    miss_type = _opt_miss_type(payload, "PuttEdited")
    conn.execute(
        "UPDATE putts SET number = ?, made = ?, miss_type = ?, updated_at = ? "
        "WHERE putt_id = ? AND owner_sub = ?",
        (number, int(made), miss_type, created_at, aggregate_id, owner_sub),
    )


def _deleted(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "PuttDeleted")
    conn.execute(
        "UPDATE putts SET deleted_at = ? WHERE putt_id = ? AND owner_sub = ?",
        (created_at, aggregate_id, owner_sub),
    )


HANDLERS = {
    "PuttRecorded": _recorded,
    "PuttEdited": _edited,
    "PuttDeleted": _deleted,
}
