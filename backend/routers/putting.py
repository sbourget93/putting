"""Public read endpoints over the putting aggregates.

`/batches` and `/tests` are owner-scoped reads (your own, a named player via
`?sub=`, or the demo owner when signed out); `/daily` is the compact Daily Putts
payload; `/stats` and `/leaderboard` are the public comparison views. Ownership is
keyed on the Google `sub` throughout, so no email is ever read, stored, or returned.
All reads only — writes go through `/commands`.
"""

import os
from datetime import date

from fastapi import APIRouter, HTTPException, Request

import auth
import db
from projections.batches import TEST_DISTANCE_COUNT

router = APIRouter()

# Whose data a signed-out visitor reads: the public demo account (Stephen Bourget),
# named by its Google `sub`. It is what makes the app browsable while logged out,
# since a signed-out visitor has no data of their own. A Google sub is not sensitive
# and is already exposed by the public read endpoints. Overridable so a fork can
# point the demo at its own account.
DEMO_OWNER_SUB = os.environ.get("DEMO_OWNER_SUB", "111150169925345610943")

# Only a *complete* daily test (a recorded putt at every distance) counts toward any
# stats. Completeness is derived, not stored (see tests.md): a test_id is complete
# when its non-deleted batches cover all TEST_DISTANCE_COUNT distances. This subquery
# yields those test_ids; the stat queries restrict to `b.test_id IN (...)`. Only
# batches tied to a test count (test_id IS NOT NULL). The count is a trusted server
# constant, so it is safe to inline.
COMPLETE_TESTS_SUBQUERY = f"""
    SELECT test_id FROM batches
    WHERE test_id IS NOT NULL AND deleted_at IS NULL
    GROUP BY test_id
    HAVING COUNT(DISTINCT distance) = {TEST_DISTANCE_COUNT}
"""


def _read_owner(request: Request) -> str:
    """Whose rows a read returns: your own if signed in, else the demo owner.

    Owner is the Google `sub`. Any signed-in user reads and writes their own data
    through the offline engine. A signed-out visitor can only read, and only the
    demo owner's data.
    """
    user = auth.current_user(request)
    if user is not None:
        return user.get("sub") or ""
    return DEMO_OWNER_SUB


def _owner_name(conn, owner: str) -> str | None:
    """Display name for an owner `sub`, from the users projection, or None if unknown.

    The owner key is already the public `sub`, so it is returned as-is; only the
    name needs a lookup. No email exists to resolve or hide."""
    row = conn.execute(
        "SELECT name FROM users WHERE sub = ? AND deleted_at IS NULL", (owner,)
    ).fetchone()
    return row["name"] if row else None


def _resolve_owner(conn, request: Request, sub: str | None) -> str | None:
    """Whose rows a read returns. An explicit ?sub= names any user's data (public,
    like /stats); None when that sub has no user row. Without a sub, falls back to
    the request default (your own if signed in, else the demo owner).
    """
    if sub:
        row = conn.execute(
            "SELECT sub FROM users WHERE sub = ? AND deleted_at IS NULL", (sub,)
        ).fetchone()
        return row["sub"] if row else None
    return _read_owner(request)


@router.get("/batches")
def get_batches(request: Request, sub: str | None = None):
    """Active putt batches for the resolved owner, plus the current version.

    An explicit ?sub= names any user's data (public, like /stats), letting History
    browse another player. Without it, owner-scoped (see _read_owner): an admin gets
    their own batches, everyone else the demo owner's. The offline engine calls the
    no-sub form as its `batches` snapshot. Soft-deleted rows are omitted.

    Returns `owner_sub` (the owner key itself) and `owner_name` (public identity).
    No email exists to leak.
    """
    with db.read() as conn:
        owner = _resolve_owner(conn, request, sub)
        if owner is None:
            raise HTTPException(status_code=404, detail="Unknown user")
        rows = conn.execute(
            "SELECT batch_id, test_id, distance, batch_size, made, created_at, updated_at "
            "FROM batches WHERE owner_sub = ? AND deleted_at IS NULL ORDER BY created_at",
            (owner,),
        ).fetchall()
        owner_sub, owner_name = owner, _owner_name(conn, owner)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {
        "version": version,
        "owner_sub": owner_sub,
        "owner_name": owner_name,
        "batches": [dict(r) for r in rows],
    }


