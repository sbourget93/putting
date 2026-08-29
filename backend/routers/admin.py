"""Admin-only diagnostics: the raw event log and the raw table viewer.

Every route here is gated by `require_admin` at the router level, so each one need
not repeat it. These endpoints deliberately surface data kept off the client
elsewhere — whole event payloads, one player's raw rows — so the gate is the point.
"""

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

import auth
import db
from projections import TABLES as PROJECTION_TABLES

router = APIRouter(dependencies=[Depends(auth.require_admin)])

# Tables an admin may browse raw in the data viewer: the two core tables db.py owns
# plus every registered projection. This fixed allowlist is what makes it safe to
# interpolate a table name into the query — a table name cannot be a bound parameter
# — so any name outside it is rejected before any SQL is built.
ADMIN_TABLES = ("events", "sync_state", *PROJECTION_TABLES)

# Owner-scoped tables: every browsable table except the two not owned by a user (the
# users directory itself and the sync cursors). Browsing one of these requires an
# owner, so a raw dump is always one person's data (see get_admin_table).
OWNER_TABLES = frozenset(ADMIN_TABLES) - {"users", "sync_state"}

# The data viewer returns only recent rows — the last 30 days by created_at — rather
# than a fixed row cap, so an old event log never builds an unbounded response.
DATA_WINDOW_DAYS = 30


@router.get("/events")
def get_events(since: int = 0):
    """Events with seq > `since`, plus the current version.

    Admin-only. This returns raw event payloads, so it must not be readable by
    non-admins. The client does not read from here (it syncs from the per-aggregate
    projection queries like `/batches`); this endpoint is for replay/debugging.
    """
    with db.read() as conn:
        rows = conn.execute(
            "SELECT seq, event_id, event_type, aggregate_id, payload, created_at "
            "FROM events WHERE seq > ? ORDER BY seq",
            (since,),
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    events = [
        {
            "seq": r["seq"],
            "event_id": r["event_id"],
            "type": r["event_type"],
            "aggregate_id": r["aggregate_id"],
            "data": json.loads(r["payload"]),
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    return {"version": version, "events": events}


@router.get("/admin/tables")
def get_admin_tables():
    """The names of the tables an admin may browse raw (see ADMIN_TABLES). Admin only."""
    return {"tables": list(ADMIN_TABLES)}


@router.get("/admin/tables/{table}")
def get_admin_table(table: str, sub: str | None = None):
    """One table's columns and rows, raw. Admin only.

    `table` must be one of ADMIN_TABLES; any other name is rejected before a query is
    built, since a table name cannot be a bound parameter. Rows come back newest first
    (by rowid, which is seq order for the append-only events table).

    An owner-scoped table (OWNER_TABLES) requires `?sub=`, a player's public Google
    sub, and returns only that owner's rows. The sub is the owner key itself (the
    `owner_sub` column, or `owner_sub` inside the payload for events), so no lookup is
    needed. Those tables can grow without bound, so they are also windowed to the
    last DATA_WINDOW_DAYS. The users directory and sync cursors are neither
    owner-scoped nor windowed: they are small and returned in full (`window_days`
    is null for them).

    This is a raw diagnostic view, so it deliberately surfaces data kept off the
    client elsewhere — whole event payloads — and is strictly admin-gated.
    """
    if table not in ADMIN_TABLES:
        raise HTTPException(status_code=404, detail="Unknown table")

    windowed = table in OWNER_TABLES
    clauses: list[str] = []
    params: list = []

    with db.read() as conn:
        if windowed:
            if not sub:
                raise HTTPException(status_code=400, detail="An owner is required for this table")
            owner_row = conn.execute(
                "SELECT sub FROM users WHERE sub = ? AND deleted_at IS NULL", (sub,)
            ).fetchone()
            if owner_row is None:
                raise HTTPException(status_code=404, detail="Unknown user")
            # events keep the owner_sub inside the JSON payload; the projections have a
            # dedicated owner_sub column. Either way the owner key is the sub itself.
            clauses.append(
                "json_extract(payload, '$.owner_sub') = ?" if table == "events" else "owner_sub = ?"
            )
            params.append(sub)
            # Owner-scoped tables can grow without bound, so window them to recent
            # rows. The users directory and sync cursors are small and shown in full.
            cutoff = (
                (datetime.now(timezone.utc) - timedelta(days=DATA_WINDOW_DAYS))
                .isoformat()
                .replace("+00:00", "Z")
            )
            clauses.append("created_at >= ?")
            params.append(cutoff)

        where = f"WHERE {' AND '.join(clauses)} " if clauses else ""
        # table is allowlisted above, so interpolating it is safe.
        columns = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        rows = conn.execute(
            f"SELECT * FROM {table} {where}ORDER BY rowid DESC", params
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    return {
        "version": version,
        "table": table,
        "columns": columns,
        "rows": [dict(r) for r in rows],
        "count": len(rows),
        "window_days": DATA_WINDOW_DAYS if windowed else None,
    }
