#!/usr/bin/env bash
set -euo pipefail

stopping=0

cleanup_existing() {
  # Clear any existing artifact/dev processes that can race the Replit Run button
  # for the same ports. We keep the match patterns scoped to this workspace.
  pkill -f '/home/runner/workspace/artifacts/rayalgo/node_modules/.bin/../vite/bin/vite.js' >/dev/null 2>&1 || true
  pkill -f '/home/runner/workspace/artifacts/rayalgo/scripts/dev-server.mjs' >/dev/null 2>&1 || true
  pkill -f '/home/runner/workspace/artifacts/mockup-sandbox/node_modules/.bin/../vite/bin/vite.js' >/dev/null 2>&1 || true
  pkill -f 'pnpm --filter @workspace/api-server run dev' >/dev/null 2>&1 || true
  pkill -f '/home/runner/workspace/artifacts/api-server/scripts/dev-server.mjs' >/dev/null 2>&1 || true
  pkill -f '/home/runner/workspace/artifacts/api-server/dist/index.mjs' >/dev/null 2>&1 || true
  pkill -f 'node --enable-source-maps ./dist/index.mjs' >/dev/null 2>&1 || true
}

cleanup() {
  jobs -pr | xargs -r kill >/dev/null 2>&1 || true
  wait || true
}

shutdown() {
  stopping=1
  cleanup
  exit 0
}

trap shutdown INT TERM
trap '[[ $stopping -eq 1 ]] || cleanup' EXIT

cleanup_existing

(
  cd /home/runner/workspace/artifacts/api-server
  export PORT=8080
  export NODE_ENV=development
  exec pnpm run dev
) &
API_PID=$!

(
  cd /home/runner/workspace/artifacts/rayalgo
  export PORT=18747
  export BASE_PATH=/
  export VITE_PROXY_API_TARGET=http://127.0.0.1:8080
  unset VITE_API_BASE_URL
  exec pnpm run dev
) &
WEB_PID=$!

wait -n "$API_PID" "$WEB_PID"
