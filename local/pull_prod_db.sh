#!/usr/bin/env bash
# Overwrite the local dev database with a copy of the production database.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="$(sed -n 's/.*"terraform_app_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' app.config.json | head -1)"
[ -n "$APP" ] || { echo "Could not read terraform_app_name from app.config.json" >&2; exit 1; }

PEM="infrastructure/$APP.pem"
HOST="ubuntu@$APP.stephengb.com"
LOCAL_DB="backend/app.db"

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR)

docker compose -f local/docker-compose.yml down

echo "==> Folding prod's WAL into the db and copying it out of the backend container..."
ssh -i "$PEM" "${SSH_OPTS[@]}" "$HOST" '
  docker exec backend python -c "import sqlite3; c=sqlite3.connect(\"/app/app.db\"); c.execute(\"PRAGMA wal_checkpoint(TRUNCATE)\"); c.close()"
  docker cp backend:/app/app.db /tmp/prod-app.db
'

echo "==> Replacing $LOCAL_DB with the prod copy..."
rm -f "$LOCAL_DB" "$LOCAL_DB-wal" "$LOCAL_DB-shm"
scp -i "$PEM" "${SSH_OPTS[@]}" "$HOST:/tmp/prod-app.db" "$LOCAL_DB"

echo "==> Done."
