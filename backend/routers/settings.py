"""User-settings query endpoint: `GET /settings`.

User-scoped and writer-gated: it returns only the signed-in caller's own settings,
the sparse set of toggles they have changed away from the default (see
projections/user_settings.py). The offline engine calls this as its `user_settings`
snapshot. Settings are written through the normal `POST /commands` path
(`UserSettingChanged`), so there is no write endpoint here.
"""

from fastapi import APIRouter, Depends, Request

import auth
import db

router = APIRouter()


@router.get("/settings", dependencies=[Depends(auth.require_writer)])
def get_settings(request: Request):
    """The signed-in user's stored settings, plus the current version.

    Only the caller's own rows are returned (scoped by `owner_sub`), so a user can
    never read another user's preferences. A setting the user has never changed has
    no row; the client applies the default for it.
    """
    owner_sub = (auth.current_user(request) or {}).get("sub", "")
    with db.read() as conn:
        rows = conn.execute(
            "SELECT user_setting_id, name, value FROM user_settings "
            "WHERE owner_sub = ? AND deleted_at IS NULL ORDER BY name",
            (owner_sub,),
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    settings = [
        {"user_setting_id": r["user_setting_id"], "name": r["name"], "value": bool(r["value"])}
        for r in rows
    ]
    return {"version": version, "settings": settings}
