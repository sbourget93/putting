"""SQLite access: the append-only event store plus the projection tables.

The events table is the single source of truth (never updated or deleted).
Projection tables are derived read models, rebuilt from the log by `replay()`.
Both live in the same SQLite file; see AGENTS.md for the event-sourcing design.
"""

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

# Safe at module scope: the projections package depends on nothing in this
# module (handlers receive a connection), so there is no import cycle.
import projections

# DB_PATH lets prod/tests override the location. Locally the compose bind-mount
# (../backend:/app) persists this file on the host across container restarts.
DB_PATH = os.environ.get("DB_PATH", "app.db")

# Single shared connection guarded by one lock. Few admins and a low-concurrency
# workload, so serializing all DB access is simplest and perfectly adequate.
_conn: sqlite3.Connection | None = None
_lock = threading.Lock()

# Tables this module owns. Both carry the repo-wide metadata columns (see
# documentation/models/README.md). Events are immutable and never deleted, so
# their updated_at/deleted_at are always NULL — present for uniformity, not use.
# Projection DDL comes from the aggregate modules, so adding an aggregate never
# means editing this file.
CORE_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     TEXT NOT NULL UNIQUE,
    event_type   TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT,
    deleted_at   TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
    key        TEXT PRIMARY KEY,
    value      INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    deleted_at TEXT
);
"""

SCHEMA = CORE_SCHEMA + projections.SCHEMA


def utc_now() -> str:
    """Server-side timestamp for metadata columns, in the same format clients send.

    Only for rows the server originates (sync_state). Event metadata always comes
    from the client's `created_at`, so that a write composed offline keeps the time
    it actually happened rather than the time it reached us.
    """
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Serialize DB access and commit atomically (rolling back on error).

    This is what makes a command batch all-or-nothing: any exception raised
    inside the block — including the HTTPException a rejected event triggers —
    rolls the whole batch back.
    """
    conn = get_connection()
    with _lock:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


@contextmanager
def read() -> Iterator[sqlite3.Connection]:
    """Serialize read-only DB access (no commit)."""
    conn = get_connection()
    with _lock:
        yield conn


def init_db() -> None:
    """Create tables if needed, restore the log from S3 if empty, then replay."""
    conn = get_connection()
    with _lock:
        conn.executescript(SCHEMA)
        conn.commit()
    _restore_if_empty()
    replay()


def _restore_if_empty() -> None:
    # Fresh instance (prod runs with no volume): pull the event log back from S3
    # before replay rebuilds the projections. No-op when the log already exists or
    # S3 is disabled. Imported lazily to avoid a circular import at module load.
    conn = get_connection()
    with _lock:
        events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    if events > 0:
        return
    import s3_sync

    s3_sync.restore_from_s3()


def replay() -> None:
    """Rebuild every projection table by folding the event log in seq order.

    Runs only when the log has events but the projections are empty — e.g. a
    fresh instance that just restored the log from S3, or projections that were
    deliberately dropped. A normal restart finds them populated and skips.
    """
    if not projections.TABLES:
        return
    with transaction() as conn:
        events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        if events == 0:
            return
        # Table names come from the projection registry, never from user input.
        projected = sum(
            conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in projections.TABLES
        )
        if projected > 0:
            return
        rows = conn.execute(
            "SELECT event_type, aggregate_id, payload, created_at FROM events ORDER BY seq"
        ).fetchall()
        for row in rows:
            projections.apply_event(
                conn,
                row["event_type"],
                row["aggregate_id"],
                json.loads(row["payload"]),
                row["created_at"],
            )
