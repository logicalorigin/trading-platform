#!/usr/bin/env bash
set -Eeuo pipefail

api_pid=""
web_pid=""

stop_children() {
  local status=${1:-0}

  trap - INT TERM EXIT

  if [[ -n "${api_pid}" ]] && kill -0 "${api_pid}" 2>/dev/null; then
    kill -- -"${api_pid}" 2>/dev/null || kill "${api_pid}" 2>/dev/null || true
  fi

  if [[ -n "${web_pid}" ]] && kill -0 "${web_pid}" 2>/dev/null; then
    kill -- -"${web_pid}" 2>/dev/null || kill "${web_pid}" 2>/dev/null || true
  fi

  wait "${api_pid}" "${web_pid}" 2>/dev/null || true
  exit "${status}"
}

trap 'stop_children 130' INT
trap 'stop_children 143' TERM
trap 'stop_children $?' EXIT

echo "Starting RayAlgo API on 8080 and web on 18747."
echo "IBKR live broker features use the Windows IB Gateway activation flow from the RayAlgo header."

setsid env PORT=8080 LOG_LEVEL=warn pnpm --filter @workspace/api-server run dev &
api_pid=$!

setsid env PORT=18747 BASE_PATH=/ pnpm --filter @workspace/rayalgo run dev &
web_pid=$!

wait -n "${api_pid}" "${web_pid}"
exit_status=$?
stop_children "${exit_status}"
