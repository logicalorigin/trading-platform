# Utility Scripts

These scripts are developer/operator utilities. Replit app startup remains owned
by `artifacts/pyrus/.replit-artifact/artifact.toml`; do not use this
directory to define separate Replit app runners.

## Backtesting Utilities

- `pyrus-signals:signal-options-sweep` runs the Pyrus Signals signal-options
  `timeHorizon`/structure sensitivity sweep through the existing shadow backfill
  path, holds the signal-options worker advisory lock, writes JSON/CSV/Markdown
  reports, and by default replays the top eligible variant for a full non-MTF
  run. Set `PYRUS_SIGNALS_SWEEP_REPLAY_WINNER=false` for a report-only run;
  smoke and MTF sweeps remain report-only by default.
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
    `SHADOW_MASSIVE_AUDIT_START`, `SHADOW_MASSIVE_AUDIT_END`,
    `SHADOW_MASSIVE_AUDIT_CONCURRENCY`, `SHADOW_MASSIVE_AUDIT_MAX_ROWS`, and
    `SHADOW_MASSIVE_AUDIT_REPORT_DIR`. Start/end use inclusive UTC
    `YYYY-MM-DD` dates.
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
- `shadow:ledger-correction:2026-07-15` is the one-shot, assertion-heavy
  correction for the July 13–14 shadow-options audit. It defaults to a
  transactionally rolled-back dry run. Set `SHADOW_LEDGER_CORRECTION_MODE` to
  `apply`, `reconcile`, `revert-dry-run`, or `revert` only for the corresponding
  operator workflow. Apply/revert intentionally fail on a second invocation.
  After `apply`, restart the managed workflow to clear the in-process
  order-classification memo, then run `reconcile`; after `revert`, reload and
  verify the restored account fold. Balance snapshots remain append-only, so
  the correction is recorded as a July 15 adjustment rather than rewriting
  historical chart points.

## Audit Guardrails

- `check-env-example.mjs` verifies that JS/TS app-code environment references are
  documented in `.env.example`.
- `check-replit-startup-guards.mjs` verifies the single PYRUS artifact owner,
  Replit-owned dev lifecycle, canonical startup-config recovery material, and
  the one-port production supervisor/session-host build contract.
- `protect-replit-config.mjs` locks or unlocks `.replit`, `replit.nix`, and the
  PYRUS artifact TOML for an intentional startup-maintenance window.
- `replit-config-clobber.mjs` detects loss of the tracked Replit startup
  invariants. `restore-replit-config.mjs` compares the live files with
  `scripts/replit-config/`, including the PYRUS artifact TOML snapshot, and
  writes only content-drifted replacements with explicit `--write`.
  Permissions-only drift is directed to `replit:config:lock` and never causes a
  replacement; neither utility starts or restarts the app.
- `check-api-codegen-drift.mjs` regenerates the OpenAPI clients and fails if the
  generated output changes.
- `check-markdown-paths.mjs` verifies path-like references in maintained docs.
  It intentionally skips historical audit and handoff notes.
- `run-validation-command.mjs` wraps broad validation commands so they are
  serialized and recorded. Root `typecheck:libs` runs through this wrapper, which
  writes `.pyrus-runtime/validation/commands.jsonl` as a private, size-capped
  JSONL ledger without persisting command arguments and holds a
  PID/start-time-bound single-validation lock. Interrupt signals are forwarded
  to the validation process group before lock cleanup.
  It does not inspect the live PYRUS supervisor or refuse checks because the app
  is running. Use targeted package tests during live app work when they are
  faster; the wrapper is not a live-runtime admission gate. Malformed, unreadable,
  or different-host locks are preserved for manual inspection instead of being
  guessed stale.
- `diagnose-agent-restarts.mjs` is observe-only restart attribution. It
  correlates `.pyrus-runtime/flight-recorder` incidents with surviving Codex
  session JSONL, Codex SQLite logs, Replit runtime file mtimes, and workflow log
  tails. It reports risky nearby activity categories such as workflow, browser,
  live API, policy, and resource risks, but it does not block commands or prove
  host-side Replit button/API provenance when that evidence is unavailable
  inside the guest. The supervisor marker carries `coverageStartedAt` and a
  30-second heartbeat. Per-boot files under `boot-markers/` are authoritative
  across overlapping VMs; current.json is only a convenience pointer. If the
  current guest's marker is missing, stale, future-dated, corrupt, belongs to
  another boot, or its coverage begins after the selected range, the report
  says evidence is incomplete. A changed guest boot identity proves a
  replacement boundary; absent provider audit records, the exact host trigger
  remains unknown.
- `replit:scribe:artifacts` audits Replit Scribe artifact iframe state from
  `.local/state/scribe/scribe.db`. The default run is read-only and reports live
  artifact iframes plus duplicate/stale cleanup candidates. Use
  `PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP=1 pnpm run replit:scribe:artifacts -- --backup-and-clean --confirm-control-plane-cleanup`
  only for an explicit control-plane maintenance window; it copies the DB to a
  timestamped backup before deleting selected artifact rows and writing
  tombstones. The extra env var and confirmation flag exist because artifact
  cleanup may trigger Replit artifact/env reconciliation.

## IBKR Utilities

- The legacy Windows-side IBKR bridge bundle has been retired; do not add bridge
  packaging or helper-launch scripts back to startup.
- `artifacts/pyrus/scripts/runProductionApp.mjs` owns the one-port production
  API/session-host process tree. When the optional host is enabled, it requires
  signed lifecycle configuration, derives host-bound control keys, forces
  loopback API/Docker targets, and treats either child exit as fatal.
- `pnpm run ibkr:capsule:release` is the reviewed immutable-image
  publish/preload path. `pnpm run ibkr:capsule:density` is the destructive,
  paper-only Reserved VM density proof; neither command may be run without its
  documented operator gates.
- `start-local-postgres.sh` and `wait-for-local-postgres.sh` support manual
  workspace-local Postgres fallback diagnosis. They are not part of normal
  Replit app bring-up.
