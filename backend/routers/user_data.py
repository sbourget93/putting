"""User-data query endpoint: `GET /user-data`.

User-scoped and writer-gated: it returns only the signed-in caller's own stored
values, the sparse set of keys they have written (see projections/user_data.py). The
offline engine calls this as its `user_data` snapshot. Values are written through the
normal `POST /commands` path (`UserDataChanged`), so there is no write endpoint here.
"""

from fastapi import APIRouter, Depends, Request

import auth
import db

router = APIRouter()


@router.get("/user-data", dependencies=[Depends(auth.require_writer)])
def get_user_data(request: Request):
    """The signed-in user's stored data values, plus the current version.

    Only the caller's own rows are returned (scoped by `owner_sub`), so a user can
    never read another user's data. A key the user has never written has no row.
    """
    owner_sub = (auth.current_user(request) or {}).get("sub", "")
    with db.read() as conn:
        rows = conn.execute(
            "SELECT user_data_id, key, value FROM user_data "
            "WHERE owner_sub = ? AND deleted_at IS NULL ORDER BY key",
            (owner_sub,),
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    data = [
        {"user_data_id": r["user_data_id"], "key": r["key"], "value": r["value"]}
        for r in rows
    ]
    return {"version": version, "data": data}
