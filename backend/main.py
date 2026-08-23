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

# Whose data an unauthenticated (or non-admin) visitor reads: the public demo
# account. Only admins can write, so a non-admin never has data of their own to
# show, and this is what makes the app browsable signed-out. Configurable so a
# fork can point the demo at its own account.
DEMO_OWNER_EMAIL = os.environ.get("DEMO_OWNER_EMAIL", "sbourget93@gmail.com").lower()


def _read_owner(request: Request) -> str:
    """Whose rows a read returns: your own if you are an admin, else the demo owner.

    Admins read and write their own data through the offline engine. Everyone else
    (logged out, or signed in but not on the allowlist) can only read, and only
    the demo owner's data.
    """
    if auth.is_admin(request):
        user = auth.current_user(request) or {}
        return (user.get("email") or "").lower()
    return DEMO_OWNER_EMAIL


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
def post_commands(req: CommandRequest, request: Request):
    """Append a batch of client events, then project them. Atomic all-or-nothing.

    Admin-only (see auth.require_admin): non-admins are rejected with 403 before
    any write. Aggregate-agnostic: any event whose type has a registered
    projection handler is accepted.

    Every event is stamped server-side with `owner`, the signed-in admin's email,
    overwriting anything the client sent. That is what ties each write to its
    author and lets the projections enforce per-user isolation (an edit or delete
    can only touch a row whose owner matches). The stamped payload is what gets
    persisted, so replay reproduces the same ownership.

    There is no concurrency check. Writes are last-write-wins, ordered by the seq
    SQLite assigns on arrival. Retries are safe because events already in the log
    are skipped by event_id, and a rejected batch leaves no partial state because
    the whole thing runs in one transaction.
    """
    user = auth.current_user(request) or {}
    owner = (user.get("email") or "").lower()
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

            # Server-stamped owner is authoritative: never trust a client-supplied
            # one. Persisted into the event so replay keeps the same ownership.
            payload = {**(event.data or {}), "owner": owner}
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


def _owner_name(conn, owner: str) -> str | None:
    """Display name for an owner email, from the users projection, or None.

    Email is the internal owner key, but another user's email must never reach the
    client. So the owner-scoped query endpoints expose this resolved name instead
    of the email when the viewer is looking at someone else's data."""
    row = conn.execute(
        "SELECT name FROM users WHERE email = ? AND deleted_at IS NULL", (owner,)
    ).fetchone()
    return row["name"] if row else None


@app.get("/users")
def get_users():
    """Known user identities (from UserSignedIn), plus the current version.

    Public so any viewer can render a display name for whoever's data is on screen.
    Only `sub`/`name`/`picture` are exposed — never `email` (see projections/users.py).
    The offline engine calls this as its `users` snapshot.
    """
    with db.read() as conn:
        rows = conn.execute(
            "SELECT sub, name, picture FROM users "
            "WHERE deleted_at IS NULL ORDER BY created_at"
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {"version": version, "users": [dict(r) for r in rows]}


@app.get("/batches")
def get_batches(request: Request):
    """Active putt batches for the resolved owner, plus the current version.

    Owner-scoped (see _read_owner): an admin gets their own batches, everyone else
    gets the demo owner's. The offline engine calls this as its `batches` snapshot;
    non-admin pages read it online. Soft-deleted rows are omitted.

    Returns `owner_name` (a display name), never the owner email, so browsing
    another user's data never leaks their email.
    """
    owner = _read_owner(request)
    with db.read() as conn:
        rows = conn.execute(
            "SELECT batch_id, kind, test_id, distance, batch_size, made, created_at, updated_at "
            "FROM batches WHERE owner = ? AND deleted_at IS NULL ORDER BY created_at",
            (owner,),
        ).fetchall()
        owner_name = _owner_name(conn, owner)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {"version": version, "owner_name": owner_name, "batches": [dict(r) for r in rows]}


@app.get("/tests")
def get_tests(request: Request):
    """Active daily tests for the resolved owner, plus the current version.

    Owner-scoped like /batches. The client maps a test to its batches by test_id to
    compute daily-test progress. Returns `owner_name`, never the owner email.
    """
    owner = _read_owner(request)
    with db.read() as conn:
        rows = conn.execute(
            "SELECT test_id, test_date, created_at, updated_at "
            "FROM tests WHERE owner = ? AND deleted_at IS NULL ORDER BY test_date",
            (owner,),
        ).fetchall()
        owner_name = _owner_name(conn, owner)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {"version": version, "owner_name": owner_name, "tests": [dict(r) for r in rows]}


def global_average(users: list[dict]) -> list[dict]:
    """Unweighted mean of each user's make % per distance.

    Each user contributes one percentage per distance they have attempts at, so a
    user with many putts counts the same as one with few (that is the whole point:
    heavy putters must not skew the average). Distances nobody threw are absent."""
    by_distance: dict[int, list[float]] = {}
    for user in users:
        for stat in user["stats"]:
            if stat["attempts"]:
                by_distance.setdefault(stat["distance"], []).append(stat["pct"])
    return [
        {"distance": distance, "pct": sum(pcts) / len(pcts), "users": len(pcts)}
        for distance, pcts in sorted(by_distance.items())
    ]


@app.get("/stats")
def get_stats():
    """Per-user and global make-%-by-distance, for the comparison view.

    Public (stats are publicly viewable) and email-free: users are keyed by the
    stable Google `sub` with a display name, joined from the users projection, so
    no email is ever returned. A user appears once they have an identity (signed in
    at least once) and have recorded putts. `global` is the unweighted mean of each
    user's percentage per distance (see global_average).
    """
    with db.read() as conn:
        rows = conn.execute(
            "SELECT u.sub AS sub, u.name AS name, u.picture AS picture, "
            "b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
            "FROM batches b JOIN users u ON u.email = b.owner AND u.deleted_at IS NULL "
            "WHERE b.deleted_at IS NULL "
            "GROUP BY u.sub, b.distance "
            "ORDER BY u.name, b.distance"
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    # Group the flat (sub, distance) rows into one entry per user. Dict insertion
    # order follows the ORDER BY, so users stay sorted by name.
    users: dict[str, dict] = {}
    for r in rows:
        user = users.get(r["sub"])
        if user is None:
            user = {"sub": r["sub"], "name": r["name"], "picture": r["picture"], "stats": []}
            users[r["sub"]] = user
        made, attempts = r["made"], r["attempts"]
        user["stats"].append(
            {
                "distance": r["distance"],
                "made": made,
                "attempts": attempts,
                "pct": (100 * made / attempts) if attempts else 0,
            }
        )

    users_list = list(users.values())
    return {"version": version, "users": users_list, "global": global_average(users_list)}
