# Utility Scripts

These scripts are developer/operator utilities. Replit app startup remains owned
by `artifacts/rayalgo/.replit-artifact/artifact.toml`; do not use this
directory to define separate Replit app runners.

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
- `check-replit-startup-guards.mjs` verifies that `.replit` stays in
  `PNPM_WORKSPACE` artifact mode, RayAlgo keeps its artifact identity, and the
  RayAlgo web artifact owns full app bring-up. It also guards the
  Replit-workflow replacement path in `reap-dev-port.mjs`.
- `protect-replit-config.mjs` locks or unlocks Replit startup config files
  (`.replit`, `replit.nix`, and artifact TOMLs) with filesystem permissions.
  Keep them locked during routine work; unlock only for an intentional
  startup-config maintenance window.
- `check-api-codegen-drift.mjs` regenerates the OpenAPI clients and fails if the
  generated output changes.
- `check-markdown-paths.mjs` verifies path-like references in maintained docs.
  It intentionally skips historical audit and handoff notes.

## IBKR Utilities

- `package-ibkr-bridge-bundle.mjs` packages the Windows-side IBKR bridge bundle.
- `start-local-postgres.sh`, `wait-for-local-postgres.sh`, and
  `run-local-postgres.sh` support manual workspace-local Postgres fallback
  diagnosis. They are not part of normal Replit app bring-up.
- `reap-dev-port.mjs` clears same-cgroup dev processes before package dev
  scripts start. When run by Replit itself (`REPLIT_MODE=workflow`), it can
  replace older Replit execution scopes on the same pinned port.
