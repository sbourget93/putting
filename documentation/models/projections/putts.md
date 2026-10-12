# Putt

A record of a single putt.
This will always belong to a [`batch`](./batches.md).
Users may opt to track their individual putts rather than simply record x out of 5 putts made in a single batch.
If a user does not opt in to this feature, putts will still be populated into this table with null values for unknowable information (number, miss_type).

## Fields

| Field | Description |
| ----- | ----------- |
| `putt_id` | Unique id of the putt. |
| `owner_sub` | Google `sub` of the user the putt belongs to. |
| `batch_id` | The batch the putt belongs to. |
| `number` | 1 through 5, representing the order the putts were taken. |
| `made` | Boolean indicating whether or not the putt was made. |
| `miss_type` | Enum indicating where the user missed the putt (HIGH, LOW, LEFT, RIGHT, HIGH_LEFT, HIGH_RIGHT, LOW_LEFT, LOW_RIGHT, SPIT_OUT). |

## Relationships

- Belongs to one [batch](./batches.md).
