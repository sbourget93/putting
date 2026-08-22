"""Projection logic: fold events onto the read-model tables.

Pure with respect to the connection it's given — it never commits. Callers (live
command handling and `db.replay()`) own the transaction. Both go through
`apply_event`, so the live read model and one rebuilt from the log are guaranteed
identical.

Each aggregate is one module exposing:
  SCHEMA   — its CREATE TABLE statements
  TABLES   — the tables that schema creates
  HANDLERS — event_type -> handler(conn, aggregate_id, payload, created_at)

This package merges all three. Adding an aggregate is therefore one new module
plus one line in `_MODULES`; nothing else in the backend changes. In particular
`db.py` never lists projection tables, so there is no second place to forget.
"""

import sqlite3

from . import foo

# Registered aggregates. Add new modules here; drop `foo` once the app has its own.
_MODULES = (foo,)

# Every projection table's DDL, appended to the core schema by db.py.
SCHEMA = "".join(module.SCHEMA for module in _MODULES)

# Every projection table name. db.replay() uses this to decide whether the read
# model needs rebuilding.
TABLES = tuple(table for module in _MODULES for table in module.TABLES)

_HANDLERS: dict = {}
for _module in _MODULES:
    _HANDLERS.update(_module.HANDLERS)

# All event types that have a registered projection handler. The command endpoint
# uses this to reject unknown event types.
KNOWN_EVENT_TYPES = frozenset(_HANDLERS)


def apply_event(
    conn: sqlite3.Connection,
    event_type: str,
    aggregate_id: str,
    payload: dict,
    created_at: str,
) -> None:
    handler = _HANDLERS.get(event_type)
    if handler is None:
        raise ValueError(f"Unknown event type: {event_type}")
    handler(conn, aggregate_id, payload, created_at)
