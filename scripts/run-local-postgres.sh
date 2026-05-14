#!/usr/bin/env bash
# Foreground entry point for the workspace-local Postgres workflow.
# Runs `postgres` in the foreground so Replit's workflow supervisor owns
# the postmaster PID. This keeps Postgres in its own workflow cgroup,
# decoupled from the api-server cgroup, so an api-server restart no
# longer SIGKILLs the database.
#
# Idempotent: initdb if needed, evict a stale postmaster.pid, then exec.
# For one-off use, `scripts/start-local-postgres.sh` still daemonizes via
# pg_ctl and is unchanged.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PGROOT="${PGROOT:-$REPO_ROOT/.local/postgres}"
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

# If a previous postmaster is still alive (e.g. started by the legacy
# pg_ctl path), refuse to start: a tail-only fallback would keep this
# workflow "running" while the workflow supervisor has no signal about
# the foreign postmaster's liveness.
if [ -s "$PGROOT/data/postmaster.pid" ]; then
  pid="$(sed -n '1p' "$PGROOT/data/postmaster.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && [ -d "/proc/$pid" ]; then
    cmd="$(tr -d '\0' < /proc/$pid/cmdline 2>/dev/null || true)"
    if [[ "$cmd" == *postgres* ]]; then
      echo "[run-local-postgres] postmaster pid=$pid already running outside this workflow." >&2
      echo "[run-local-postgres] Refusing to start a tail-only fallback (workflow health would not reflect DB liveness)." >&2
      echo "[run-local-postgres] Stop the existing postmaster (pg_ctl -D \"$PGROOT/data\" -m fast stop) and let this workflow restart." >&2
      exit 1
    fi
  fi
  rm -f "$PGROOT/data/postmaster.pid" \
    "$PGROOT/run/.s.PGSQL.5432" \
    "$PGROOT/run/.s.PGSQL.5432.lock"
fi

# Ensure the `dev` database exists. Start postgres briefly via pg_ctl just
# for this bootstrap, then stop it before exec'ing foreground postgres.
if ! psql -h "$PGROOT/run" -U runner -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
  pg_ctl -D "$PGROOT/data" -l "$PGROOT/log/pg.log" -w start >/dev/null
  trap 'pg_ctl -D "$PGROOT/data" -m fast stop >/dev/null 2>&1 || true' EXIT
  psql -h "$PGROOT/run" -U runner -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='dev'" 2>/dev/null | grep -q 1 \
    || psql -h "$PGROOT/run" -U runner -d postgres -c "CREATE DATABASE dev" >/dev/null
  pg_ctl -D "$PGROOT/data" -m fast stop >/dev/null
  trap - EXIT
fi

echo "[run-local-postgres] starting foreground postgres on $PGROOT/run"
exec postgres -D "$PGROOT/data"
