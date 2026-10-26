# User Data

A key-value store for data points tied to specific users(notes, settings, etc).

## Fields

| Field | Description |
| ----- | ----------- |
| `user_data_id` | Unique id of the data record. |
| `owner_sub` | Google `sub` of the user the value belongs to. |
| `key` | The value's key, e.g. `notes`. |
| `value` | The stored value. |

## Keys

| Key | Description |
| --- | ----------- |
| `notes` | The player's private putting notes. |

## Relationships

- Belongs to one [user](./users.md).
