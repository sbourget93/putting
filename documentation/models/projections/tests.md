# Test

A daily test containing 22 [`batches`](./batches.md) of [`putts`](./putts.md).
There is up to one row per `(owner_sub, local calendar day)`.
A test is considered complete (determined at runtime) when its non-deleted test batches cover every one of the 22 distances (12–33 ft inclusive).
Its only purpose is to give those batches a stable id to point at and to record which local day the test belongs to.

## Fields

| Field | Description |
| ----- | ----------- |
| `test_id` | Unique id of the daily test. |
| `owner_sub` | Google `sub` of the user the test belongs to. |
| `test_date` | The local calendar day (`YYYY-MM-DD`) this test covers. |

## Relationships

- Referenced by many [batches](./batches.md).
