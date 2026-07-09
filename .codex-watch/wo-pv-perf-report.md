# WO-PV-PERF Report

## Scope

- Touched `artifacts/pyrus/src/features/platform/performanceMetrics.ts`.
- Added this report at `.codex-watch/wo-pv-perf-report.md`.
- Left changes unstaged.

## Observed

- `installPyrusPerformanceMetrics()` previously registered the global API timing listener and long-task observer but did not return an uninstall path.
- The reporter hook cleanup removed only its interval, screen-ready listener, and visibility listener.
- A focused inline `node --import tsx` unit test now verifies install, uninstall, listener/observer removal, reinstall, and stale disposer idempotence.

## Change

- `installPyrusPerformanceMetrics()` now returns the active disposer.
- The disposer removes the API timing listener, removes the `beforeunload` listener, disconnects the long-task observer, resets `metrics.installed`, and clears the stored disposer.
- `usePyrusPerformanceMetricsReporter()` calls the disposer during effect cleanup.

## Verification

Passed:

```sh
pnpm exec node --import tsx - <<'EOF'
# inline unit assertions for performanceMetrics install/uninstall lifecycle
EOF
```

Not run, per work order: browser, Playwright, e2e, browser waterfall, screenshots, project-wide typecheck, or full test suite.
