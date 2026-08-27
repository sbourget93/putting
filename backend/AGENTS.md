# Backend
`backend/` contains the Python (FastAPI) application and the live SQLite database file (`app.db`) it runs against.
It's an event-sourced, CQRS backend that validates user commands, projects them into a local SQLite read model, serves queries, and continuously backs the event log up to S3.

## Stack

| Layer | Details |
| --- | --- |
| **API** | Python (FastAPI), served by Uvicorn (`uvicorn main:app`), handles API requests, processes commands, and queries the database. This code runs in a Docker container parallel to the fontend and gatway containers. |
| **Database** | SQLite (stdlib `sqlite3`, no ORM) is the application database, serving as both the event store and the projection layer. If the database is lost, the event log can be restored from S3 and replayed to reconstruct all projections. |
| **Durability** | Boto3 syncs the event log to S3, the permanent backup that persists even if the EC2 instance fails. Projections are not backed up. Only the events are backed up, which are enough to rebuild state. |
| **Auth** | Google login stores identity in a signed session cookie. `require_writer` gates writes (any signed-in user records their own data), `require_admin` gates sensitive reads. Roles `public`/`user`/`op` live in the users projection; `admin` is the live `ADMIN_EMAILS` overlay. |

## Structure (`backend/`)

| File | Purpose |
| --- | --- |
| `main.py` | FastAPI entry point. Registers the session-cookie middleware and the auth router, defines the CQRS endpoints (`POST /commands`, `POST /users/{sub}/role`, `GET /events`, `GET /foos`), and the `lifespan` that restores from S3 + replays on startup and runs the background sync. |
| `auth.py` | Google token verification, the write gate and role authorization (`require_writer`, `require_admin`, `is_admin`, `effective_role`), and the `/auth/*` router. Fails closed without `GOOGLE_CLIENT_ID`. |
| `db.py` | SQLite connection, schema defintions (append-only `events` store + projections + `sync_state` cursors), and `replay()` (rebuilds projections from the event log when they're empty). On startup, if the `events` table is empty it first restores the log from S3 (`s3_sync`) before replaying. Do not document column meanings with comments, this is already documented elsewhere in the repo. |
| `s3_sync.py` | Best-effort S3 backup of the event log. A background thread uploads each new event as an immutable object keyed by seq, walking a contiguous `uploaded_through` cursor. Every 1000-event block is compacted into one `agg-<start>-<end>.json` and the singles deleted. `restore_from_s3()` rebuilds the log on a fresh instance. |
| `projections/` | One module per aggregate, each exposing a `HANDLERS` map of `event_type -> handler`. |

## Architecture
* **Primary Event Store:** An append-only `events` table in local SQLite is the absolute, single source of truth. Events are never updated or deleted.
* **Last Write Wins:** Events most recetly received by the server (a higher `seq` number) overwrite older events when projected.
* **CQRS:** Command endpoints accept data and return only success or failure. Query endpoints return data and never mutate. Command workflows must not depend on query endpoints, all data needed to execute a command must already exist in local state.
* **Client-Generated IDs:** Clients generate UUIDs for all new entities before submitting a command, enabling offline writes without a server round-trip.
* **Idempotent Retries:** The command endpoint skips any `event_id` already in the log, so a batch resent after a lost acknowledgement commits exactly once instead of duplicating events.
* **Atomic Batches:** A command batch commits entirely or not at all, so a rejected batch leaves no partial state and the client can always resend it verbatim rather than discovering which events landed.
* **Read Path (Projections):** Separate SQLite tables serve as the projection layer (read model). Immediately after an event is written, the server projects it into the relevant projection tables so subsequent read queries reflect updated state.
* **Authorization:** Writes require a signed-in, write-capable role. Role changes go through the op-gated `POST /users/{sub}/role`, which emits a server-only `UserRoleChanged` event that `POST /commands` refuses, so a user cannot promote themselves.
