"""API routers, one module per domain (mirroring the projections package).

Each module exposes an `APIRouter`; `ROUTERS` is the ordered tuple `main.py` folds
into the app. Adding a domain is one new module plus one entry here — nothing else
in `main.py` changes. Access level is expressed per route (or per router, as in
`admin`) via dependencies, not by where a route lives.
"""

from . import admin, commands, putting, users

# Registered routers, in include order. Add new domain modules here.
ROUTERS = (commands.router, users.router, putting.router, admin.router)
