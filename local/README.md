# Local Development Instructions

## Required environment variables
| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client id; the backend won't boot without it. |
| `ADMIN_SUBS` | No | Comma-separated admin allowlist of Google `sub` ids; sign in with a listed account to get admin locally. |
| `DEMO_OWNER_SUB` | No | Google `sub` whose data signed-out visitors see; overrides the code default. |

## Commands
- **Start app**: `./run_dev_env.sh`
- **Restart app after changing frontend dependancies**: `docker-compose down -v` -> `docker-compose up`
- **Run unit tests**: `docker-compose run --rm backend python -m unittest discover -s tests -v`
- **Deploy to prod**: `./deploy.sh`
- **Clone Prod DB**: `./pull_prod_db.sh`
