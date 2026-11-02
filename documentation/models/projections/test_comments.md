# Test Comment

One comment left on a daily [`test`](./tests.md), shown on the daily leaderboard.


## Fields

| Field | Description |
| ----- | ----------- |
| `comment_id` | Unique id of the comment. |
| `owner_sub` | Google `sub` of the user who wrote the comment. |
| `test_id` | Id of the [test](./tests.md) the comment is attached to. |
| `body` | The comment text, at most 1000 characters. |

## Relationships

- Attached to one [test](./tests.md).
- Authored by one [user](./users.md).