@router.get("/tests")
def get_tests(request: Request, sub: str | None = None):
    """Active daily tests for the resolved owner, plus the current version.

    Owner-scoped like /batches, with the same optional ?sub= to browse another
    user. The client maps a test to its batches by test_id to compute daily-test
    progress. Returns `owner_sub`/`owner_name`; no email exists to leak.
    """
    with db.read() as conn:
        owner = _resolve_owner(conn, request, sub)
        if owner is None:
            raise HTTPException(status_code=404, detail="Unknown user")
        rows = conn.execute(
            "SELECT test_id, test_date, created_at, updated_at "
            "FROM tests WHERE owner_sub = ? AND deleted_at IS NULL ORDER BY test_date",
            (owner,),
        ).fetchall()
        owner_sub, owner_name = owner, _owner_name(conn, owner)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {
        "version": version,
        "owner_sub": owner_sub,
        "owner_name": owner_name,
        "tests": [dict(r) for r in rows],
    }


@router.get("/daily")
def get_daily(request: Request, day: str | None = None):
    """The compact payload the Daily Putts page needs, for one local day.

    Owner-scoped like /tests (admin gets their own, everyone else the demo owner).
    Deliberately small and bounded regardless of history size — this is fetched on
    every visit and cached offline, so it must never grow with the batch log:

      - `test`          — that day's daily test (test_id, test_date) or null.
      - `today_batches` — the day's test batches (at most one per distance).
      - `baseline`      — the player's make-% by distance over their *complete* past
                          tests, excluding today, so today's putts are compared
                          against history, not themselves. This is the chart's grey
                          comparison line and the summary's lifetime average.

    `day` is the client's local calendar day (YYYY-MM-DD); it falls back to the
    server's date only if the client omits it.
    """
    owner = _read_owner(request)
    today = day or date.today().isoformat()
    with db.read() as conn:
        test_row = conn.execute(
            "SELECT test_id, test_date FROM tests "
            "WHERE owner_sub = ? AND test_date = ? AND deleted_at IS NULL",
            (owner, today),
        ).fetchone()
        test = {"test_id": test_row["test_id"], "test_date": test_row["test_date"]} if test_row else None

        today_batches: list[dict] = []
        if test:
            today_batches = [
                dict(r)
                for r in conn.execute(
                    "SELECT batch_id, test_id, distance, batch_size, made, created_at "
                    "FROM batches "
                    "WHERE owner_sub = ? AND test_id = ? AND deleted_at IS NULL "
                    "ORDER BY created_at",
                    (owner, test["test_id"]),
                ).fetchall()
            ]

        # Make-% by distance over the player's complete past tests: today is
        # excluded so it's compared against history, and incomplete days never count.
        baseline_rows = conn.execute(
            "SELECT b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
            "FROM batches b JOIN tests t ON t.test_id = b.test_id AND t.owner_sub = b.owner_sub "
            "WHERE b.owner_sub = ? AND b.deleted_at IS NULL "
            "AND t.deleted_at IS NULL AND t.test_date <> ? "
            f"AND b.test_id IN ({COMPLETE_TESTS_SUBQUERY}) "
            "GROUP BY b.distance ORDER BY b.distance",
            (owner, today),
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


@router.get("/stats")
def get_stats():
    """Per-user and global make-%-by-distance, for the comparison view.

    Public (stats are publicly viewable) and email-free: users are keyed by the
    stable Google `sub` with a display name, joined from the users projection, so
    no email is ever returned. A user appears once they have an identity (signed in
    at least once) and have completed a test. Only complete tests count (see
    COMPLETE_TESTS_SUBQUERY). `global` is the unweighted mean of each user's
    percentage per distance (see global_average).
    """
    with db.read() as conn:
        rows = conn.execute(
            "SELECT u.sub AS sub, u.name AS name, u.picture AS picture, "
            "b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
            "FROM batches b JOIN users u ON u.sub = b.owner_sub AND u.deleted_at IS NULL "
            "WHERE b.deleted_at IS NULL "
            f"AND b.test_id IN ({COMPLETE_TESTS_SUBQUERY}) "
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


@router.get("/leaderboard")
def get_leaderboard(start: str | None = None, end: str | None = None, day: str | None = None):
    """Players ranked by overall daily-test make %, over an optional date window.

    Public and email-free, like /stats. Complete tests only (incomplete tests don't
    count), joined to their test so the window filters on the local test_date.
    `start`/`end` are inclusive YYYY-MM-DD bounds; omit both
    for all-time. A test whose test_date falls in the window but which is incomplete
    is excluded entirely. Each entry also carries
    its make-%-by-distance breakdown so the client can draw that player's line for
    the chosen range without a second request. Only players with attempts in the
    window appear, best overall % first.

    `day` (a local YYYY-MM-DD) additionally returns `in_progress`: players who have
    started but not yet finished that day's test, so the Today board can show who is
    mid-round. A finished test (all distances) is ranked above and never appears here.
    """
    clauses = [
        "b.deleted_at IS NULL",
        "t.deleted_at IS NULL",
        "u.deleted_at IS NULL",
        f"b.test_id IN ({COMPLETE_TESTS_SUBQUERY})",
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
            "JOIN tests t ON t.test_id = b.test_id AND t.owner_sub = b.owner_sub "
            "JOIN users u ON u.sub = b.owner_sub "
            f"WHERE {where} "
            "GROUP BY u.sub, b.distance "
            "ORDER BY u.name, b.distance",
            params,
        ).fetchall()

        # Who has started `day`'s test, with their make-% so far by distance. A
        # player who has covered every distance has finished (ranked above) and is
        # dropped below; the rest are mid-round. The breakdown lets the client draw
        # their partial line without another request, like the ranked entries.
        in_progress_rows = []
        if day:
            in_progress_rows = conn.execute(
                "SELECT u.sub AS sub, u.name AS name, u.picture AS picture, "
                "b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
                "FROM tests t "
                "JOIN batches b ON b.test_id = t.test_id AND b.owner_sub = t.owner_sub "
                "AND b.deleted_at IS NULL "
                "JOIN users u ON u.sub = t.owner_sub AND u.deleted_at IS NULL "
                "WHERE t.deleted_at IS NULL AND t.test_date = ? "
                "GROUP BY u.sub, u.name, u.picture, b.distance "
                "ORDER BY u.name, b.distance",
                (day,),
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

    # Group today's per-distance rows into one entry per player. Distinct distances
    # recorded (len of stats) gives how far along they are; a player at every
    # distance has finished and is excluded here (they are ranked above).
    progress: dict[str, dict] = {}
    for r in in_progress_rows:
        player = progress.get(r["sub"])
        if player is None:
            player = {"sub": r["sub"], "name": r["name"], "picture": r["picture"], "stats": []}
            progress[r["sub"]] = player
        made, attempts = r["made"], r["attempts"]
        player["stats"].append(
            {
                "distance": r["distance"],
                "made": made,
                "attempts": attempts,
                "pct": (100 * made / attempts) if attempts else 0,
            }
        )
    in_progress = [
        {**player, "done": len(player["stats"]), "remaining": TEST_DISTANCE_COUNT - len(player["stats"])}
        for player in progress.values()
        if len(player["stats"]) < TEST_DISTANCE_COUNT
    ]
    # Furthest along first, then name for deterministic ties.
    in_progress.sort(key=lambda e: e["name"])
    in_progress.sort(key=lambda e: e["done"], reverse=True)

    return {"version": version, "users": entries, "in_progress": in_progress}
