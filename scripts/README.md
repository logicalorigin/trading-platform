# Utility Scripts

These scripts are developer/operator utilities. Replit app startup remains owned
by `artifacts/pyrus/.replit-artifact/artifact.toml`; do not use this
directory to define separate Replit app runners.

## Backtesting Utilities

- `run-options-contract-sweeps.mjs` queues signal-options backtest sweeps for the
  currently enabled shadow signal-options deployment. It requires database access
  via `DATABASE_URL`, and talks to the API using `BACKTEST_API_BASE_URL` or
  `API_BASE_URL`.
- `pyrus-signals:signal-options-sweep` runs the Pyrus Signals signal-options
  `timeHorizon`/structure sensitivity sweep through the existing shadow backfill
  path, holds the signal-options worker advisory lock, writes JSON/CSV/Markdown
  reports, and can replay the top eligible variant into the shadow ledger.
- `signal-options:exit-policy-sweep` runs the exit-policy variant sweep for the
  enabled Pyrus Signals signal-options shadow deployment. By default it is a dry
  run only and writes JSON/CSV/Markdown reports under
  `scripts/reports/signal-options-exit-policy-sweeps/`.
  - Dry run:
    `DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run signal-options:exit-policy-sweep`
  - Replay the top eligible ranked variant into the shadow ledger:
    `DATABASE_URL=postgres://... SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_WINNER=1 pnpm --filter @workspace/scripts run signal-options:exit-policy-sweep`
  - Replay a specific eligible variant:
    `DATABASE_URL=postgres://... SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_WINNER=1 SIGNAL_OPTIONS_EXIT_SWEEP_REPLAY_VARIANT=trail-ladder-aggressive-early8-loss25 pnpm --filter @workspace/scripts run signal-options:exit-policy-sweep`
  - Common selectors: `SIGNAL_OPTIONS_EXIT_SWEEP_START`,
    `SIGNAL_OPTIONS_EXIT_SWEEP_END`, `SIGNAL_OPTIONS_EXIT_SWEEP_FAMILIES`,
    `SIGNAL_OPTIONS_EXIT_SWEEP_VARIANTS`, and
    `SIGNAL_OPTIONS_EXIT_SWEEP_SYMBOLS`.
- `artifacts/api-server/scripts/sampleFlowPremiumDistribution.mjs` is a manual
  Massive sampling utility for inspecting premium-distribution aggregation.
- `shadow:massive-options-audit` reads the existing shadow option ledger rows,
  checks their recorded trade/aggregate provenance against Massive
  historical options endpoints, and writes JSON/CSV/Markdown reports under
  `scripts/reports/shadow-massive-options-audit/`.
  - Run:
    `DATABASE_URL=postgres://... MASSIVE_API_KEY=... pnpm --filter @workspace/scripts run shadow:massive-options-audit`
  - Optional selectors: `SHADOW_MASSIVE_AUDIT_ACCOUNT_ID`,
    `SHADOW_MASSIVE_AUDIT_CONCURRENCY`, `SHADOW_MASSIVE_AUDIT_MAX_ROWS`, and
    `SHADOW_MASSIVE_AUDIT_REPORT_DIR`.
- `shadow:management-review` reads the committed shadow option `automation`
  ledger, ranks management leaks by exit reason/symbol/signal quality, folds in
  prior dry sweep evidence when present, and writes Markdown/JSON/CSV reports
  under `scripts/reports/shadow-options-management-review/`.
  - Run:
    `DATABASE_URL=postgres://... pnpm --filter @workspace/scripts run shadow:management-review`
  - Optional selectors: `SHADOW_OPTIONS_MANAGEMENT_REVIEW_ACCOUNT_ID`,
    `SHADOW_OPTIONS_MANAGEMENT_REVIEW_START`,
    `SHADOW_OPTIONS_MANAGEMENT_REVIEW_END`,
    `SHADOW_OPTIONS_MANAGEMENT_REVIEW_TOP_LEAKS`,
    `SHADOW_OPTIONS_MANAGEMENT_REVIEW_SWEEP_ROOT`, and
    `SHADOW_OPTIONS_MANAGEMENT_REVIEW_REPORT_DIR`.

## Audit Guardrails

- `check-env-example.mjs` verifies that JS/TS app-code environment references are
  documented in `.env.example`.
