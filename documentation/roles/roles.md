# Roles

| Role | Description |
| --- | --- |
| `public` | Read-only. This role should have full use of the read-only pages (e.g. `History`, `Leaderboard`, `Compare`). This role should not have access to log daily putts. Unauthenticated users should adopt these permissions. |
| `user` | This is the default role assigned to all newly created users. In addition to the features available to the public role, this role should have access to log daily putts. |
| `admin` | In addition to the features of the user role, admins can also freely change the roles of other users. |
