"""User-settings aggregate: one stored preference per user per setting.

A row holds a single toggle (today only `track_misses`) for one account. Settings
are sparse: a row exists only once the user has changed a setting away from its
default, so the reader supplies the default for anything missing. The model is
documented in documentation/models/projections/user_settings.md.

`owner_sub` is the Google `sub` of the owning account, stamped server-side from the
session (see routers/commands.py), never trusted from the client. One row per
`(owner_sub, name)` is enforced by a unique index: a `UserSettingChanged` upserts
onto that pair, so repeated toggles update the same record (keeping its original
`user_setting_id`) rather than piling up rows. This module owns payload validation;
a ValueError here becomes a 400.
"""

import sqlite3

# Settings the app understands. Kept in step with the frontend SETTING_NAMES and
# the user_settings.md model doc. An unknown name is rejected rather than stored,
# so a typo never silently persists a setting nothing reads.
KNOWN_SETTINGS = frozenset({"track_misses"})

SCHEMA = """
CREATE TABLE IF NOT EXISTS user_settings (
    user_setting_id TEXT PRIMARY KEY,
    owner_sub       TEXT NOT NULL,
    name            TEXT NOT NULL,
    value           INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT,
    deleted_at      TEXT,
    UNIQUE (owner_sub, name)
);
"""

TABLES = ("user_settings",)


def _owner_sub(payload: dict, event_type: str) -> str:
    owner_sub = (payload.get("owner_sub") or "").strip()
    if not owner_sub:
        raise ValueError(f"{event_type} requires a non-empty owner_sub")
    return owner_sub


def _name(payload: dict, event_type: str) -> str:
    name = (payload.get("name") or "").strip()
    if name not in KNOWN_SETTINGS:
        raise ValueError(f"{event_type} name must be one of {sorted(KNOWN_SETTINGS)}")
    return name


def _bool(payload: dict, event_type: str) -> bool:
    value = payload.get("value")
    if not isinstance(value, bool):
        raise ValueError(f"{event_type} requires a boolean value")
    return value


def _changed(
    conn: sqlite3.Connection, aggregate_id: str, payload: dict, created_at: str
) -> None:
    owner_sub = _owner_sub(payload, "UserSettingChanged")
    name = _name(payload, "UserSettingChanged")
    value = _bool(payload, "UserSettingChanged")
    # Upsert on (owner_sub, name): the first change for a setting inserts, later ones
    # refresh the value and stamp updated_at, keeping the original user_setting_id and
    # created_at. Replay applies events in seq order, so the last write wins.
    conn.execute(
        """
        INSERT INTO user_settings
            (user_setting_id, owner_sub, name, value, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(owner_sub, name) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.created_at,
            deleted_at = NULL
        """,
        (aggregate_id, owner_sub, name, int(value), created_at),
    )


HANDLERS = {"UserSettingChanged": _changed}
