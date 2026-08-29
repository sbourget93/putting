# Event Sourcing Tables

These tables are not projections, they are the backbone of the event sourced data.

| Model | Description |
| ----- | ----------- |
| [events](./events.md) | The append-only log of every write and the single source of truth. |
| [sync_state](./sync_state.md) | Cursors tracking how far the event log has been backed up to S3. |

# Projection Data Models

These are all read-model projections derived from the event-sourced data in the `events` table. They are never written to directly.

| Model | Description |
| ----- | ----------- |
| [Test](./projections/tests.md) | A daily test: the container a day's 5-putt test batches belong to. |
| [Batch](./projections/batches.md) | One recorded set of putts from a single distance in a daily test. |
| [User](./projections/users.md) | One row per Google account: the display identity and stored role. |

## Metadata fields

Every table (projections as well as system tables) has these standard fields in addition to the domain fields defined in each object's file. If a table is an append only table, it will still have `updated_at` and `deleted_at`, though they will always be `NULL`.

| Field | Description |
| ----- | ----------- |
| `created_at` | The timestamp of the creation event for this object. |
| `updated_at` | The timestamp of the most recent update event for this object. Creation and deletion are not updates. |
| `deleted_at` | The timestamp this object was most recently deleted, or null if it is currently active (never deleted, or since restored). |
