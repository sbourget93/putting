# User

One user identity, so the app can show a display name for whoever's data is on
screen.
Recorded by `UserSignedIn`, enqueued by the client right after Google login.

Keyed by `sub`, Google's stable per-account id, which never changes.
No email is stored here, or anywhere in the app.
The row holds only the public `sub`/`name`/`picture`, so it is safe to expose and safe to leak.

## Fields

| Field | Description |
| ----- | ----------- |
| `sub` | Google's stable per-account id (`sub` claim). Primary key; never changes. Also the ownership key the other tables reference. |
| `name` | Display name from the Google profile. What the UI shows. |
| `picture` | Google profile picture URL, or `NULL`. |
| `role` | See [`roles.md`](../../roles/roles.md) for available roles. Determines what actions the user can take. |

## Relationships

- Joins to [tests](./tests.md) and [batches](./batches.md) on `users.sub = <table>.owner_sub` to resolve an owner to the `owner_name` those endpoints return.
