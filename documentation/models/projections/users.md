# User

One user identity, so the app can show a display name for whoever's data is on
screen instead of an email.
Recorded by `UserSignedIn`, enqueued by the client right after Google login.

Keyed by `sub`, Google's stable per-account id, which never changes.
`email` is carried only to join to owner-keyed data server-side; no endpoint ever
returns another user's email.

## Fields

| Field | Description |
| ----- | ----------- |
| `sub` | Google's stable per-account id (`sub` claim). Primary key; never changes. |
| `email` | From the server-stamped `owner`. Server-side join key only; never returned for another user. |
| `name` | Display name from the Google profile. What the UI shows. |
| `picture` | Google profile picture URL, or `NULL`. |
| `role` | See [`roles.md`](../../roles/roles.md) for available roles. Determines what actions the user can take. |

## Relationships

- Joins to [tests](./tests.md) and [batches](./batches.md) on `users.email = <table>.owner` to resolve an owner email to the `owner_name` those endpoints return.
