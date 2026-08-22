"""FastAPI app: CQRS command + query endpoints over the event-sourced store.

The command endpoint accepts events and returns only success/failure. Query
endpoints return data and never mutate. See AGENTS.md for the full architecture.

Routes have NO `/api` prefix: the gateway strips it before proxying, so define
routes as `/commands`, `/foos`, etc.
"""

import json
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

import auth
import db
import s3_sync
from projections import KNOWN_EVENT_TYPES, apply_event


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()  # restores the event log from S3 (if empty) before replay
    s3_sync.start_background_sync()
    yield
    s3_sync.stop_background_sync()


app = FastAPI(lifespan=lifespan)

# Signed session cookie holding the Google identity. max_age ~10 years keeps
# users logged in effectively indefinitely; sessions stay valid only while
# SESSION_SECRET is unchanged, so store it outside the deploy (e.g. SSM) and
# reuse it across releases.
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("SESSION_SECRET", "dev-insecure-secret"),
    max_age=10 * 365 * 24 * 3600,
    same_site="lax",
    https_only=os.environ.get("COOKIE_SECURE", "0") == "1",
)

app.include_router(auth.router)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class CommandEvent(BaseModel):
    event_id: str             # client-generated UUID (idempotency key)
    type: str                 # event type; must have a registered projection handler
    aggregate_id: str         # client-generated UUID of the target aggregate
    data: dict | None = None  # event payload; the per-aggregate handler validates it
    created_at: str


class CommandRequest(BaseModel):
    events: list[CommandEvent]


# ---------------------------------------------------------------------------
# Command endpoint (writes)
# ---------------------------------------------------------------------------
@app.post("/commands", dependencies=[Depends(auth.require_admin)])
def post_commands(req: CommandRequest):
    """Append a batch of client events, then project them. Atomic all-or-nothing.

    Admin-only (see auth.require_admin): non-admins are rejected with 403 before
    any write. Aggregate-agnostic: any event whose type has a registered
    projection handler is accepted.

    There is no concurrency check — writes are last-write-wins, ordered by the
    seq SQLite assigns on arrival. Retries are safe because events already in the
    log are skipped by event_id, and a rejected batch leaves no partial state
    because the whole thing runs in one transaction.
    """
    with db.transaction() as conn:
        for event in req.events:
            if event.type not in KNOWN_EVENT_TYPES:
                raise HTTPException(status_code=400, detail=f"Unknown event type: {event.type}")

            # Idempotency: an event already recorded (e.g. a retry after a lost
            # ack) is skipped rather than duplicated.
            already = conn.execute(
                "SELECT 1 FROM events WHERE event_id = ?", (event.event_id,)
            ).fetchone()
            if already:
                continue

            payload = event.data or {}
            try:
                conn.execute(
                    "INSERT INTO events (event_id, event_type, aggregate_id, payload, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (event.event_id, event.type, event.aggregate_id, json.dumps(payload), event.created_at),
                )
                apply_event(conn, event.type, event.aggregate_id, payload, event.created_at)
            except ValueError as exc:
                # Per-aggregate projection validation rejected the payload.
                raise HTTPException(status_code=400, detail=str(exc))

        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    # Best-effort: nudge the background loop to back the new events up to S3.
    # Never blocks or fails the write — the local commit above is the durable point.
    s3_sync.request_sync()
    return {"status": "ok", "version": version}


# ---------------------------------------------------------------------------
# Query endpoints (reads)
# ---------------------------------------------------------------------------
@app.get("/events", dependencies=[Depends(auth.require_admin)])
def get_events(since: int = 0):
    """Events with seq > `since`, plus the current version.

    Admin-only. This returns raw event payloads — including fields `/foos` hides
    from non-admins (e.g. private_value) — so it must not be readable by them.
    The client does not read from here (it syncs from the per-aggregate projection
    queries like `/foos`); this endpoint is for replay/debugging.
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


@app.get("/foos")
def get_foos(request: Request):
    """Template-only: all non-deleted foos, plus the current version.

    `public_value` is returned to everyone; `private_value` is included only for
    admins (auth.is_admin, decided live from the email allowlist). This is the
    reason a foo carries two values at all — it demonstrates gating a read.

    The query stays open (no require_admin) so anyone can see the public data; we
    filter the sensitive field per-request instead of rejecting the whole call.

    Delete alongside projections/foo.py once the app has an aggregate of its own.
    """
    admin = auth.is_admin(request)
    with db.read() as conn:
        rows = conn.execute(
            "SELECT foo_id, public_value, private_value FROM foos "
            "WHERE deleted_at IS NULL ORDER BY created_at"
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    foos = []
    for r in rows:
        foo = {"foo_id": r["foo_id"], "public_value": r["public_value"]}
        if admin:
            foo["private_value"] = r["private_value"]
        foos.append(foo)
    return {"version": version, "foos": foos}
