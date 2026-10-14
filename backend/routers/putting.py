"""Public read endpoints over the putting aggregates.

`/batches` and `/tests` are owner-scoped reads (your own, a named player via
`?sub=`, or the demo owner when signed out); `/daily` is the compact Daily Putts
payload; `/stats` and `/leaderboard` are the public comparison views. Ownership is
keyed on the Google `sub` throughout, so no email is ever read, stored, or returned.
All reads only — writes go through `/commands`.
"""

import os
from datetime import date, timedelta

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


@router.get("/misses")
def get_misses(request: Request, sub: str | None = None):
    """The resolved owner's missed putts grouped by location (miss_type).

    Owner-scoped like /batches, with the same optional ?sub= to browse another
    player. Only tracked misses count: a putt that was missed (made = 0) and has a
    recorded direction. Restricted to complete tests, like /stats and the graphs, so
    the distribution matches what the profile's charts are built from. Returns a
    `counts` map keyed by miss_type and the `total`; empty for a player who has
    tracked none. The nine miss types are documented in projections/putts.md.
    """
    with db.read() as conn:
        owner = _resolve_owner(conn, request, sub)
        if owner is None:
            raise HTTPException(status_code=404, detail="Unknown user")
        rows = conn.execute(
            "SELECT p.miss_type AS miss_type, COUNT(*) AS n "
            "FROM putts p "
            "JOIN batches b ON b.batch_id = p.batch_id AND b.owner_sub = p.owner_sub "
            "WHERE p.owner_sub = ? AND p.deleted_at IS NULL "
            "AND p.made = 0 AND p.miss_type IS NOT NULL "
            "AND b.deleted_at IS NULL "
            f"AND b.test_id IN ({COMPLETE_TESTS_SUBQUERY}) "
            "GROUP BY p.miss_type",
            (owner,),
        ).fetchall()
        owner_sub, owner_name = owner, _owner_name(conn, owner)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    counts = {r["miss_type"]: r["n"] for r in rows}
    return {
        "version": version,
        "owner_sub": owner_sub,
        "owner_name": owner_name,
        "total": sum(counts.values()),
        "counts": counts,
    }


