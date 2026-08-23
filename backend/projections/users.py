"""User identity aggregate: one row per Google account.

Lets the app show a friendly display name for whoever's putting data is on screen
instead of their email. Identity otherwise lives only in the signed-in device's
session cookie (see auth.py), which no one else can read, so it has to reach the
event log to become queryable.

Keyed by `sub`, Google's stable per-account id, which never changes even if the
user later changes their email or name (unlike email, which the rest of the
schema keys `owner` on). `email` is carried as a column so this projection still
joins to the email-keyed `tests`/`batches` data.

The single event is `UserSignedIn`, enqueued by the client through the normal
offline engine right after a successful Google login. `owner` (the email) is
stamped server-side and is authoritative; `name`/`picture` come from the client's
verified Google profile. Only admins can write, so only admins are recorded, which
is exactly who has putting data to display.
"""

import sqlite3


def _required(payload: dict, key: str, event_type: str) -> str:
    value = (payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{event_type} requires a non-empty {key}")
    return value


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    sub        TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    name       TEXT NOT NULL,
    picture    TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

TABLES = ("users",)


def _signed_in(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    sub = _required({"sub": aggregate_id}, "sub", "UserSignedIn")
    email = _required(payload, "owner", "UserSignedIn")
    name = (payload.get("name") or email).strip()
    picture = payload.get("picture")
    # First sign-in inserts; later ones refresh the mutable profile fields and
    # stamp updated_at, keeping the original created_at. Replay applies events in
    # seq order, so the last write wins deterministically.
    conn.execute(
        """
        INSERT INTO users (sub, email, name, picture, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(sub) DO UPDATE SET
            email = excluded.email,
            name = excluded.name,
            picture = excluded.picture,
            updated_at = excluded.created_at,
            deleted_at = NULL
        """,
        (sub, email, name, picture, created_at),
    )


HANDLERS = {"UserSignedIn": _signed_in}
