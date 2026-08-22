"""S3 durability for the event log: incremental backup, compaction, and restore.

The append-only events table is the single source of truth; S3 is its permanent
backup so state survives instance replacement (the prod backend runs with no
volume, so a new instance boots with an empty DB and rebuilds from here).

What we back up: the *event log*, never the projections (those are rebuilt by
db.replay()). Each event is uploaded as one immutable NDJSON object keyed by its
seq. Every time a block of BLOCK_SIZE consecutive events is fully uploaded, the
singles are compacted into one `agg-<start>-<end>.json` object and the per-event
objects are deleted, so a restore reads a bounded number of objects instead of one
per event.

Ordering guarantee: uploads walk a single contiguous high-water mark
(`uploaded_through`) in seq order and stop at the first failed PUT rather than
skipping ahead, so S3 never contains a gap relative to the local log, and a block
is only ever compacted once every one of its events is confirmed uploaded.

Everything here is best-effort and runs off the request path: an S3 outage must
never fail an admin write. Disabled entirely when S3_BUCKET is unset (local dev).
"""

import json
import logging
import os
import threading
from typing import Optional

import db

log = logging.getLogger("s3_sync")

BUCKET = os.environ.get("S3_BUCKET", "")
PREFIX = os.environ.get("S3_EVENTS_PREFIX", "events/")
REGION = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
SYNC_INTERVAL = float(os.environ.get("S3_SYNC_INTERVAL", "30"))

# Events per compacted object, and the block granularity for `agg-` keys. Larger
# blocks mean fewer, fatter objects and a cheaper restore once they fill, at the
# cost of leaving more un-compacted singles behind in the meantime.
BLOCK_SIZE = 1000

# Zero-padded width for seq numbers in object keys, so lexicographic S3 ordering
# matches numeric ordering. 12 digits is comfortably beyond any plausible count.
_PAD = 12


def enabled() -> bool:
    return bool(BUCKET)


# ---------------------------------------------------------------------------
# boto3 client (lazily created; injectable for tests)
# ---------------------------------------------------------------------------
_client_obj = None


def _client():
    global _client_obj
    if _client_obj is None:
        import boto3  # imported lazily so the module loads without boto3 present

        _client_obj = boto3.client("s3", region_name=REGION)
    return _client_obj


def set_client_for_testing(client) -> None:
    """Inject a fake S3 client (see tests). Passing None resets to real boto3."""
    global _client_obj
    _client_obj = client


# ---------------------------------------------------------------------------
# Key naming
# ---------------------------------------------------------------------------
def _single_key(seq: int) -> str:
    return f"{PREFIX}{seq:0{_PAD}d}.json"


def _agg_key(start: int, end: int) -> str:
    return f"{PREFIX}agg-{start:0{_PAD}d}-{end:0{_PAD}d}.json"


def _parse_agg_end(key: str) -> Optional[int]:
    """Return the end seq of an `agg-<start>-<end>.json` key, or None if not one."""
    name = key[len(PREFIX):]
    if not name.startswith("agg-"):
        return None
    try:
        return int(name[len("agg-"):-len(".json")].split("-")[1])
    except (ValueError, IndexError):
        return None


def _parse_single_seq(key: str) -> Optional[int]:
    """Return the seq of a per-event `<seq>.json` key, or None if not one."""
    name = key[len(PREFIX):]
    if name.startswith("agg-") or not name.endswith(".json"):
        return None
    try:
        return int(name[:-len(".json")])
    except ValueError:
        return None


