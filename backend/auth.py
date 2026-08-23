"""Google login + admin enforcement.

The browser obtains a Google ID token via Google Identity Services and posts it
here; we verify it once and store the resulting *identity* (email/name/picture)
in a signed session cookie (see SessionMiddleware in main.py). The cookie is
self-contained and signed — there is no server-side session store — so auth is
stateless in the sense that matters: nothing to look up, nothing to expire on the
server, and the ~10-year cookie means a device stays signed in effectively
forever (see main.py for why SESSION_SECRET must outlive a deploy).

Admin is never baked into the cookie. `is_admin` is derived *live* on every
request by checking the cookie's email against the `ADMIN_EMAILS` allowlist, so
adding or removing an admin takes effect immediately without forcing anyone to
sign in again. `require_admin` gates the write path (`POST /commands`); reuse
`is_admin(request)` to gate or filter sensitive reads (see get_foos in main.py).

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

# Comma-separated allowlist; membership is what makes an email an admin. Checked
# live on every request, never cached into a session.
ADMIN_EMAILS = {
    e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()
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
    return bool(user) and user.get("email", "").lower() in ADMIN_EMAILS


def require_admin(request: Request) -> None:
    """FastAPI dependency: reject non-admins with 403."""
    if not is_admin(request):
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/auth/config")
def auth_config():
    """Public config the frontend needs to initialize Google Identity Services."""
    return {"google_client_id": GOOGLE_CLIENT_ID}


@router.get("/auth/me")
def auth_me(request: Request):
    """The currently signed-in identity plus its live admin status.

    `is_admin` is recomputed here rather than read from the cookie, so it always
    reflects the current allowlist."""
    return {"user": current_user(request), "is_admin": is_admin(request)}


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

    email = claims.get("email", "")
    # Store identity only; admin is derived live from ADMIN_EMAILS on each request.
    # `sub` is Google's stable per-account id; the client uses it as the aggregate
    # id when it records a UserSignedIn event (see projections/users.py).
    request.session["user"] = {
        "sub": claims.get("sub"),
        "email": email,
        "name": claims.get("name") or email,
        "picture": claims.get("picture"),
    }
    return {"user": current_user(request), "is_admin": is_admin(request)}


@router.post("/auth/logout")
def auth_logout(request: Request):
    """Clear the session cookie."""
    request.session.clear()
    return {"user": None, "is_admin": is_admin(request)}
