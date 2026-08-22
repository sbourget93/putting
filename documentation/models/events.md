# Events

The append-only log of every write the application has ever accepted, and the single source of truth. Every projection is derived from this table.

This table is backed up to S3 (and frequently compacted) so that it can be restored if lost.

## Fields

| Field | Description |
| ----- | ----------- |
| `seq` | Server-assigned sequence number. Source of truth for last-write-wins. |
| `event_id` | Client-generated unique id for the event. |
| `event_type` | Unique descriptive name of the event, e.g. `FooPublicValueChanged`. |
| `aggregate_id` | The id of the object this event applies to. |
| `payload` | JSON object holding the event's data. |
| `created_at` | When the client composed the event (not when the server received it). |

## Relationships

- Referenced by both `sync_state` records
