#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")/.."

API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-18747}"
WEB_BASE_PATH="${BASE_PATH:-/}"
WEB_API_TARGET="${VITE_PROXY_API_TARGET:-http://127.0.0.1:${API_PORT}}"

pids=()

cleanup() {
  local status=$?
  trap - EXIT INT TERM

  if ((${#pids[@]})); then
    echo "[replit-dev] stopping child services: ${pids[*]}"
    for pid in "${pids[@]}"; do
      kill -TERM "$pid" 2>/dev/null || true
    done
    for pid in "${pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi

  exit "$status"
}

trap cleanup EXIT INT TERM

echo "[replit-dev] starting API on ${API_PORT}"
LOG_LEVEL="${LOG_LEVEL:-warn}" PORT="${API_PORT}" pnpm --filter @workspace/api-server run dev &
pids+=("$!")

echo "[replit-dev] starting RayAlgo web on ${WEB_PORT}"
PORT="${WEB_PORT}" BASE_PATH="${WEB_BASE_PATH}" VITE_PROXY_API_TARGET="${WEB_API_TARGET}" \
  pnpm --filter @workspace/rayalgo run dev &
pids+=("$!")

set +e
wait -n "${pids[@]}"
status=$?
set -e

echo "[replit-dev] a child service exited with status $status"
exit "$status"
