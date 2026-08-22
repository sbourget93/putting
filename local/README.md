# Local Development Instructions

## Required environment variables
| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client id; the backend won't boot without it. |
| `ADMIN_EMAILS` | No | Comma-separated admin allowlist; sign in with a listed email to get admin locally. |

## Commands
- **Start app**: `docker-compose up --build`
- **Restart app after changing frontend dependancies**: `docker-compose down -v` -> `docker-compose up`
- **Run unit tests**: `docker-compose run --rm backend python -m unittest discover -s tests -v`
