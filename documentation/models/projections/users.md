# User

A google-signed-in user.

## Fields

| Field | Description |
| ----- | ----------- |
| `sub` | Google's stable per-account id. Primary key for the user, and the ownership key the other tables reference. |
| `name` | Display name from the Google profile. |
| `picture` | Google profile picture URL. |
| `role` | See [`roles.md`](../../roles/roles.md) for available roles. Determines what actions the user can take. |

## Relationships

- Joins to [tests](./tests.md) and [batches](./batches.md) on `users.sub = <table>.owner_sub` to resolve an owner to the `owner_name` those endpoints return.
