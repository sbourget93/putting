# Batch

One recorded set of [`putts`](./putts.md) thrown from a single distance.

## Fields

| Field | Description |
| ----- | ----------- |
| `batch_id` | Unique id of the batch. |
| `owner_sub` | Google `sub` of the user the batch belongs to. |
| `test_id` | The [test](./tests.md) the batch belongs to. |
| `distance` | Distance in feet, 12–33. |
| `batch_size` | Number of putts thrown. |
| `made` | Number made, between 0 and `batch_size`. |

`batch_size` and `made` will be deprecated once the [`putts`](./putts.md) object is fully implemented and backfill events are generated.

## Relationships

- Belongs to one [test](./tests.md).
