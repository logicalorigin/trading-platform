# Utility Scripts

These scripts are developer/operator utilities. Artifact dev startup remains owned by
`artifacts/*/.replit-artifact/artifact.toml`; do not use this directory to define
Replit app runners.

## Backtesting Utilities

- `run-options-contract-sweeps.mjs` queues signal-options backtest sweeps for the
  currently enabled shadow signal-options deployment. It requires database access
  via `DATABASE_URL`, and talks to the API using `BACKTEST_API_BASE_URL` or
  `API_BASE_URL`.
- `artifacts/api-server/scripts/sampleFlowPremiumDistribution.mjs` is a manual
  Polygon sampling utility for inspecting premium-distribution aggregation.

## Audit Guardrails

- `check-env-example.mjs` verifies that JS/TS app-code environment references are
  documented in `.env.example`.
- `check-api-codegen-drift.mjs` regenerates the OpenAPI clients and fails if the
  generated output changes.
- `check-markdown-paths.mjs` verifies path-like references in maintained docs.
  It intentionally skips historical audit and handoff notes.

## IBKR Utilities

- `package-ibkr-bridge-bundle.mjs` packages the Windows-side IBKR bridge bundle.
- `start-local-postgres.sh`, `wait-for-local-postgres.sh`, and
  `run-local-postgres.sh` support local API validation.
- `reap-dev-port.mjs` clears same-cgroup dev processes before package dev
  scripts start.
