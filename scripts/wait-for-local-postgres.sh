#!/usr/bin/env bash
# Lightweight readiness check for the workspace-local Postgres unix socket.
# Used by the api-server dev script to give the dedicated `Local Postgres`
# workflow a brief head start during cold app bring-up. We deliberately do
# NOT start Postgres from inside the api-server cgroup any more — Postgres
# is its own workflow so that an api-server restart no longer SIGKILLs it.
#
# Exits 0 either way (the api-server still proceeds and will surface a clear
# DB connection error if PG never comes up). Skips entirely when no local
# PG socket is configured.
set -u

PGROOT="${PGROOT:-/home/runner/workspace/.local/postgres}"
SOCK="$PGROOT/run/.s.PGSQL.5432"

# Only wait if the project is actually configured for the local PG.
case "${RAYALGO_DATABASE_SOURCE:-}" in
  local|workspace-local-postgres|local-postgres) ;;
  *)
    if [ -n "${DATABASE_URL:-}" ] || [ -z "${LOCAL_DATABASE_URL:-}" ]; then
      exit 0
    fi
    ;;
esac

deadline=$(( $(date +%s) + 10 ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -S "$SOCK" ] && psql -h "$PGROOT/run" -U runner -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.25
done

echo "[wait-for-local-postgres] Postgres not reachable on $SOCK after 10s. Start the 'Local Postgres' workflow or run: bash scripts/run-local-postgres.sh" >&2
exit 0
