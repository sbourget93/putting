"""FastAPI app: CQRS command + query endpoints over the event-sourced store.

The command endpoint accepts events and returns only success/failure. Query
endpoints return data and never mutate. See AGENTS.md for the full architecture.

Routes have NO `/api` prefix: the gateway strips it before proxying, so define
routes as `/commands`, `/foos`, etc.
"""

import json
import os
from contextlib import asynccontextmanager
from datetime import date

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


def _owner_ident(conn, owner: str) -> tuple[str | None, str | None]:
    """Public identity (sub, name) for an owner email, from the users projection.

    Email is the internal owner key, but another user's email must never reach the
    client. So the owner-scoped query endpoints expose this resolved sub and name
    instead of the email when the viewer is looking at someone else's data. The sub
    is already public (see /users, /stats); the email never leaves the server."""
    row = conn.execute(
        "SELECT sub, name FROM users WHERE email = ? AND deleted_at IS NULL", (owner,)
    ).fetchone()
    return (row["sub"], row["name"]) if row else (None, None)


def _resolve_owner(conn, request: Request, sub: str | None) -> str | None:
    """Whose rows a read returns. An explicit ?sub= names any user's data (public,
    like /stats), resolved to that user's owner email; None when the sub is unknown.
    Without a sub, falls back to the request default (your own if admin, else demo).
    """
    if sub:
        row = conn.execute(
            "SELECT email FROM users WHERE sub = ? AND deleted_at IS NULL", (sub,)
        ).fetchone()
        return row["email"] if row else None
    return _read_owner(request)


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
def get_batches(request: Request, sub: str | None = None):
    """Active putt batches for the resolved owner, plus the current version.

    An explicit ?sub= names any user's data (public, like /stats), letting History
    browse another player. Without it, owner-scoped (see _read_owner): an admin gets
    their own batches, everyone else the demo owner's. The offline engine calls the
    no-sub form as its `batches` snapshot. Soft-deleted rows are omitted.

    Returns `owner_sub` and `owner_name` (public identity), never the owner email,
    so browsing another user's data never leaks their email.
    """
    with db.read() as conn:
        owner = _resolve_owner(conn, request, sub)
        if owner is None:
            raise HTTPException(status_code=404, detail="Unknown user")
        rows = conn.execute(
            "SELECT batch_id, kind, test_id, distance, batch_size, made, created_at, updated_at "
            "FROM batches WHERE owner = ? AND deleted_at IS NULL ORDER BY created_at",
            (owner,),
        ).fetchall()
        owner_sub, owner_name = _owner_ident(conn, owner)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {
        "version": version,
        "owner_sub": owner_sub,
        "owner_name": owner_name,
        "batches": [dict(r) for r in rows],
    }


@app.get("/tests")
def get_tests(request: Request, sub: str | None = None):
    """Active daily tests for the resolved owner, plus the current version.

    Owner-scoped like /batches, with the same optional ?sub= to browse another
    user. The client maps a test to its batches by test_id to compute daily-test
    progress. Returns `owner_sub`/`owner_name`, never the owner email.
    """
    with db.read() as conn:
        owner = _resolve_owner(conn, request, sub)
        if owner is None:
            raise HTTPException(status_code=404, detail="Unknown user")
        rows = conn.execute(
            "SELECT test_id, test_date, created_at, updated_at "
            "FROM tests WHERE owner = ? AND deleted_at IS NULL ORDER BY test_date",
            (owner,),
        ).fetchall()
        owner_sub, owner_name = _owner_ident(conn, owner)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {
        "version": version,
        "owner_sub": owner_sub,
        "owner_name": owner_name,
        "tests": [dict(r) for r in rows],
    }


