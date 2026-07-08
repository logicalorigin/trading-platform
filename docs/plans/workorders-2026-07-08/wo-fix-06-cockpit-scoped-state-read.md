# WO-FIX-06 — Cockpit display path uses deployment-scoped state read (stop full-universe reads every 5s)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace, implementing ONE fix.
Working-tree edits ONLY — NO git commands (signal-options-automation.ts is dirty with in-flight work).

IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
Do NOT modify agents/openai.yaml.

## Operating discipline (binding)
Ponytail; fact-first (verify all cites below yourself); surgical; LIVE trading platform — cockpit
DISPLAY data only, do not touch the worker/trading path.

## The finding (investigated + verified today)
The signal-options cockpit SSE (algo-cockpit-streams.ts:167, 5s shared poller) and marketing shadow
dashboard both call `getAlgoDeploymentCockpit` → `withFreshSignalOptionsStateSignals`
(signal-options-automation.ts:13142) → `listSignalOptionsSignalSnapshots` (:13060) →
`getSignalMonitorState` (:2860) — a FULL-universe (~2000 symbols × 6 timeframes) uncached read every
5s per scope, filtered down to the deployment's symbols at :2884. The trading worker already avoids
this via the deployment-scoped fast path: `preferStoredMonitorState: true` (signal-options-worker.ts:464
→ `listSignalOptionsStoredSignalStatesFast`). Bar-evaluation is disabled in this env
(PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=false, artifacts/api-server/package.json dev script), so
both paths read the same stored state — switching the display path is a pure read-size reduction
with identical freshness.

## Fix shape (required, with a MANDATORY pre-check)
PRE-CHECK (gate): enumerate every field the cockpit display and marketing dashboard render from the
signal snapshots produced via `withFreshSignalOptionsStateSignals`/`buildStatePayload` (:12287), and
verify `listSignalOptionsStoredSignalStatesFast` returns ALL of them with identical semantics. If ANY
field is missing/differs, STOP and report the gap instead of implementing.
If the pre-check passes: pass `preferStoredMonitorState: true` through the cockpit display call
sites (the :13142 call and/or :12287's — cover both consumers: cockpit SSE + marketing dashboard),
following exactly how the worker threads the flag. No other behavior changes.

## Test (required)
Extend the existing cockpit/streams suite (find it: grep algo-cockpit / cockpit in
src/services/*.test.ts) with one test proving the display path takes the scoped fast read (statement
count / seam the suites already use) and the payload fields are unchanged.

## Verification (run, paste output)
Targeted test files you touched + `pnpm --filter @workspace/api-server exec tsx --test src/services/algo-cockpit-streams.test.ts src/services/marketing-shadow-dashboard.test.ts` (if they exist — verify names first). All pass. NO full suite/build/restart.

## Deliverable
EXACTLY ONE file: .codex-watch/wo-fix-06-report.md — pre-check field matrix (snapshot field → fast-path coverage), what/why, unified diff of YOUR hunks only, test output.
