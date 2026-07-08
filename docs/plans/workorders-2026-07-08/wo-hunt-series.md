# Codex hunt series — shared preamble (each hunt below runs as its own codex exec with this file + its section)

You are a codex worker in /home/runner/workspace (PYRUS live trading platform). STRICTLY READ-ONLY
(read-only git commands fine). No ~/.claude/, .claude/skills/, agents/ access; never modify
agents/openai.yaml. Fact-first: every finding file:line-verified; refute your own findings before
reporting; precision over volume (max ~15, ranked). Severity: P0 money/trading loss, P1 wrong data
user-visible, P2 degradation, P3 hygiene. Each finding: file:line | severity | title, evidence
(2-3 lines), consequence, laziest fix (1 sentence), confidence 0-1. End with a coverage note.
Write EXACTLY ONE report file (named per hunt below) in .codex-watch/.

## HUNT-Z (zombie config) → .codex-watch/hunt-z-report.md
Dead flags, inert env vars (read-but-no-effect or set-but-ignored — sample .env.example's 425 vars
by section), retired-feature code still executing (IBKR-bridge era is a proven vein — find what the
in-flight datapath-removal missed), config defaults contradicting the algo control panel
(panel-vs-code, proven class), stale defaults from retired eras, dead exports on hot paths.
Verdict per finding: kill/migrate/document/wire-up. KNOWN: dead getResourcePressure wire,
requestSignalOptionsWorkerScanSoon, scan-architecture relic, PYRUS_QA_SHOT_DIR.

## HUNT-M (money math) → .codex-watch/hunt-m-report.md
P&L/marks/greeks/ledger arithmetic: sign errors, rounding drift, float equality on prices, wrong
windows (proven class: dashboard P&L from last-100 events — signal-options-automation.ts:12955,
known, don't re-report), fee/multiplier omissions (options 100x), cost-basis across scale-outs,
timezone-shifted day boundaries in P&L calendars, division-by-zero on empty positions. Scope:
shadow-account.ts ledger folds, signal-options-* pnl/marks, account.ts equity/curve reconstruction,
lib/account-math, backtest-core returns math.

## HUNT-C (cache coherence) → .codex-watch/hunt-c-report.md
Caches with wrong/missing invalidation (proven class: contentStamp fix today — known). Every cache/
memo/TTL in api-server services + lib: what busts it vs what SHOULD; caches surviving writes they
should observe; TTLs masking staleness on trading paths; single-flight seams returning stale to
concurrent waiters; frontend query-cache staleness (pyrus hooks).

## HUNT-S (session boundaries) → .codex-watch/hunt-s-report.md
Market open/close/DST/holiday/half-day edges (proven class: market_closed mislabel — fixed, known).
Scope: lib/market-calendar consumers, signal-monitor session gating, overnight workers RTH gates,
bar bucketing across midnight/UTC-vs-NY (daily boundary code), weekend/holiday bar-age math,
"prior session" logic, anything comparing Date.now() to session windows without timezone care.

## HUNT-R (retry/feedback loops) → .codex-watch/hunt-r-report.md
Retries without caps/jitter, retry-on-timeout amplifying saturation (proven class: timed-out scans
kept consuming pool — fixed, known), reconnect storms (SSE/websocket), pollers that fire next
request while prior in flight, backoffs that reset wrongly, queues that re-enqueue failures forever,
circuit-breakers absent on broker/provider calls.

## HUNT-T (test lies) → .codex-watch/hunt-t-report.md
Tests asserting bugs as correct (proven class: stale MTF unanimity expectation — fixed, known),
vacuous assertions (assert.ok(true)-shaped, unawaited async asserts, catch-swallowed failures),
mocks that bypass the code under test, snapshot tests frozen on wrong output, skipped-in-practice
tests (early returns), assertions on implementation strings so brittle they test nothing. Scope:
sample the 345 test files weighted toward money/trading paths.