- `check-replit-startup-guards.mjs` verifies that `.replit` stays in
  `PNPM_WORKSPACE` artifact mode, PYRUS keeps its guarded artifact identity, and the
  PYRUS web artifact owns full app bring-up. It also guards the
  Replit-workflow replacement path in `reap-dev-port.mjs`, the duplicate-start
  supervisor no-op policy, and the supervisor lifecycle JSONL evidence path.
- `protect-replit-config.mjs` locks or unlocks Replit startup config files
  (`.replit`, `replit.nix`, and artifact TOMLs) with filesystem permissions.
  Keep them locked during routine work; unlock only for an intentional
  startup-config maintenance window.
- `check-api-codegen-drift.mjs` regenerates the OpenAPI clients and fails if the
  generated output changes.
- `check-markdown-paths.mjs` verifies path-like references in maintained docs.
  It intentionally skips historical audit and handoff notes.
- `run-validation-command.mjs` wraps broad validation commands that can contend
  with the live PYRUS app. Root `typecheck:libs` runs through this wrapper, which
  reads `.pyrus-runtime/flight-recorder/current.json` and the
  `/tmp/pyrus/pyrus-dev-supervisor-8080.lock` owner process to detect whether the
  Replit-owned supervisor is hot, writes a JSONL ledger to
  `.pyrus-runtime/validation/commands.jsonl`, and holds a single-validation lock.
  The hot-runtime refusal is **disabled by default** (the hot signal was firing
  false positives — app reported hot while idle — wrongly blocking harmless
  checks); the wrapper logs the detected state but runs anyway. Set
  `PYRUS_ENFORCE_HOT_VALIDATION=1` to re-enable the refusal once detection is
  trustworthy. Use targeted package tests during live app work;
  `PYRUS_ALLOW_HOT_VALIDATION=1` stays a one-off bypass when the refusal is enforced.
- `diagnose-agent-restarts.mjs` is observe-only restart attribution. It
  correlates `.pyrus-runtime/flight-recorder` incidents with surviving Codex
  session JSONL, Codex SQLite logs, Replit runtime file mtimes, and workflow log
  tails. It reports risky nearby activity categories such as workflow, browser,
  live API, policy, and resource risks, but it does not block commands or prove
  host-side Replit button/API provenance when that evidence is unavailable
  inside the guest.
- `replit:scribe:artifacts` audits Replit Scribe artifact iframe state from
  `.local/state/scribe/scribe.db`. The default run is read-only and reports live
  artifact iframes plus duplicate/stale cleanup candidates. Use
  `PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP=1 pnpm run replit:scribe:artifacts -- --backup-and-clean --confirm-control-plane-cleanup`
  only for an explicit control-plane maintenance window; it copies the DB to a
  timestamped backup before deleting selected artifact rows and writing
  tombstones. The extra env var and confirmation flag exist because artifact
  cleanup may trigger Replit artifact/env reconciliation.

## IBKR Utilities

- `package-ibkr-bridge-bundle.mjs` packages the Windows-side IBKR bridge bundle.
- `start-local-postgres.sh`, `wait-for-local-postgres.sh`, and
  `run-local-postgres.sh` support manual workspace-local Postgres fallback
  diagnosis. They are not part of normal Replit app bring-up.
- `reap-dev-port.mjs` clears same-cgroup dev processes before package dev
  scripts start. When run by Replit itself (`REPLIT_MODE=workflow`), it can
  replace older Replit execution scopes on the same pinned port.
  `PYRUS_REPLIT_RUN=1` is a tag only, not restart authority.
- `artifacts/pyrus/scripts/runDevApp.mjs` owns full dev app bring-up. A
  duplicate Replit-owned Run event exits without restart only during the
  startup guard window while the supervisor lock points at a live
  `artifacts/pyrus/scripts/runDevApp.mjs` process. After
  `PYRUS_DEV_DUPLICATE_RESTART_AFTER_MS` (default `30000`), a new Replit-owned
  Run is treated as an intentional Run-button restart and uses a controlled
  handoff so the current workflow owns API/Vite again. Use
  `PYRUS_DEV_FORCE_RESTART=1` only for an intentional Replit-owned recovery
  restart that may request a controlled handoff from a live supervisor. Shell
  smoke tests for the duplicate path must include
  `PYRUS_DEV_DUPLICATE_CHECK_ONLY=1`; that mode reads the supervisor lock and
  exits without starting API/web processes.
- The supervisor writes lifecycle evidence to
  `/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl`, including heartbeats, child
  starts/exits, duplicate-start no-ops, ignored SIGHUP, shutdown, and previous
  heartbeat classification.
