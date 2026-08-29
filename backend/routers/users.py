"""User identity and role management endpoints.

`GET /users` is the public identity directory (email-free) the app uses to show a
display name for whoever's data is on screen. `POST /users/{sub}/role` and
`GET /admin/users` are the op/admin-only role-management path — a privileged write
that lives outside the offline command path (see post_user_role).
"""

import json
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import auth
import db
import s3_sync
from projections import apply_event
from projections.users import ASSIGNABLE_ROLES

router = APIRouter()


@router.get("/users")
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


# ---------------------------------------------------------------------------
# Role management (privileged write, separate from the self-service command path)
# ---------------------------------------------------------------------------
class RoleChangeRequest(BaseModel):
    role: str  # one of ASSIGNABLE_ROLES; `admin` is never assignable (it is the overlay)


def _can_manage_roles(request: Request) -> bool:
    """Whether the caller may change roles: an `op` (stored) or an admin (overlay).

    Evaluated before the write transaction is opened — effective_role reads the DB,
    and the single connection lock is not reentrant, so it must not run nested
    inside db.transaction()."""
    return auth.effective_role(request) in ("op", "admin")


@router.post("/users/{sub}/role")
def post_user_role(sub: str, body: RoleChangeRequest, request: Request):
    """Change another user's stored role. Op/admin only.

    Role management is a rare, online, privileged action, so it lives outside the
    offline command path rather than as a client event: the server issues a
    `UserRoleChanged` event itself (a server-generated event_id, the acting op/admin's
    sub stamped as `owner_sub`) and projects it in one transaction, so it still lands in the
    log and replays like any other write. `admin` cannot be assigned here — it is the
    live ADMIN_SUBS overlay, granted and revoked by editing that allowlist.
    """
    role = body.role.strip().lower()
    if role not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=400, detail=f"role must be one of {'|'.join(ASSIGNABLE_ROLES)}"
        )
    # Authorize before opening the transaction (see _can_manage_roles on the lock).
    if not _can_manage_roles(request):
        raise HTTPException(status_code=403, detail="Operator access required")

    actor = (auth.current_user(request) or {}).get("sub", "")
    with db.transaction() as conn:
        target = conn.execute(
            "SELECT sub FROM users WHERE sub = ? AND deleted_at IS NULL", (sub,)
        ).fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="Unknown user")

        event_id = str(uuid.uuid4())
        created_at = db.utc_now()
        payload = {"role": role, "owner_sub": actor}
        conn.execute(
            "INSERT INTO events (event_id, event_type, aggregate_id, payload, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (event_id, "UserRoleChanged", sub, json.dumps(payload), created_at),
        )
        apply_event(conn, "UserRoleChanged", sub, payload, created_at)
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]

    s3_sync.request_sync()
    return {"status": "ok", "version": version, "sub": sub, "role": role}


@router.get("/admin/users")
def get_admin_users(request: Request):
    """Every user with their stored role, for the role-management page. Op/admin only.

    Each row carries an `is_admin` flag computed live from ADMIN_SUBS. `admin` is not
    a stored role and so never appears in `role`; it is surfaced only through that flag.
    """
    if not _can_manage_roles(request):
        raise HTTPException(status_code=403, detail="Operator access required")
    with db.read() as conn:
        rows = conn.execute(
            "SELECT sub, name, picture, role FROM users "
            "WHERE deleted_at IS NULL ORDER BY name"
        ).fetchall()
        version = conn.execute("SELECT COALESCE(MAX(seq), 0) FROM events").fetchone()[0]
    users = [
        {
            "sub": r["sub"],
            "name": r["name"],
            "picture": r["picture"],
            "role": r["role"],
            "is_admin": r["sub"] in auth.ADMIN_SUBS,
        }
        for r in rows
    ]
    return {"version": version, "users": users}
