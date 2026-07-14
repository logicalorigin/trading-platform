#!/usr/bin/env bash
# Idempotent: ensures a workspace-local Postgres cluster is initialized,
# running on a unix socket, and has the `dev` database. Exits 0 on success.
# Manual fallback only. Normal Replit app bring-up should use the managed PG*
# environment and must not start local Postgres from the API artifact.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PGROOT="${PGROOT:-$REPO_ROOT/.local/postgres}"
readonly LOCAL_PGPORT=5432
readonly PSQL_TIMEOUT_SECONDS=5
export PGPORT="$LOCAL_PGPORT"

fatal() {
  echo "[local-postgres] FATAL: $1" >&2
  exit 1
}

run_psql() {
  PGCONNECT_TIMEOUT="$PSQL_TIMEOUT_SECONDS" \
    timeout --kill-after=1s "${PSQL_TIMEOUT_SECONDS}s" \
    psql -h "$PGROOT/run" -p "$LOCAL_PGPORT" -U runner "$@"
}

mkdir -p "$PGROOT/run" "$PGROOT/log"
if [ ! -s "$PGROOT/data/PG_VERSION" ]; then
  initdb -D "$PGROOT/data" -U runner --auth=trust -E UTF8 --locale=C >/dev/null
  cat > "$PGROOT/data/postgresql.auto.conf" <<EOF
listen_addresses = ''
unix_socket_directories = '$PGROOT/run'
log_destination = 'stderr'
logging_collector = off
port = $LOCAL_PGPORT
max_connections = 50
shared_buffers = 64MB
EOF
fi

can_connect() {
  run_psql -d postgres -tAc "SELECT 1" >/dev/null 2>&1
}

clear_stale_artifacts() {
  local pid_file="$PGROOT/data/postmaster.pid"
  local socket_file="$PGROOT/run/.s.PGSQL.$LOCAL_PGPORT"
  local lock_file="$socket_file.lock"
  local pid lock_pid status

  [ -s "$pid_file" ] || return 0
  pid="$(sed -n '1p' "$pid_file")"
  if ! [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
    fatal "refusing to remove artifacts with an invalid postmaster PID"
  fi
  if pg_ctl -D "$PGROOT/data" status >/dev/null 2>&1; then
    fatal "PostgreSQL reports a running but unreachable local cluster"
  else
    status=$?
  fi
  if [ "$status" -ne 3 ]; then
    fatal "cannot prove the local cluster is stopped"
  fi
  if ps -p "$pid" -o pid= >/dev/null 2>&1; then
    fatal "postmaster PID is still live; refusing stale-artifact cleanup"
  fi
  if [ -e "$socket_file" ] && [ ! -s "$lock_file" ]; then
    fatal "local socket has no matching ownership lock"
  fi
  if [ -e "$lock_file" ]; then
    lock_pid="$(sed -n '1p' "$lock_file")"
    if [ "$lock_pid" != "$pid" ]; then
      fatal "postmaster and socket-lock ownership do not match"
    fi
  fi

  rm -f "$pid_file" "$socket_file" "$lock_file"
}

if ! can_connect; then
  clear_stale_artifacts
  # ponytail: manual-only use keeps one log and serial check/create; add
  # rotation plus an operator lock before any automated or long-lived caller.
  pg_ctl -D "$PGROOT/data" -l "$PGROOT/log/pg.log" \
    -o "-p $LOCAL_PGPORT" -w start >/dev/null
fi
if ! database_exists="$(run_psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='dev'" 2>/dev/null)"; then
  fatal "database existence probe failed"
fi
if [ "$database_exists" != "1" ]; then
  run_psql -d postgres -c "CREATE DATABASE dev" >/dev/null
fi
echo "[local-postgres] ready: postgres:///dev?host=$PGROOT/run&port=$LOCAL_PGPORT"
