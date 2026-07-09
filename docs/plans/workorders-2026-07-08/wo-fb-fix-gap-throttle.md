# WO-FB-FIX-GAP-THROTTLE — fix retry-throttle bypass + unbounded attempt map in gap fetch

> **HEADLESS WORKER PREAMBLE:** headless work-order worker. No SESSION_HANDOFF writes; do not read
> ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/, agents/; never restart/reload/SIGUSR2;
> no git add/commit. Lazy-minimal diff. Work ONLY this order.

Adversarial review of 43956df7 found (confidence high):
`signal-monitor.ts:5687` — (a) the 5-minute gap-fetch retry throttle keys on the attempt WINDOW
(`lastAttempt.toMs >= candidate.toMs`); when the tail target advances each completed bucket,
`candidate.toMs` moves and the throttle never binds, so an empty-result illiquid cell (the primary
target population) can retry every bucket instead of every 5 minutes. (b)
`signalMonitorCompletedBarsGapFetchLastAttemptByCell` never prunes — unbounded growth (repo invariant
violation).

Fix, minimal:
1. Throttle by CELL + attempt time: skip enqueue when `Date.now() - lastAttempt.atMs <
   SIGNAL_MONITOR_GAP_FETCH_RETRY_THROTTLE_MS` regardless of window movement. Keep window equality as
   an additional fast-skip if you wish, but the time throttle must bind alone.
2. Bound the map: cap entries (e.g. 4096) with oldest-eviction or clear-on-cap, mirroring existing
   bounded-cache patterns in this file (see NORMALIZE_SYMBOL / completed-bars cache caps).
3. Extend the existing gap-fetch tests: empty-result cell does NOT re-enqueue within the throttle
   window even when the candidate window advances; map stays bounded.

Verify (paste tails in report): api-server typecheck exit 0; targeted suites
`src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts` — current baseline
446 pass / 0 fail, must stay 446+/0. Report → .codex-watch/wo-fb-fix-gap-throttle-report.md with
file:line changes, test tails, start+end `git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts`.