@app.get("/daily")
def get_daily(request: Request, day: str | None = None):
    """The compact payload the Daily Putts page needs, for one local day.

    Owner-scoped like /tests (admin gets their own, everyone else the demo owner).
    Deliberately small and bounded regardless of history size — this is fetched on
    every visit and cached offline, so it must never grow with the batch log:

      - `test`          — that day's daily test (test_id, test_date) or null.
      - `today_batches` — the day's test batches (at most one per distance).
      - `baseline`      — the player's true all-time make-% by distance (every test
                          day, today included), the chart's grey comparison line and
                          the summary's lifetime average.

    `day` is the client's local calendar day (YYYY-MM-DD); it falls back to the
    server's date only if the client omits it.
    """
    owner = _read_owner(request)
    today = day or date.today().isoformat()
    with db.read() as conn:
        test_row = conn.execute(
            "SELECT test_id, test_date FROM tests "
            "WHERE owner = ? AND test_date = ? AND deleted_at IS NULL",
            (owner, today),
        ).fetchone()
        test = {"test_id": test_row["test_id"], "test_date": test_row["test_date"]} if test_row else None

        today_batches: list[dict] = []
        if test:
            today_batches = [
                dict(r)
                for r in conn.execute(
                    "SELECT batch_id, kind, test_id, distance, batch_size, made, created_at "
                    "FROM batches "
                    "WHERE owner = ? AND test_id = ? AND kind = 'test' AND deleted_at IS NULL "
                    "ORDER BY created_at",
                    (owner, test["test_id"]),
                ).fetchall()
            ]

        # True all-time test make-% by distance — every test day, today included.
        baseline_rows = conn.execute(
            "SELECT b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
            "FROM batches b JOIN tests t ON t.test_id = b.test_id AND t.owner = b.owner "
            "WHERE b.owner = ? AND b.kind = 'test' AND b.deleted_at IS NULL "
            "AND t.deleted_at IS NULL "
            "GROUP BY b.distance ORDER BY b.distance",
            (owner,),
        ).fetchall()
        baseline = [
            {
                "distance": r["distance"],
                "made": r["made"],
                "attempts": r["attempts"],
                "pct": (100 * r["made"] / r["attempts"]) if r["attempts"] else 0,
            }
            for r in baseline_rows
        ]

        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    return {"version": version, "test": test, "today_batches": today_batches, "baseline": baseline}


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


@app.get("/leaderboard")
def get_leaderboard(start: str | None = None, end: str | None = None):
    """Players ranked by overall daily-test make %, over an optional date window.

    Public and email-free, like /stats. Test batches only (free putting is legacy),
    joined to their test so the window filters on the local test_date. `start`/`end`
    are inclusive YYYY-MM-DD bounds; omit both for all-time. Each entry also carries
    its make-%-by-distance breakdown so the client can draw that player's line for
    the chosen range without a second request. Only players with attempts in the
    window appear, best overall % first.
    """
    clauses = [
        "b.kind = 'test'",
        "b.deleted_at IS NULL",
        "t.deleted_at IS NULL",
        "u.deleted_at IS NULL",
    ]
    params: list = []
    if start:
        clauses.append("t.test_date >= ?")
        params.append(start)
    if end:
        clauses.append("t.test_date <= ?")
        params.append(end)
    where = " AND ".join(clauses)

    with db.read() as conn:
        rows = conn.execute(
            "SELECT u.sub AS sub, u.name AS name, u.picture AS picture, "
            "b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
            "FROM batches b "
            "JOIN tests t ON t.test_id = b.test_id AND t.owner = b.owner "
            "JOIN users u ON u.email = b.owner "
            f"WHERE {where} "
            "GROUP BY u.sub, b.distance "
            "ORDER BY u.name, b.distance",
            params,
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    users: dict[str, dict] = {}
    totals: dict[str, list[int]] = {}  # sub -> [made, attempts]
    for r in rows:
        user = users.get(r["sub"])
        if user is None:
            user = {"sub": r["sub"], "name": r["name"], "picture": r["picture"], "stats": []}
            users[r["sub"]] = user
            totals[r["sub"]] = [0, 0]
        made, attempts = r["made"], r["attempts"]
        user["stats"].append(
            {
                "distance": r["distance"],
                "made": made,
                "attempts": attempts,
                "pct": (100 * made / attempts) if attempts else 0,
            }
        )
        totals[r["sub"]][0] += made
        totals[r["sub"]][1] += attempts

    entries = []
    for sub, user in users.items():
        made, attempts = totals[sub]
        entries.append({**user, "attempts": attempts, "overall_pct": (100 * made / attempts) if attempts else 0})
    # Best overall % first; a stable secondary sort by name keeps ties deterministic.
    entries.sort(key=lambda e: e["name"])
    entries.sort(key=lambda e: e["overall_pct"], reverse=True)

    return {"version": version, "users": entries}
