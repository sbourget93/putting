"""User identity aggregate: one row per Google account.

Lets the app show a friendly display name for whoever's putting data is on screen.
Identity otherwise lives only in the signed-in device's session cookie (see
auth.py), which no one else can read, so it has to reach the event log to become
queryable. No email is stored here (or anywhere): the row holds only the public
`sub`/`name`/`picture`, so the projection is safe to expose and safe to leak.

Keyed by `sub`, Google's stable per-account id, which never changes even if the
user later changes their email or name. `sub` is also what the rest of the schema
keys `owner` on, so this projection joins to `tests`/`batches` directly on `sub`.

`UserSignedIn` is enqueued by the client through the normal offline engine right
after a successful Google login. `owner_sub` (the signer's `sub`, equal to the
aggregate id here) is stamped server-side; `name`/`picture` come from the client's
verified Google profile. Any signed-in user is recorded, since anyone signed in can
write their own data.

`role` is the stored authorization role (`user` by default, or `op`). `admin` is
never stored here — it is the live `ADMIN_SUBS` overlay (see auth.is_admin). The
role changes only via `UserRoleChanged`, which the op-gated `POST /users/{sub}/role`
endpoint issues; it is refused on the self-service `POST /commands` path so a user
cannot promote themselves.
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
    name       TEXT NOT NULL,
    picture    TEXT,
    role       TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

TABLES = ("users",)

# Roles a user may be assigned in the projection. `public` is the signed-in but
# read-only downgrade; `user` (the default) and `op` can write. `admin` is
# intentionally absent: it is the live ADMIN_SUBS overlay, never a stored value.
ASSIGNABLE_ROLES = ("public", "user", "op")


def _signed_in(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    sub = _required({"sub": aggregate_id}, "sub", "UserSignedIn")
    name = (payload.get("name") or "Player").strip()
    picture = payload.get("picture")
    # First sign-in inserts; later ones refresh the mutable profile fields and
    # stamp updated_at, keeping the original created_at. Replay applies events in
    # seq order, so the last write wins deterministically.
    conn.execute(
        """
        INSERT INTO users (sub, name, picture, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(sub) DO UPDATE SET
            name = excluded.name,
            picture = excluded.picture,
            updated_at = excluded.created_at,
            deleted_at = NULL
        """,
        (sub, name, picture, created_at),
    )


def _role_changed(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    """Set a user's stored role. Issued only by the op-gated role endpoint, never
    accepted on `POST /commands` (see main.SERVER_ONLY_EVENT_TYPES), so a user
    cannot promote themselves. The target is the aggregate id (their `sub`); the
    stamped `owner_sub` is the acting op/admin and is not used here."""
    sub = _required({"sub": aggregate_id}, "sub", "UserRoleChanged")
    role = (payload.get("role") or "").strip().lower()
    if role not in ASSIGNABLE_ROLES:
        raise ValueError(
            f"UserRoleChanged requires role in {'|'.join(ASSIGNABLE_ROLES)}, got {role!r}"
        )
    updated = conn.execute(
        "UPDATE users SET role = ?, updated_at = ? WHERE sub = ? AND deleted_at IS NULL",
        (role, created_at, sub),
    ).rowcount
    if updated == 0:
        raise ValueError(f"UserRoleChanged for unknown user {sub!r}")


HANDLERS = {"UserSignedIn": _signed_in, "UserRoleChanged": _role_changed}
