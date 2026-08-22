"""Template-only demo aggregate: a list of "foos".

Exists so the command -> event -> projection -> query path can be exercised end
to end before the app has a real aggregate (see the frontend's TemplateTestPage).
Delete this module and drop it from `_MODULES` once you have one of your own; it
is the worked example for adding an aggregate.

A foo carries two values: `public_value` and `private_value`. The split exists to
demonstrate gating a read: `GET /foos` returns `public_value` to everyone but
includes `private_value` only for admins (see get_foos in main.py). The
projection itself stores both the same way — the gating lives in the query.

Note the event vocabulary: each edit event names the single field it changes
rather than a fat `FooEdited` carrying the whole row. Under last-write-wins that
matters — two concurrent edits to different fields overwrite each other only if
the events are wide (see AGENTS.md). Editing both values at once is therefore two
events in one batch, which the command endpoint applies atomically.

Metadata columns follow the repo convention: the creation event sets
`created_at`, edits set `updated_at`, and a delete sets `deleted_at` (NULL means
active). Soft delete is a timestamp, never a boolean.
"""

import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS foos (
    foo_id        TEXT PRIMARY KEY,
    public_value  TEXT NOT NULL,
    private_value TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT,
    deleted_at    TEXT
);
"""

TABLES = ("foos",)


def _required(payload: dict, key: str, event_type: str) -> str:
    # Handlers own payload validation: a ValueError here becomes a 400 on the
    # command endpoint, and the whole batch is rolled back.
    value = (payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{event_type} requires a non-empty {key}")
    return value


def _optional(payload: dict, key: str) -> str:
    # Blank is a legitimate value here — it means "no private value".
    return (payload.get(key) or "").strip()


def _created(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    public_value = _required(payload, "public_value", "FooCreated")
    private_value = _optional(payload, "private_value")
    # INSERT OR REPLACE keeps replay idempotent if a create is ever re-applied.
    conn.execute(
        "INSERT OR REPLACE INTO foos "
        "(foo_id, public_value, private_value, created_at, updated_at, deleted_at) "
        "VALUES (?, ?, ?, ?, NULL, NULL)",
        (aggregate_id, public_value, private_value, created_at),
    )


def _public_value_changed(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    public_value = _required(payload, "public_value", "FooPublicValueChanged")
    conn.execute(
        "UPDATE foos SET public_value = ?, updated_at = ? WHERE foo_id = ?",
        (public_value, created_at, aggregate_id),
    )


def _private_value_changed(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    private_value = _optional(payload, "private_value")
    conn.execute(
        "UPDATE foos SET private_value = ?, updated_at = ? WHERE foo_id = ?",
        (private_value, created_at, aggregate_id),
    )


def _deleted(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    conn.execute(
        "UPDATE foos SET deleted_at = ? WHERE foo_id = ?",
        (created_at, aggregate_id),
    )


HANDLERS = {
    "FooCreated": _created,
    "FooPublicValueChanged": _public_value_changed,
    "FooPrivateValueChanged": _private_value_changed,
    "FooDeleted": _deleted,
}
