"""Test-comment aggregate: one comment left on a daily test's leaderboard row.

Unlike the rest of the schema, a comment is cross-user: `owner_sub` is the Google
`sub` of the *commenter* (stamped server-side from the session, see
routers/commands.py), while `test_id` points at whatever test is being commented on,
which usually belongs to a different player. There is intentionally no check that the
commenter owns the test, so anyone can comment on anyone's test. The edit and delete
handlers still scope their writes by `owner_sub`, so a comment can only ever be
changed or removed by the account that wrote it. A forged aggregate_id touches zero
rows rather than someone else's comment.

Comments are shown only on the daily leaderboard (see routers/putting.py), in server
arrival order. The row stores no author name or picture: those are joined from the
users projection at read time, so a commenter's current identity is always shown.

The projection owns payload validation, and a ValueError here becomes a 400.
"""

import sqlite3

# A comment's maximum length. Capped so a single row can never carry an unbounded
# blob. Kept in step with the frontend limit.
BODY_MAX_LENGTH = 1000


def _required(payload: dict, key: str, event_type: str) -> str:
    value = (payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{event_type} requires a non-empty {key}")
    return value


def _body(payload: dict, event_type: str) -> str:
    body = payload.get("body")
    if not isinstance(body, str):
        raise ValueError(f"{event_type} requires a string body")
    body = body.strip()
    if not body:
        raise ValueError(f"{event_type} requires a non-empty body")
    if len(body) > BODY_MAX_LENGTH:
        raise ValueError(f"{event_type} body must be at most {BODY_MAX_LENGTH} characters")
    return body


SCHEMA = """
CREATE TABLE IF NOT EXISTS test_comments (
    comment_id TEXT PRIMARY KEY,
    owner_sub  TEXT NOT NULL,
    test_id    TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

TABLES = ("test_comments",)


def _added(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _required(payload, "owner_sub", "TestCommentAdded")
    test_id = _required(payload, "test_id", "TestCommentAdded")
    body = _body(payload, "TestCommentAdded")
    # INSERT OR REPLACE keeps replay idempotent if an add is ever re-applied.
    conn.execute(
        "INSERT OR REPLACE INTO test_comments "
        "(comment_id, owner_sub, test_id, body, created_at, updated_at, deleted_at) "
        "VALUES (?, ?, ?, ?, ?, NULL, NULL)",
        (aggregate_id, owner_sub, test_id, body, created_at),
    )


def _edited(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _required(payload, "owner_sub", "TestCommentEdited")
    body = _body(payload, "TestCommentEdited")
    # A comment this owner doesn't have (missing or someone else's) matches nothing,
    # so the edit is a harmless no-op. test_id is fixed at add time and never edited.
    conn.execute(
        "UPDATE test_comments SET body = ?, updated_at = ? "
        "WHERE comment_id = ? AND owner_sub = ?",
        (body, created_at, aggregate_id, owner_sub),
    )


def _deleted(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _required(payload, "owner_sub", "TestCommentDeleted")
    conn.execute(
        "UPDATE test_comments SET deleted_at = ? WHERE comment_id = ? AND owner_sub = ?",
        (created_at, aggregate_id, owner_sub),
    )


HANDLERS = {
    "TestCommentAdded": _added,
    "TestCommentEdited": _edited,
    "TestCommentDeleted": _deleted,
}
