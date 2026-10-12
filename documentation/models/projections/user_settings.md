# User Setting

One stored preference for one user.
There is up to one row per `(owner_sub, name)`.
A setting is absent until the user first changes it, and the reader supplies the default for anything missing.

## Fields

| Field | Description |
| ----- | ----------- |
| `user_setting_id` | Unique id of the setting record. |
| `owner_sub` | Google `sub` of the user the setting belongs to. |
| `name` | The setting's key, e.g. `track_misses`. |
| `value` | The setting's value. Today every setting is a boolean, stored as `0` or `1`. |

## Relationships

- Belongs to one [user](./users.md).
