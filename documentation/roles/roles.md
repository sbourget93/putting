# Roles

| Role | Description |
| --- | --- |
| `public` | Read-only. This role should have full use of the read-only pages (e.g. `History`, `Leaderboard`, `Compare`). This role should not have access to log daily putts. Unauthenticated users should adopt these permissions. |
| `user` | This is the default role assigned to all newly created users. In addition to the features available to the public role, this role should have access to log daily putts. |
| `op` | In addition to the features of the user role, ops can also freely change the roles of other users. |

## Admins
Admins have the same permissions as op. Admin is not an assignable role stored in the projections. A user is treated as admin whenever their email is in `ADMIN_EMAILS`, evaluated on every request.

Admin permissions as a result of modifying `ADMIN_EMAILS` take effect after the next server restart.