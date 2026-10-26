"""User-data aggregate: one stored free-form value per user per key.

A generic per-user key/value store for small bits of user-authored content that
don't warrant their own table. Today the only key is `notes` (the player's private
putting notes). It sits alongside user_settings rather than replacing it: settings
are typed booleans (`0`/`1`), while user_data holds free text, so the two keep
separate contracts. The model is documented in
documentation/models/projections/user_data.md.

`owner_sub` is the Google `sub` of the owning account, stamped server-side from the
session (see routers/commands.py), never trusted from the client. One row per
`(owner_sub, key)` is enforced by a unique index: a `UserDataChanged` upserts onto
that pair, so repeated edits update the same record (keeping its original
`user_data_id`) rather than piling up rows. This module owns payload validation; a
ValueError here becomes a 400.
"""

import sqlite3

# Keys the app understands. Like user_settings' KNOWN_SETTINGS, this is an allowlist
# so a typo never silently persists a value nothing reads. Kept in step with the
# frontend DATA_KEYS and the user_data.md model doc. Add a key here to introduce one
# — no migration needed, since the table is already generic.
KNOWN_KEYS = frozenset({"notes"})

# A per-value ceiling. The event log is backed up to S3, so an unbounded blob would
# bloat the durable store; this keeps any single value sane without being a real
# limit for the notes use case.
MAX_VALUE_LEN = 10_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS user_data (
    user_data_id TEXT PRIMARY KEY,
    owner_sub    TEXT NOT NULL,
    key          TEXT NOT NULL,
    value        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT,
    deleted_at   TEXT,
    UNIQUE (owner_sub, key)
);
"""

TABLES = ("user_data",)


def _owner_sub(payload: dict, event_type: str) -> str:
    owner_sub = (payload.get("owner_sub") or "").strip()
    if not owner_sub:
        raise ValueError(f"{event_type} requires a non-empty owner_sub")
    return owner_sub


def _key(payload: dict, event_type: str) -> str:
    key = (payload.get("key") or "").strip()
    if key not in KNOWN_KEYS:
        raise ValueError(f"{event_type} key must be one of {sorted(KNOWN_KEYS)}")
    return key


def _value(payload: dict, event_type: str) -> str:
    value = payload.get("value")
    if not isinstance(value, str):
        raise ValueError(f"{event_type} requires a string value")
    if len(value) > MAX_VALUE_LEN:
        raise ValueError(f"{event_type} value exceeds {MAX_VALUE_LEN} characters")
    return value


def _changed(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "UserDataChanged")
    key = _key(payload, "UserDataChanged")
    value = _value(payload, "UserDataChanged")
    # Upsert on (owner_sub, key): the first write for a key inserts, later ones refresh
    # the value and stamp updated_at, keeping the original user_data_id and created_at.
    # Replay applies events in seq order, so the last write wins.
    conn.execute(
        """
        INSERT INTO user_data
            (user_data_id, owner_sub, key, value, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(owner_sub, key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.created_at,
            deleted_at = NULL
        """,
        (aggregate_id, owner_sub, key, value, created_at),
    )


HANDLERS = {"UserDataChanged": _changed}
