"""The write path: `POST /commands`.

Accepts a batch of client events, stamps the authoring owner, appends them to the
event log, and projects them — all in one transaction. Signed-in writers only.
See the backend AGENTS.md for the CQRS/event-sourcing architecture.
"""

import json
from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import auth
import db
import s3_sync
from projections import KNOWN_EVENT_TYPES, apply_event

router = APIRouter()

# Event types no generic write path may accept, even though they have a registered
# projection handler (needed for replay). These are issued only by their own
# privileged, server-side endpoints — e.g. UserRoleChanged comes from the op-gated
# POST /users/{sub}/role — so neither a user (via POST /commands) nor an admin (via
# the replay endpoint) can forge one to, say, promote an account.
SERVER_ONLY_EVENT_TYPES = frozenset({"UserRoleChanged"})


class CommandEvent(BaseModel):
    event_id: str             # client-generated UUID (idempotency key)
    type: str                 # event type; must have a registered projection handler
    aggregate_id: str         # client-generated UUID of the target aggregate
    data: dict | None = None  # event payload; the per-aggregate handler validates it
    created_at: str


class CommandRequest(BaseModel):
    events: list[CommandEvent]


def ingest_events(
    conn,
    events: list[CommandEvent],
    payload_for: Callable[[CommandEvent], dict],
) -> int:
    """Append and project a batch of client events in the given transaction.

    The shared core of every write path. The caller owns the transaction (so the
    whole batch is atomic) and supplies `payload_for`, which returns the payload to
    persist for one event. That is the ONLY place the paths differ: POST /commands
    stamps the signed-in user's owner_sub (ignoring any client value), while the
    admin replay path keeps each event's own owner_sub so a backfill lands under
    the original author.

    Unknown event types are a 400 and the server-only types a 403; an event whose
    event_id is already in the log is skipped (idempotent retries); a payload the
    per-aggregate handler rejects is a 400. Returns the new log version (max seq).
    """
    for event in events:
        if event.type not in KNOWN_EVENT_TYPES:
            raise HTTPException(status_code=400, detail=f"Unknown event type: {event.type}")
        if event.type in SERVER_ONLY_EVENT_TYPES:
            raise HTTPException(
                status_code=403, detail=f"Event type not allowed here: {event.type}"
            )

        # Idempotency: an event already recorded (e.g. a retry after a lost ack, or
        # a backfill file replayed twice) is skipped rather than duplicated.
        already = conn.execute(
            "SELECT 1 FROM events WHERE event_id = ?", (event.event_id,)
        ).fetchone()
        if already:
            continue

        payload = payload_for(event)
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

    return conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]


@router.post("/commands", dependencies=[Depends(auth.require_writer)])
def post_commands(req: CommandRequest, request: Request):
    """Append a batch of client events, then project them. Atomic all-or-nothing.

    Signed-in writers only (see auth.require_writer): a signed-out visitor, or one
    downgraded to the read-only `public` role, is rejected with 403 before any
    write. Aggregate-agnostic: any event whose type has a registered projection
    handler is accepted, except the server-only types (SERVER_ONLY_EVENT_TYPES,
    e.g. UserRoleChanged) which have their own privileged endpoints and are refused
    here so a user cannot forge one to escalate their own role.

    Every event is stamped server-side with `owner_sub`, the signed-in user's stable
    Google `sub`, overwriting anything the client sent. That is what ties each write
    to its author and lets the projections enforce per-user isolation (an edit or
    delete can only touch a row whose owner_sub matches). The stamped payload is what
    gets persisted, so replay reproduces the same ownership.

    There is no concurrency check. Writes are last-write-wins, ordered by the seq
    SQLite assigns on arrival. Retries are safe because events already in the log
    are skipped by event_id, and a rejected batch leaves no partial state because
    the whole thing runs in one transaction.
    """
    user = auth.current_user(request) or {}
    owner_sub = user.get("sub") or ""
    with db.transaction() as conn:
        # Server-stamped owner_sub is authoritative: never trust a client-supplied
        # one. Persisted into the event so replay keeps the same ownership.
        version = ingest_events(
            conn,
            req.events,
            lambda event: {**(event.data or {}), "owner_sub": owner_sub},
        )

    # Best-effort: nudge the background loop to back the new events up to S3.
    # Never blocks or fails the write — the local commit above is the durable point.
    s3_sync.request_sync()
    return {"status": "ok", "version": version}
