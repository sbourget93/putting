# Sync State

Bookkeeping for the S3 backup of the event log: how far the log has been uploaded, and how far it has been compacted. Purely derived, this table can be recomputed.

Unlike every other table these rows are written directly rather than projected from events, and they are overwritten in place as the cursors advance.

## Fields

| Field | Description |
| ----- | ----------- |
| `key` | Which cursor this row holds. |
| `value` | The `events.seq` that cursor currently points at. |

## Keys
These are the values populating the `key` field in this table. These will always be the only 2 records in the table.

| Key | Description |
| --- | ----------- |
| `uploaded_through` | Highest `seq` uploaded to S3. |
| `merged_through` | Highest `seq` whose event has been compacted into a single S3 object. |

## Relationships

- References one `event`.
