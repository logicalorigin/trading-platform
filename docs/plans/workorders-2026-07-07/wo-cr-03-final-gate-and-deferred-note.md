# WO-CR-03 — code-reduction final gate + deferred-items note (code-reduction lane, close-out)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, closing out the
code-reduction lane. Predecessors: WO-CR-01 and WO-CR-02 (reports in `.codex-watch/`).

## Gate (check-and-abort)

1. `.codex-watch/wo-cr-01-report.md` AND `.codex-watch/wo-cr-02-report.md` exist with green
   final gates.
2. `.codex-watch/wo-cr-03-report.md` does not already exist.

## Ownership + tree rules

Read the "Ownership + tree rules" section of
`docs/plans/workorders-2026-07-07/wo-cr-01-apiserver-helper-consolidation.md`; it binds here
verbatim (authoritative live-dirty skip rule, explicit-path staging, no `-A`/`.`/stash/reset).
This WO edits at most ONE new file (the deferred-items note) — everything else is verification;
its commit stages exactly `git add -- docs/plans/2026-07-08-code-reduction-deferred.md` and
nothing else. This WO additionally authorizes one Replit-managed workflow
restart described below. Never signal or shell-launch a supervisor.

## Tasks

**T1 — full static gate.** From repo root:
- `pnpm run typecheck` — green, or red ONLY inside other lanes' dirty files (record exactly).
- `pnpm --filter @workspace/pyrus run build` and `pnpm --filter @workspace/api-server run build`.
- `pnpm run deadcode > /tmp/deadcode-final.txt; pnpm run deadcode:prod > /tmp/deadcode-prod-final.txt`
  and diff both against `.codex-watch/code-reduction-baselines/deadcode-baseline.txt` /
  `deadcode-prod-baseline.txt`. Expected deltas ONLY:
  (a) files deleted by this lane's commits are gone from "Unused files";
  (b) `@radix-ui/react-slider` remains listed (removal deferred — pnpm-lock is lane-owned);
  (c) other lanes' new files may appear (e.g. `scripts/src/shadow-options-*`) — record, ignore;
  (d) any consolidation slice may have removed dup-export findings.
  Any UNEXPLAINED new finding = investigate before proceeding.

**T2 — guard tests.** From `artifacts/pyrus`:
`node --test src/components/marketing/brandKitInstall.test.mjs src/features/platform/loadingFallbackTheme.test.mjs src/screens/account/accountResilienceMarkers.contract.test.mjs`
— the ONLY acceptable failure is the pre-existing "React loaders use the current Pyrus brand
kit assets" (index.html /brand/ favicon, predates this lane).

**T3 — runtime gate (authorized).**
- Use Replit's managed workflow restart action.
- Poll `http://127.0.0.1:8080/api/healthz` until 200 (≤60s).
- `curl -sf -o /dev/null -w "%{http_code}" "https://$REPLIT_DEV_DOMAIN/api/healthz"` → 200.
- `pnpm shot "http://127.0.0.1:18747/?screen=market" --out /tmp/market-final.png --wait 9000 --json`
  → status 200, consoleErrorCount 0; Read the PNG — expect the login gate (unauthenticated
  headless is a known limitation; the check is clean boot, zero console errors, no crash screen).

**T4 — write the deferred-items note** at
`docs/plans/2026-07-08-code-reduction-deferred.md` (commit it, message
`docs: code-reduction deferred items and pre-existing failures ledger`):
- Deferred until the backtesting lane lands (owns `backtest-worker/*` + `pnpm-lock.yaml`):
  delete `artifacts/backtest-worker/src/pattern-discovery-sweep.ts`,
  `artifacts/backtest-worker/src/pattern-discovery.smoke.ts`, and — at the backtest-worker
  PACKAGE root, not repo root — `artifacts/backtest-worker/horizon-{50tickers,90d-probe,merge,shard}.ts`
  and `artifacts/backtest-worker/fetch-bars.ts` (~1,700 lines total, knip-flagged, no imports
  outside backtest-worker as of 2026-07-07); then remove `@radix-ui/react-slider` from
  `artifacts/pyrus/package.json` (orphaned since commit `12aa4346`).
- ALIAS DROP (do NOT describe it as script-gated only): `DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS`
  in `lib/pyrus-signals-core/src/index.ts` (~205-206) has external consumers BEYOND the horizon
  scripts: `artifacts/api-server/src/services/shadow-account.ts` (4 refs, lane-owned),
  `artifacts/backtest-worker/src/pattern-discovery.ts` (2), `artifacts/backtest-worker/src/index.ts`
  (2). Dropping the alias requires renaming ALL external refs to
  `DEFAULT_PYRUS_SIGNALS_CHART_SIGNAL_SETTINGS` plus ~30 internal refs; the executing lane MUST
  re-run `rg -n "DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS" --glob '!node_modules'` first and treat
  that output as the authoritative consumer list.
- Deferred until the signal-options lane lands: Black-Scholes/`normalCdf` consolidation
  (`lib/backtest-core/src/option-greek-selector.ts` canonical; other copies via
  `rg -n "normalCdf|blackScholes" lib/backtest-core/src/analytics.ts artifacts/api-server/src/services/gex-projection.ts artifacts/api-server/src/services/shadow-account.ts`
  — gex-projection has TWO normalCdf copies; shadow-account is lane-dirty so line anchors drift)
  — requires numeric-parity proof; and every WIP-file helper copy skipped by WO-CR-01/02
  (lists are in their reports).
- Not planned (structural, not reduction): `signal-options-automation.ts` (~20.5k lines) and
  `services/platform.ts` (~19k) splits; EmptyState/Skeleton reuse in non-account screens;
  `pyrus-mark.tsx` brand/marketing unification (both variants live).
- Pre-existing failures ledger (NOT this lane's): bridge-streams snapshot-bootstrap contract
  test (massive-repoint drift — flag to the owner of the massive repoint work);
  loadingFallbackTheme /brand/ favicon assertion (flag to the Slice-8 login/brand owner).
- Note: 10 stale untracked `artifacts/*.log` files (April–May) were moved to the lead session's
  scratchpad grace-hold on 2026-07-07 and will vanish with VM rotation; deletion was
  owner-approved.

## Deliverable

`.codex-watch/wo-cr-03-report.md`: every gate command with verbatim result tails, the knip
before/after diff summary with each delta classified expected/unexplained, runtime gate
evidence (healthz codes, screenshot verdict), deferred-note commit sha, and a final tally of
the lane's total commits + net lines removed (`git log --author-date-order --oneline` range
`8cef8121^..HEAD` filtered to this lane's commits, plus `git diff --shortstat 8cef8121^ HEAD --`
scoped to lane-touched paths is OPTIONAL — a per-commit `--shortstat` list is fine).
