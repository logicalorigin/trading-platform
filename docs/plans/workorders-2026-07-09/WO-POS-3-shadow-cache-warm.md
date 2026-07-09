# WO-POS-3 — Warm shadow stop/day-change caches off the read path

Owner: codex worker (xhigh). Dispatcher: Claude positions session (71069931). Status log: `.codex-watch/wo-pos-3.log`.
Discipline: ponytail (full) — minimal edits, no speculative machinery.

## COLLISION WARNING (read first)
`artifacts/api-server/src/services/shadow-account.ts` carries UNCOMMITTED WIP from a tandem pressure workstream at these regions — DO NOT touch or reflow them:
- ~line 3334 `readShadowFillsForOrderIds` (their hunk)
- ~line 8525 `getShadowAccountEquityHistory` pressure gate (their hunk)
Your edits must stay in the regions named below. Do NOT run `git add`/`git commit`/`git stash` at all — the dispatcher commits via hunk surgery.

## Context

Under `resourceLevel === "high"` the positions read serves a degraded fast path (`buildFastShadowPositionsResponseFromRows`, ~line 9230) that fills `stopLoss/takeProfit/riskOverlay` from `lastKnownShadowPositionStops` (~9172) and `dayChange` from `lastKnownShadowPositionDayChange` (~9201-9226). Both caches are in-memory and warmed ONLY by the full builder (`getShadowAccountPositions` full path, records at ~9686 and ~9759). Two defects:

1. **Cold caches after restart under sustained pressure**: if the process reloads while pinned `high`, the full path never runs, both caches stay empty → the table shows no stops and $0/blank day change until pressure drops. Verified live (2026-07-09): full path computes stops for all 16 positions (RH 10.95 trailing) and dayChange RH +1010; fast path blanks them when cold.
2. **Blocking bootstrap**: `buildFastShadowPositionsResponse` (~9403) `await`s `readShadowPositionDayChanges(...)` when any position is missing from the day-change cache. On a saturated DB pool (the exact condition that triggers the fast path) that await can hang the "fast" response behind the pool.

## Fix design (minimum that solves both)

A. **Non-blocking bootstrap** in `buildFastShadowPositionsResponse` (~9395-9415): serve `lastKnown` cache immediately; when `needsDayChangeBootstrap`, fire the baseline-marks-only day-change read in the background (`void ...catch(() => null)`) and record results into `lastKnownShadowPositionDayChange` (via existing `recordLastKnownShadowPositionDayChange`) so the NEXT poll (read cache TTL 2.5s) serves real values. Never `await` it in the response path.

B. **Warm the day-change cache from the background mark refresh**: at the end of `refreshShadowPositionMarks` (~line 6327; it already loads `positions` and option day-change quotes), compute `readShadowPositionDayChanges(positions, new Date(), null, { fetchMissingOptionQuotes: false })` (or reuse already-fetched quotes if trivially available) and record each entry into `lastKnownShadowPositionDayChange`. Wrap in try/catch — warming must never fail the refresh. Note `kickShadowPositionMarkRefresh` is already invoked from multiple read paths and is in-flight-coalesced.

C. **Kick the mark refresh from the fast path**: `buildFastShadowPositionsResponse` should `void kickShadowPositionMarkRefresh()` so under sustained pressure the background refresh (which now warms day-change) still runs. It is self-coalescing so this adds at most one concurrent refresh.

D. **Stops cache warming — cheapest viable**: full stops need orders + automation events (heavy). Do NOT rebuild that in the refresh. Instead persist-lite: on `recordLastKnownShadowPositionStops` (~9181) ALSO append to a tiny JSON file `.pyrus-runtime/shadow-last-known-stops.json` (debounced, atomic tmp+rename, max 1 write/30s), and hydrate both `lastKnownShadowPositionStops` AND `lastKnownShadowPositionDayChange` from that file once at module init (lazy, in a try/catch; tolerate missing/corrupt file). This makes both caches survive a reload without adding DB load. Keep it ~40 lines total. If you judge this over budget, implement A-C only and report D as SKIPPED with reasoning.

## Required tests
- Extend `artifacts/api-server/src/services/shadow-account-read-cache.test.ts`: (1) source-inspection guard that `buildFastShadowPositionsResponse` does NOT `await readShadowPositionDayChanges` (regex on the source like the existing latest-marks tests), and kicks the mark refresh; (2) behavioral: `recordLastKnownShadowPositionDayChange`-warmed cache serves through `buildFastShadowPositionsResponseFromRows` (pattern exists in "pressure fallback surfaces day change decoupled from pressure").
- If D implemented: unit test hydrate-from-file round-trip (write file, clear maps via a test hook or fresh import, hydrate, assert).

## Verification (paste outputs)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit
node --import tsx --test src/services/shadow-account-read-cache.test.ts src/services/shadow-account-day-change-select.test.ts src/services/shadow-account-latest-marks.test.ts src/services/shadow-account-mirror-repair-idempotent.test.ts
```

## Constraints
- Only `shadow-account.ts` (regions: ~6327 refresh tail, ~9172-9226 cache defs, ~9395-9415 fast wrapper) + the test file. No commits. No edits near lines 3334/8525.
- `Date.now()` is fine here (server code). Keep logging to `logger.debug`.

## Report format
STATUS / DIFFSTAT / test outputs / which of A-D landed / any deviation + why.
