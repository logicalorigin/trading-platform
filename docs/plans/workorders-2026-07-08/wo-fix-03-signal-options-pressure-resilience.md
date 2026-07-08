# WO-FIX-03 — Signal-options scan: pressure resilience (3 fixes, separate hunk sets)

You are a codex worker in the PYRUS monorepo at /home/runner/workspace. THREE related fixes in the
signal-options scan path. Working-tree edits ONLY — NO git commands (both target files carry
in-flight work). Report EVERY fix as its own clearly-separated unified-diff hunk set so the
orchestrator can commit them independently.

IMPORTANT: Do NOT read or execute files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
Do NOT modify agents/openai.yaml.

## Operating discipline (binding)
Ponytail lazy-correct; fact-first (read each touched path end-to-end; verify the investigation's
line cites yourself before editing — the tree has moved); surgical; preserve in-flight edits' intent.
This worker path manages LIVE options trades — behavior changes beyond the specs below are FORBIDDEN.

## Context (verified by prior investigation, 2026-07-08)
signal-options-worker.ts: scan timeout DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS=120_000 (line
~39, resolver ~297-314, env SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS); on timeout the scan is aborted
cooperatively (controller.abort ~466) but keeps running detached until the next abort checkpoint;
`activeDeploymentIds` guards pile-up; recovery = 60s backoff (FAILED_DEPLOYMENT_RETRY_MS ~22).
signal-options-automation.ts: `throwIfSignalOptionsScanAborted` (~623-632) is called only at phase
boundaries (~6246, 6269, 6287, 14450, 14796); universe batch cursor is advanced at planning time
(~6097-6115) before the batch is processed. Live incident today: scan timed out at 120s under DB-pool
saturation; the detached scan kept consuming pool connections; the skipped batch tail waits a full
universe rotation.

## FIX A (P2) — abort responsiveness in hot per-symbol loops
In signal-options-automation.ts, add `throwIfSignalOptionsScanAborted(signal)` checks INSIDE the hot
per-symbol/per-position iteration loops of the scan path (the loops that issue per-item DB reads or
action work) so an aborted scan stops within ~one item instead of one phase. Find the loops
yourself (trace from runSignalOptionsShadowScan); add the cheapest per-iteration check (guard is a
no-op when signal not aborted). Do NOT add checks inside non-scan code paths; do NOT change any
trading decision logic. Every added line = the single checkpoint call.

## FIX B (P3) — timeout scales with open-position load
In signal-options-worker.ts: keep env SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS as an absolute override
(unchanged when set). When UNSET, scale the default: effective = clamp(120_000 + activePositionCount
* 3_000, 120_000, 300_000) using the worker's existing per-deployment activePositionCount (it
already tracks it for the 5s poll override ~586-591). No new env vars. Timeout classification/
backoff behavior otherwise unchanged.

## FIX C (P3) — batch cursor advances only through processed symbols
In signal-options-automation.ts (~6097-6115): the cursor currently jumps to nextIndex at planning
time, so an aborted scan skips its batch's unprocessed tail for a whole rotation. Change to advance
the persisted cursor only as symbols complete processing (or persist a completed-through index on
abort) — pick the smallest correct mechanism the existing cursor storage supports. An aborted scan
must resume from the first unprocessed symbol next scan. Must NOT re-process symbols already
completed in the aborted scan (existing seenSignalKeys dedup is the safety net regardless).

## Tests (required; follow existing suites' conventions)
- FIX A: extend the existing worker/automation test that covers scan abort (find it: grep
  "timed_out" / abort in src/services/*.test.ts) with a case proving the scan stops mid-batch.
- FIX B: unit-test the effective-timeout resolver (pure function if you extract one — laziest shape).
- FIX C: a case proving an aborted mid-batch scan resumes at the first unprocessed symbol.
Run each fix's targeted test file(s) + the existing signal-options-worker/automation suites you
touched: `pnpm --filter @workspace/api-server exec tsx --test <files>`. Paste outputs per fix.

## Deliverable
EXACTLY ONE file: .codex-watch/wo-fix-03-report.md with three sections (FIX A/B/C), each: what/why
(2-3 sentences), its own unified diff, its test output. If any fix proves unsafe/infeasible on
fact-check, implement the others and explain precisely why (file:line evidence).