@router.get("/daily")
def get_daily(request: Request, day: str | None = None):
    """The compact payload the Daily Putts page needs, for one local day.

    Owner-scoped like /tests (admin gets their own, everyone else the demo owner).
    Deliberately small and bounded regardless of history size — this is fetched on
    every visit and cached offline, so it must never grow with the batch log:

      - `test`          — that day's daily test (test_id, test_date) or null.
      - `today_batches` — the day's test batches (at most one per distance).
      - `today_putts`   — the individual putts under those batches (shadow data,
                          five per batch; see projections/putts.py). Bounded by the
                          batches, so it stays small like the rest of this payload.
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
        today_putts: list[dict] = []
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
            # The putts under those batches, joined to the day's test so the set is
            # bounded by today's batches rather than the whole putt log.
            today_putts = [
                dict(r)
                for r in conn.execute(
                    "SELECT p.putt_id, p.batch_id, p.number, p.made, p.miss_type, p.created_at "
                    "FROM putts p "
                    "JOIN batches b ON b.batch_id = p.batch_id AND b.owner_sub = p.owner_sub "
                    "WHERE p.owner_sub = ? AND b.test_id = ? "
                    "AND p.deleted_at IS NULL AND b.deleted_at IS NULL "
                    "ORDER BY p.created_at",
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

    return {
        "version": version,
        "test": test,
        "today_batches": today_batches,
        "today_putts": today_putts,
        "baseline": baseline,
    }


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


# The Average board pools each player's most recent complete tests, but reaches no
# further back than a year, so a long-dormant player's old form never lingers.
AVERAGE_TEST_LIMIT = 50
AVERAGE_MAX_AGE_DAYS = 365


def _pct(made: int, attempts: int) -> float:
    return (100 * made / attempts) if attempts else 0


def _stat(distance: int, made: int, attempts: int) -> dict:
    return {"distance": distance, "made": made, "attempts": attempts, "pct": _pct(made, attempts)}


def _rank(entries: list[dict]) -> list[dict]:
    """Best overall % first; name as a stable tiebreak so ties are deterministic."""
    entries.sort(key=lambda e: e["name"])
    entries.sort(key=lambda e: e["overall_pct"], reverse=True)
    return entries


@router.get("/leaderboard")
def get_leaderboard(mode: str = "daily", day: str | None = None):
    """Players ranked by daily-test make %, in one of three modes.

    Public and email-free, like /stats; complete tests only (incomplete tests never
    count). Every entry carries its make-%-by-distance breakdown so the client draws
    that player's line without a second request. `mode` picks what is ranked:

    - `daily` (default): a single day's board. `day` is a local YYYY-MM-DD (the
      viewer's local day; defaults to the server's today). Also returns `in_progress`
      (players who started but have not finished that day's test) and `days` (every
      date that has at least one complete test, newest first) so the client's date
      picker can offer only days with data.
    - `average`: each player's most recent complete tests, at most AVERAGE_TEST_LIMIT
      of them and none older than AVERAGE_MAX_AGE_DAYS, pooled into one percentage.
    - `best`: each player's single best complete test ever, by its overall %; it never
      falls off. Ties resolve to the more recent test.
    """
    if mode not in ("daily", "average", "best"):
        raise HTTPException(status_code=422, detail="unknown leaderboard mode")
    with db.read() as conn:
        if mode == "daily":
            return _leaderboard_daily(conn, day or date.today().isoformat())
        return _leaderboard_aggregate(conn, mode)


def _leaderboard_daily(conn, day: str) -> dict:
    rows = conn.execute(
        "SELECT u.sub AS sub, u.name AS name, u.picture AS picture, "
        "b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
        "FROM batches b "
        "JOIN tests t ON t.test_id = b.test_id AND t.owner_sub = b.owner_sub "
        "JOIN users u ON u.sub = b.owner_sub "
        "WHERE b.deleted_at IS NULL AND t.deleted_at IS NULL AND u.deleted_at IS NULL "
        f"AND b.test_id IN ({COMPLETE_TESTS_SUBQUERY}) "
        "AND t.test_date = ? "
        "GROUP BY u.sub, b.distance "
        "ORDER BY u.name, b.distance",
        (day,),
    ).fetchall()

    users: dict[str, dict] = {}
    totals: dict[str, list[int]] = {}  # sub -> [made, attempts]
    for r in rows:
        user = users.get(r["sub"])
        if user is None:
            user = {"sub": r["sub"], "name": r["name"], "picture": r["picture"], "stats": []}
            users[r["sub"]] = user
            totals[r["sub"]] = [0, 0]
        user["stats"].append(_stat(r["distance"], r["made"], r["attempts"]))
        totals[r["sub"]][0] += r["made"]
        totals[r["sub"]][1] += r["attempts"]
    entries = _rank(
        [{**u, "attempts": totals[sub][1], "overall_pct": _pct(*totals[sub])} for sub, u in users.items()]
    )

    # Who has started `day`'s test, with their make-% so far by distance. A player
    # who has covered every distance has finished (ranked above) and is dropped here;
    # the rest are mid-round. The breakdown lets the client draw their partial line.
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
    progress: dict[str, dict] = {}
    for r in in_progress_rows:
        player = progress.get(r["sub"])
        if player is None:
            player = {"sub": r["sub"], "name": r["name"], "picture": r["picture"], "stats": []}
            progress[r["sub"]] = player
        player["stats"].append(_stat(r["distance"], r["made"], r["attempts"]))
    in_progress = [
        {**player, "done": len(player["stats"]), "remaining": TEST_DISTANCE_COUNT - len(player["stats"])}
        for player in progress.values()
        if len(player["stats"]) < TEST_DISTANCE_COUNT
    ]
    in_progress.sort(key=lambda e: e["name"])
    in_progress.sort(key=lambda e: e["done"], reverse=True)

    # Every date with a complete test, newest first, so the picker offers only days
    # that have a board to show.
    days = [
        r["test_date"]
        for r in conn.execute(
            "SELECT DISTINCT t.test_date AS test_date FROM tests t "
            f"WHERE t.deleted_at IS NULL AND t.test_id IN ({COMPLETE_TESTS_SUBQUERY}) "
            "ORDER BY t.test_date DESC"
        ).fetchall()
    ]

    version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {"version": version, "users": entries, "in_progress": in_progress, "days": days}


def _leaderboard_aggregate(conn, mode: str) -> dict:
    """The Average and Best boards, both built from each player's complete tests."""
    params: list = []
    date_clause = ""
    if mode == "average":
        cutoff = (date.today() - timedelta(days=AVERAGE_MAX_AGE_DAYS)).isoformat()
        date_clause = "AND t.test_date >= ? "
        params.append(cutoff)
    rows = conn.execute(
        "SELECT u.sub AS sub, u.name AS name, u.picture AS picture, "
        "t.test_id AS test_id, t.test_date AS test_date, "
        "b.distance AS distance, SUM(b.made) AS made, SUM(b.batch_size) AS attempts "
        "FROM batches b "
        "JOIN tests t ON t.test_id = b.test_id AND t.owner_sub = b.owner_sub "
        "JOIN users u ON u.sub = b.owner_sub "
        "WHERE b.deleted_at IS NULL AND t.deleted_at IS NULL AND u.deleted_at IS NULL "
        f"AND b.test_id IN ({COMPLETE_TESTS_SUBQUERY}) "
        f"{date_clause}"
        "GROUP BY u.sub, t.test_id, b.distance "
        "ORDER BY u.sub, t.test_date DESC, t.test_id DESC, b.distance",
        params,
    ).fetchall()

    # Group the flat rows into per-player lists of tests, newest first (the ORDER BY
    # holds each test's distance rows contiguous, so a new test_id starts a new test).
    meta: dict[str, dict] = {}
    tests_by_user: dict[str, list[dict]] = {}
    for r in rows:
        meta.setdefault(r["sub"], {"sub": r["sub"], "name": r["name"], "picture": r["picture"]})
        tests = tests_by_user.setdefault(r["sub"], [])
        if not tests or tests[-1]["test_id"] != r["test_id"]:
            tests.append({"test_id": r["test_id"], "test_date": r["test_date"], "stats": []})
        tests[-1]["stats"].append(_stat(r["distance"], r["made"], r["attempts"]))

    entries = []
    for sub, tests in tests_by_user.items():
        if mode == "average":
            # Pool the most recent tests (already newest-first) by distance. `sessions`
            # is how many went into the average, for the entry's subtext.
            chosen = tests[:AVERAGE_TEST_LIMIT]
            pooled: dict[int, list[int]] = {}
            for t in chosen:
                for s in t["stats"]:
                    acc = pooled.setdefault(s["distance"], [0, 0])
                    acc[0] += s["made"]
                    acc[1] += s["attempts"]
            stats = [_stat(d, m, a) for d, (m, a) in sorted(pooled.items())]
            extra = {"sessions": len(chosen)}
        else:  # best: the single highest-% test; max keeps the first (newest) on ties
            best = max(tests, key=lambda t: _pct(*_test_totals(t)))
            stats = sorted(best["stats"], key=lambda s: s["distance"])
            extra = {"date": best["test_date"]}  # the day of that best test, for the subtext
        made = sum(s["made"] for s in stats)
        attempts = sum(s["attempts"] for s in stats)
        entries.append({**meta[sub], "stats": stats, "attempts": attempts, "overall_pct": _pct(made, attempts), **extra})

    version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    return {"version": version, "users": _rank(entries), "in_progress": [], "days": []}


def _test_totals(test: dict) -> tuple[int, int]:
    return sum(s["made"] for s in test["stats"]), sum(s["attempts"] for s in test["stats"])
