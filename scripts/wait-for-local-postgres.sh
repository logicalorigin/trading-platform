#!/usr/bin/env bash
# Lightweight readiness check for the workspace-local Postgres unix socket.
# Used by the api-server dev script to give the dedicated `Local Postgres`
# workflow a brief head start during cold app bring-up. We deliberately do
# NOT start Postgres from inside the api-server cgroup any more — Postgres
# is its own workflow so that an api-server restart no longer SIGKILLs it.
#
# Fail-fast in local mode: exits non-zero with a clear operator message
# if Postgres is not reachable within 10s. Skips entirely (exits 0) when
# the project is wired to a hosted DATABASE_URL instead of local PG.
set -u

PGROOT="${PGROOT:-/home/runner/workspace/.local/postgres}"
SOCK="$PGROOT/run/.s.PGSQL.5432"

# Decide whether local PG is the selected DB source. Skip entirely when
# the project is wired to a hosted DATABASE_URL.
local_mode=0
case "${RAYALGO_DATABASE_SOURCE:-}" in
  local|workspace-local-postgres|local-postgres) local_mode=1 ;;
  *)
    if [ -z "${DATABASE_URL:-}" ] && [ -n "${LOCAL_DATABASE_URL:-}" ]; then
      local_mode=1
    fi
    ;;
esac
if [ "$local_mode" -ne 1 ]; then
  exit 0
fi

deadline=$(( $(date +%s) + 10 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -S "$SOCK" ] && psql -h "$PGROOT/run" -U runner -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.25
done

echo "[wait-for-local-postgres] FATAL: workspace-local Postgres is not reachable on $SOCK after 10s, but RAYALGO_DATABASE_SOURCE/LOCAL_DATABASE_URL says local is the selected DB source." >&2
echo "[wait-for-local-postgres] Start the 'Local Postgres' workflow (it should autoStart with the app), or run: bash scripts/run-local-postgres.sh" >&2
echo "[wait-for-local-postgres] Refusing to bring up the api-server with a missing local DB. Exiting non-zero." >&2
exit 1
