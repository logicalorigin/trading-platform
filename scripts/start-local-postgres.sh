#!/usr/bin/env bash
# Idempotent: ensures a workspace-local Postgres cluster is initialized,
# running on a unix socket, and has the `dev` database. Exits 0 on success.
# Used as a pre-step by the api-server dev script while the Replit-managed
# Helium dev DB is unavailable.
set -euo pipefail
PGROOT="${PGROOT:-/home/runner/workspace/.local/postgres}"
mkdir -p "$PGROOT/run" "$PGROOT/log"
if [ ! -s "$PGROOT/data/PG_VERSION" ]; then
  initdb -D "$PGROOT/data" -U runner --auth=trust -E UTF8 --locale=C >/dev/null
  cat > "$PGROOT/data/postgresql.auto.conf" <<EOF
listen_addresses = ''
unix_socket_directories = '$PGROOT/run'
log_destination = 'stderr'
logging_collector = off
max_connections = 50
shared_buffers = 64MB
EOF
fi
if ! pg_ctl -D "$PGROOT/data" status >/dev/null 2>&1; then
  pg_ctl -D "$PGROOT/data" -l "$PGROOT/log/pg.log" -w start >/dev/null
fi
psql -h "$PGROOT/run" -U runner -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='dev'" 2>/dev/null | grep -q 1 \
  || psql -h "$PGROOT/run" -U runner -d postgres -c "CREATE DATABASE dev" >/dev/null
echo "[local-postgres] ready: postgres:///dev?host=$PGROOT/run"
