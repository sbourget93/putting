# Test

A **daily test**: the container that a day's 5-putt test batches hang off of.
There is one row per `(owner, local calendar day)`.

A test carries no state that isn't derivable from its batches.
Completion and per-distance results are all computed from the [batches](./batches.md) that reference it.
Its only purpose is to give those batches a stable id to point at and to record which local day the test belongs to.
The client supplies `test_date`, because only the device knows its own timezone, and the test resets at local midnight.

A test is created lazily.
The first test putt of a day emits `TestStarted` together with its `BatchRecorded` in one atomic command, so the referenced test always exists.

## Fields

| Field | Description |
| ----- | ----------- |
| `test_id` | Unique id of the daily test (client-generated). |
| `owner` | Email of the user the test belongs to. Stamped server-side from the session; never trusted from the client. |
| `test_date` | The local calendar day (`YYYY-MM-DD`) this test covers. |

## Relationships

- Referenced by many [batches](./batches.md) (a test's 5-putt slots), via `batches.test_id`.
