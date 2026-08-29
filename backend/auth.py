"""Google login, the signed-in write gate, and role authorization.

The browser obtains a Google ID token via Google Identity Services and posts it
here; we verify it once and store the resulting *identity* (sub/name/picture) in a
signed session cookie (see SessionMiddleware in main.py). Email is read from the
verified token only to confirm the account and is never stored — not in the cookie,
the event log, or any projection. The cookie is self-contained and signed — there
is no server-side session store — so auth is stateless in the sense that matters:
nothing to look up, nothing to expire on the server, and the ~10-year cookie means
a device stays signed in effectively forever (see main.py for why SESSION_SECRET
must outlive a deploy).

Admin is never baked into the cookie, and never stored as a role either. `is_admin`
is derived *live* on every request by checking the cookie's `sub` against the
`ADMIN_SUBS` allowlist, so adding or removing an admin takes effect immediately
without forcing anyone to sign in again — that is also how admin is granted and
revoked, with no SSH or manual command. The stored roles (`public`/`user`/`op`)
live in the users projection; `stored_role`/`effective_role` resolve them.

`require_writer` gates the write path (`POST /commands`): any signed-in user whose
role permits writing (`user`/`op`/`admin`) may record their own data, while one
downgraded to the read-only `public` role is refused. `require_admin` still exists
for endpoints only an admin should reach (e.g. the raw `/events` log and the
`/admin/*` reads); reuse `is_admin(request)` to gate or filter sensitive reads.

Auth fails *closed* everywhere: without a `GOOGLE_CLIENT_ID` the app refuses to
start, so any deployment — and local dev — errors out rather than silently
serving an open write path. There is no bypass; sign in with a real Google
account locally too (localhost is a valid GIS origin).

Routes have no `/api` prefix — the gateway strips it before proxying (see main.py).
"""

import os

from fastapi import APIRouter, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

if not GOOGLE_CLIENT_ID:
    raise RuntimeError(
        "GOOGLE_CLIENT_ID is unset. Set it in every environment, including local "
        "development — sign in with a real Google account (localhost is a valid "
        "Google Identity Services origin)."
    )

# Comma-separated allowlist of Google `sub` ids; membership is what makes an account
# an admin. Checked live on every request, never cached into a session. Subs (not
# emails) so no email is needed to grant admin — sign in once and read your sub from
# GET /auth/me to seed this.
ADMIN_SUBS = {
    s.strip() for s in os.environ.get("ADMIN_SUBS", "").split(",") if s.strip()
}

router = APIRouter()

# One reusable transport for token verification (fetches Google's signing certs).
_google_request = google_requests.Request()


class GoogleCredential(BaseModel):
    credential: str  # the Google ID token (JWT) from the GIS callback


def current_user(request: Request) -> dict | None:
    """The signed-in identity from the session cookie, or None. No admin flag —
    identity and authorization are kept separate on purpose (see is_admin)."""
    return request.session.get("user")


def is_admin(request: Request) -> bool:
    """Whether this request is from an admin, decided live from the allowlist."""
    user = current_user(request)
    return bool(user) and user.get("sub", "") in ADMIN_SUBS


def require_admin(request: Request) -> None:
    """FastAPI dependency: reject non-admins with 403."""
    if not is_admin(request):
        raise HTTPException(status_code=403, detail="Admin access required")


def can_write(request: Request) -> bool:
    """Whether this caller may write: signed in and not downgraded to `public`.

    A fresh signed-in account (no projection row yet) defaults to `user` and can
    write; an account explicitly set to `public` is signed in but read-only."""
    return effective_role(request) != "public"


def require_writer(request: Request) -> None:
    """FastAPI dependency gating the write path (`POST /commands`): any signed-in
    user whose role permits writing (`user`/`op`/`admin`) may record their own data.

    This is the multi-user replacement for `require_admin` on writes. A signed-out
    visitor, or one downgraded to the read-only `public` role, is rejected with 403."""
    if not can_write(request):
        raise HTTPException(status_code=403, detail="Login required to write")


def stored_role(sub: str | None) -> str:
    """The role persisted in the users projection for `sub`, or 'user' by default.

    A signed-in account with no projection row yet (its `UserSignedIn` not recorded)
    is treated as a plain `user`. `admin` is never stored here — it is the live
    overlay derived from `ADMIN_SUBS` (see is_admin), never a projection value."""
    if not sub:
        return "user"
    # Local import: auth is otherwise free of DB coupling, and db imports nothing
    # from here, so there is no cycle. Role lives in the projection, so this is the
    # one place authorization has to read the read model.
    import db

    with db.read() as conn:
        row = conn.execute(
            "SELECT role FROM users WHERE sub = ? AND deleted_at IS NULL", (sub,)
        ).fetchone()
    return row["role"] if row else "user"


def effective_role(request: Request) -> str:
    """The caller's role, admin overlay applied: 'admin' if their sub is allowlisted,
    else the stored role ('public'/'user'/'op'), else 'public' when signed out."""
    if is_admin(request):
        return "admin"
    user = current_user(request)
    if user is None:
        return "public"
    return stored_role(user.get("sub"))


def _identity(request: Request) -> dict:
    """The shape every auth route returns: who you are and what you can do."""
    return {
        "user": current_user(request),
        "is_admin": is_admin(request),
        "role": effective_role(request),
    }


@router.get("/auth/config")
def auth_config():
    """Public config the frontend needs to initialize Google Identity Services."""
    return {"google_client_id": GOOGLE_CLIENT_ID}


@router.get("/auth/me")
def auth_me(request: Request):
    """The currently signed-in identity plus its live admin status and role.

    `is_admin` and `role` are recomputed here rather than read from the cookie, so
    they always reflect the current allowlist and the latest role assignment."""
    return _identity(request)


@router.post("/auth/google")
def auth_google(body: GoogleCredential, request: Request):
    """Verify a Google ID token and store the identity in the session."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google login is not configured")
    try:
        claims = id_token.verify_oauth2_token(
            body.credential, _google_request, GOOGLE_CLIENT_ID
        )
    except ValueError:
        # Invalid signature, wrong audience, or expired token.
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    # Store identity only, and never the email: admin is derived live from ADMIN_SUBS
    # on each request, and ownership is keyed on `sub`, so email has no use past this
    # verification. `sub` is Google's stable per-account id; the client uses it as the
    # aggregate id when it records a UserSignedIn event (see projections/users.py).
    request.session["user"] = {
        "sub": claims.get("sub"),
        "name": claims.get("name") or "Player",
        "picture": claims.get("picture"),
    }
    return _identity(request)


@router.post("/auth/logout")
def auth_logout(request: Request):
    """Clear the session cookie."""
    request.session.clear()
    return _identity(request)
