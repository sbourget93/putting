# Foo
A dummy aggregate for testing application features such as admin writes, public reads, and admin reads.

This object can be removed from non-template applications, although there is no harm in keeping it.
The page that displays `Foos` is hidden by default for non-template apps.

## Fields

| Field | Description |
| ----- | ----------- |
| `foo_id` | Unique id of the foo. |
| `public_value` | A value that anyone can read. |
| `private_value` | A value that only admins can read. |

## Relationships

- None