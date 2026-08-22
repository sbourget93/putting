# Batch

One recorded set of putts thrown from a single distance.
This is the app's core write.
Everything the app displays (history, per-distance make %, daily-test progress) is derived by querying these rows.

A batch is either a **free** putt or a **test** putt.
A free putt is ad-hoc practice: distance 10–60 ft, any batch size.
A test putt is one slot in a [daily test](./tests.md): distance 12–33 ft, always 5 putts, carrying the `test_id` it belongs to.

## Fields

| Field | Description |
| ----- | ----------- |
| `batch_id` | Unique id of the batch (client-generated). |
| `owner` | Email of the user the batch belongs to. Stamped server-side from the session; never trusted from the client. |
| `kind` | `free` or `test`. |
| `test_id` | The [test](./tests.md) this batch belongs to, or `NULL` for a free putt. |
| `distance` | Distance in feet. Free: 10–60. Test: 12–33. |
| `batch_size` | Number of putts thrown. Free: any ≥ 1 (default 10). Test: always 5. |
| `made` | Number made, between 0 and `batch_size`. |

## Relationships

- References at most one [test](./tests.md), via `test_id` (only when `kind = test`).

## Ownership & isolation

Reads are filtered by `owner`, so each user sees only their own batches.
Logged-out visitors see the public demo owner's batches instead (see the backend query endpoints).
The edit and delete handlers scope their writes by `owner` as well as `batch_id`.
A forged id can only ever be a no-op against another user's row, never an edit of it.
