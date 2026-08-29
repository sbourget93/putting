# Batch

One recorded set of putts thrown from a single distance.
This is the app's core write.
Everything the app displays (history, per-distance make %, daily-test progress) is derived by querying these rows.

A batch is one slot in a [daily test](./tests.md): a set of putts thrown from a single 12–33 ft distance, carrying the `test_id` it belongs to.
The daily test records 5 putts per distance, though validation accepts any batch size of at least one so the two legacy pre-test rows (batches of 10, now soft-deleted) still replay from the immutable event log.

## Fields

| Field | Description |
| ----- | ----------- |
| `batch_id` | Unique id of the batch (client-generated). |
| `owner_sub` | Google `sub` of the user the batch belongs to. Stamped server-side from the session; never trusted from the client. |
| `test_id` | The [test](./tests.md) this batch belongs to. `NULL` only for the legacy pre-test rows. |
| `distance` | Distance in feet, 12–33. |
| `batch_size` | Number of putts thrown (≥ 1; the daily test uses 5). |
| `made` | Number made, between 0 and `batch_size`. |

## Relationships

- References at most one [test](./tests.md), via `test_id`.

## Ownership & isolation

Reads are filtered by `owner_sub`, so each user sees only their own batches.
Logged-out visitors see the public demo owner's batches instead (see the backend query endpoints).
The edit and delete handlers scope their writes by `owner_sub` as well as `batch_id`.
A forged id can only ever be a no-op against another user's row, never an edit of it.
