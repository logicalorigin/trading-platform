#!/usr/bin/env bash
# Lightweight readiness check for the workspace-local Postgres unix socket.
# Used by one-off checks that only need to verify whether workspace-local
# Postgres is already reachable. The api-server dev command starts local
# Postgres via scripts/start-local-postgres.sh because root .replit workflows
# are intentionally not used for app bring-up in this workspace.
#
# Fail-fast when DATABASE_URL points at the workspace-local socket: exits
# non-zero with a clear operator message if Postgres is not reachable within
# 10s. Skips entirely (exits 0) when the project is wired to a hosted DB.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PGROOT="${PGROOT:-$REPO_ROOT/.local/postgres}"
SOCK="$PGROOT/run/.s.PGSQL.5432"

# Decide whether local PG is the selected DB source. DATABASE_URL is the only
# runtime database input; local mode is inferred from its socket host.
local_mode=0
case "${DATABASE_URL:-}" in
  *".local/postgres"*|*"host=$PGROOT/run"*) local_mode=1 ;;
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

echo "[wait-for-local-postgres] FATAL: workspace-local Postgres is not reachable on $SOCK after 10s, but DATABASE_URL points at the local socket." >&2
echo "[wait-for-local-postgres] Start it with: bash scripts/start-local-postgres.sh" >&2
echo "[wait-for-local-postgres] Refusing to bring up the api-server with a missing local DB. Exiting non-zero." >&2
exit 1
