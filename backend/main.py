"""FastAPI app assembly: middleware, lifespan, and router wiring.

The endpoints themselves live in the `routers/` package, one module per domain
(mirroring `projections/`). This file only stands the app up: the session-cookie
middleware, the startup/shutdown lifespan, and folding in each router. See the
backend AGENTS.md for the full CQRS/event-sourcing architecture.

Routes have NO `/api` prefix: the gateway strips it before proxying, so routers
define paths as `/commands`, `/batches`, etc.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

import auth
import db
import routers
import s3_sync


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()  # restores the event log from S3 (if empty) before replay
    s3_sync.start_background_sync()
    yield
    s3_sync.stop_background_sync()


app = FastAPI(lifespan=lifespan)

# Signed session cookie holding the Google identity. max_age ~10 years keeps
# users logged in effectively indefinitely; sessions stay valid only while
# SESSION_SECRET is unchanged, so store it outside the deploy (e.g. SSM) and
# reuse it across releases.
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("SESSION_SECRET", "dev-insecure-secret"),
    max_age=10 * 365 * 24 * 3600,
    same_site="lax",
    https_only=os.environ.get("COOKIE_SECURE", "0") == "1",
)

app.include_router(auth.router)
for _router in routers.ROUTERS:
    app.include_router(_router)