def _block_end(seq: int) -> int:
    """The end seq of the BLOCK_SIZE-aligned block that `seq` belongs to."""
    return ((seq - 1) // BLOCK_SIZE + 1) * BLOCK_SIZE


# ---------------------------------------------------------------------------
# Event <-> NDJSON serialization (one JSON object per line; matches GET /events)
# ---------------------------------------------------------------------------
def _row_to_line(row) -> str:
    return json.dumps(
        {
            "seq": row["seq"],
            "event_id": row["event_id"],
            "type": row["event_type"],
            "aggregate_id": row["aggregate_id"],
            "data": json.loads(row["payload"]),
            "created_at": row["created_at"],
        },
        separators=(",", ":"),
    )


def _body_for(rows) -> bytes:
    return ("\n".join(_row_to_line(r) for r in rows) + "\n").encode()


# ---------------------------------------------------------------------------
# Sync-state cursors (persisted in the sync_state table)
# ---------------------------------------------------------------------------
def _get_state(key: str, default: int = 0) -> int:
    with db.read() as conn:
        row = conn.execute("SELECT value FROM sync_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def _set_state(key: str, value: int) -> None:
    # Unlike the event log these rows are mutable, so updated_at is real here
    # rather than a permanently-NULL placeholder. deleted_at never gets set:
    # cursors are overwritten in place, never removed.
    now = db.utc_now()
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO sync_state (key, value, created_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?",
            (key, value, now, now),
        )


# ---------------------------------------------------------------------------
# Upload + compaction
# ---------------------------------------------------------------------------
def _put(key: str, body: bytes) -> None:
    _client().put_object(Bucket=BUCKET, Key=key, Body=body)


def _fetch_events(start: int, end: Optional[int] = None):
    """Existing events with seq > `start` (and <= `end` if given), in seq order."""
    sql = (
        "SELECT seq, event_id, event_type, aggregate_id, payload, created_at "
        "FROM events WHERE seq > ?"
    )
    params: list = [start]
    if end is not None:
        sql += " AND seq <= ?"
        params.append(end)
    sql += " ORDER BY seq"
    with db.read() as conn:
        return conn.execute(sql, params).fetchall()


def _upload_new_events() -> int:
    """Upload not-yet-synced events one at a time, in order, stopping on first
    failure. Returns the resulting `uploaded_through` high-water mark.

    The cursor only advances across events whose PUT succeeded, so S3 can never
    hold a gap: if event N fails, N+1 is not attempted until the next sweep.
    """
    cursor = _get_state("uploaded_through")
    for row in _fetch_events(cursor):
        try:
            _put(_single_key(row["seq"]), _body_for([row]))
        except Exception:
            log.warning("S3 upload failed at seq=%s; will retry next sweep", row["seq"], exc_info=True)
            break
        cursor = row["seq"]
        _set_state("uploaded_through", cursor)
    return cursor


def _compact(uploaded_through: int) -> None:
    """Roll each fully-uploaded block of BLOCK_SIZE into one `agg-` object and
    delete the per-event objects it replaces.

    Built from the local DB (the source of truth), not by reading the singles
    back, and only for blocks entirely at or below `uploaded_through` — so a
    merged object can never capture an event that isn't in S3 yet.
    """
    merged = _get_state("merged_through")
    while uploaded_through >= merged + BLOCK_SIZE:
        start, end = merged + 1, merged + BLOCK_SIZE
        rows = _fetch_events(start - 1, end)  # events in [start, end]
        try:
            if rows:
                _put(_agg_key(start, end), _body_for(rows))
                _delete_keys([_single_key(r["seq"]) for r in rows])
        except Exception:
            log.warning("S3 compaction failed for block %s-%s; will retry", start, end, exc_info=True)
            return
        merged = end
        _set_state("merged_through", merged)


def _delete_keys(keys: list[str]) -> None:
    # S3 DeleteObjects accepts at most 1000 keys per call.
    for i in range(0, len(keys), 1000):
        chunk = keys[i:i + 1000]
        _client().delete_objects(
            Bucket=BUCKET,
            Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True},
        )


def sync_once() -> None:
    """One best-effort sync pass: upload new events, then compact full blocks."""
    if not enabled():
        return
    try:
        uploaded_through = _upload_new_events()
        _compact(uploaded_through)
    except Exception:
        log.warning("S3 sync pass failed", exc_info=True)


# ---------------------------------------------------------------------------
# Restore (cold start)
# ---------------------------------------------------------------------------
def restore_from_s3() -> None:
    """Rebuild the local event log from S3. Called only when events is empty.

    Reads every object (compacted and single), dedups by seq, and inserts events
    preserving their original seq. Order- and overlap-independent: a crash
    mid-compaction that briefly leaves both an `agg-` object and its singles is
    tolerated here (INSERT OR IGNORE) and the orphaned singles — which no future
    sweep would revisit, since the block reads as already compacted — are deleted
    below.
    """
    if not enabled():
        return

    client = _client()
    events: dict[int, dict] = {}
    agg_ends: set[int] = set()
    single_keys: dict[int, str] = {}  # seq -> object key, for orphan cleanup
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            body = client.get_object(Bucket=BUCKET, Key=key)["Body"].read().decode()
            for line in body.splitlines():
                if not line.strip():
                    continue
                ev = json.loads(line)
                events[ev["seq"]] = ev
            end = _parse_agg_end(key)
            if end is not None:
                agg_ends.add(end)
            else:
                seq = _parse_single_seq(key)
                if seq is not None:
                    single_keys[seq] = key

    if not events:
        log.info("S3 restore: no events found under %s", PREFIX)
        return

    with db.transaction() as conn:
        for seq in sorted(events):
            ev = events[seq]
            conn.execute(
                "INSERT OR IGNORE INTO events "
                "(seq, event_id, event_type, aggregate_id, payload, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    seq,
                    ev["event_id"],
                    ev["type"],
                    ev["aggregate_id"],
                    json.dumps(ev.get("data") or {}),
                    ev["created_at"],
                ),
            )

    _set_state("uploaded_through", max(events))
    # Highest block that is already compacted, as a contiguous run of agg objects
    # from the start; anything above it will be (re)compacted by the next sweep.
    merged = 0
    while (merged + BLOCK_SIZE) in agg_ends:
        merged += BLOCK_SIZE
    _set_state("merged_through", merged)

    # Delete singles already captured by a compacted block. These are orphans from
    # a crash between an `agg-` PUT and its singles DELETE: the block reads as
    # compacted, so no future sweep would ever revisit and remove them.
    orphans = [key for seq, key in single_keys.items() if _block_end(seq) in agg_ends]
    if orphans:
        _delete_keys(orphans)

    log.info(
        "S3 restore: %d events restored (through seq %d); removed %d orphaned singles",
        len(events), max(events), len(orphans),
    )


# ---------------------------------------------------------------------------
# Background sync loop
# ---------------------------------------------------------------------------
_wake = threading.Event()
_stop = threading.Event()
_thread: Optional[threading.Thread] = None


def request_sync() -> None:
    """Nudge the background loop to sync promptly (called after a command commit)."""
    _wake.set()


def _loop() -> None:
    while not _stop.is_set():
        _wake.wait(SYNC_INTERVAL)
        _wake.clear()
        if _stop.is_set():
            break
        sync_once()


def start_background_sync() -> None:
    global _thread
    if not enabled() or _thread is not None:
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="s3-sync", daemon=True)
    _thread.start()
    log.info("S3 sync started (bucket=%s, interval=%ss)", BUCKET, SYNC_INTERVAL)


def stop_background_sync() -> None:
    global _thread
    _stop.set()
    _wake.set()
    if _thread is not None:
        _thread.join(timeout=5)
        _thread = None
