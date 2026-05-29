# Local API Port Diagnosis

- Date: 2026-05-29
- Symptom: `curl http://127.0.0.1:5000/...` failed with connection refused after the IBKR line-utilization commit.

## Root Cause

The local API was not down. The Replit PYRUS dev runner binds the API to port `8080`, while Vite/web listens on `18747` and proxies `/api` to `http://127.0.0.1:8080`.

The failed check used the wrong port (`5000`). There is no listener on `127.0.0.1:5000`.

## Evidence

- Active listeners included API on `8080` and Vite on `18747`.
- `http://127.0.0.1:8080/api/healthz` returned `{"status":"ok"}`.
- `http://127.0.0.1:18747/api/healthz` returned `{"status":"ok"}` through the web dev proxy.
- `http://127.0.0.1:5000/api/healthz` returned `ECONNREFUSED`.
- `artifacts/pyrus/scripts/runDevApp.mjs` defaults `PYRUS_API_PORT` to `8080`.
- `artifacts/pyrus/vite.config.ts` defaults `VITE_PROXY_API_TARGET` to `http://127.0.0.1:8080`.

## Status

DONE. No code change needed.
