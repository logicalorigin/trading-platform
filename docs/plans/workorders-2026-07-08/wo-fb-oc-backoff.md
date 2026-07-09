# WO-FB-OC-BACKOFF — option-chain backoff: back off only on genuine upstream failure + clear on success

Lane: Fable-B session f834d411 (see COORDINATION UPDATE in docs/plans/2026-07-08-review-session-findings-plan.md).
Brief: docs/plans/signal-monitor-db-load-rootcause-2026-07-08.md (QUEUED item 4 / Stage 5): the option-chain
60s backoff ("Contract pending") is tripped by LOCAL timeouts under event-loop pressure and has no
clear-on-success, so healthy upstreams stay backed off for 60s per key.

## Verified anchors (working tree 2026-07-08 ~18:55 MDT; line numbers may drift — re-locate by snippet)
- `artifacts/api-server/src/services/platform.ts:11367` — `const OPTION_UPSTREAM_BACKOFF_MS = readPositiveIntegerEnv("OPTION_UPSTREAM_BACKOFF_MS", readPositiveIntegerEnv("IBKR_BRIDGE_OPTIONS_BACKOFF_MS", 60_000))`
- `:14012` — `const optionUpstreamBackoffUntilByKey = new Map<string, number>()`; `:14024` clears it on runtime-config change.
- `:15076` — `isTransientOptionUpstreamError(error)`: returns true for `ibkr_bridge_request_timeout`, `ibkr_bridge_health_timeout`, `massive_options_request_timeout`, `upstream_request_failed`, and `upstream_http_error` with 5xx/429.
- `:15128` — `recordOptionUpstreamBackoff(kind, key, error)`: sets the 60s backoff whenever `isTransientOptionUpstreamError(error)`.
- `:15104` / `:15111` — `isOptionUpstreamBackedOff` / `getOptionUpstreamBackoffRemainingMs` (expiry is the ONLY per-key clear, `:15121-15123`).
- `:15623`, `:15651`, `:15944` — callers that use `cached && isTransientOptionUpstreamError(error)` to serve durable cache on transient error. This cache-fallback behavior is CORRECT and must be preserved.

## The change
1. **Split the predicate.** Keep `isTransientOptionUpstreamError` broad for the serve-durable-cache callers.
   Add a NARROW predicate (e.g. `shouldBackOffOptionUpstream(error)`) used only by `recordOptionUpstreamBackoff`:
   back off ONLY on genuine upstream signals — `upstream_http_error` with `statusCode >= 500 || statusCode === 429`,
   and `upstream_request_failed`. LOCAL timeout/abort codes must NOT set the backoff.
   - FIRST verify where each code is thrown (`rg` for `ibkr_bridge_request_timeout`, `ibkr_bridge_health_timeout`,
     `massive_options_request_timeout` across artifacts/api-server + lib). Expected: the `ibkr_bridge_*` codes are
     bridge-era (bridge removed — may be unreachable; say so in the report) and `massive_options_request_timeout`
     is a LOCAL AbortController/timeout we impose. If any of these turns out to be a genuine upstream-emitted
     signal, keep it in the backoff predicate and justify in the report with the throw-site evidence.
2. **Clear on success.** When a chain/expiration fetch for a key SUCCEEDS, delete that key's entry from
   `optionUpstreamBackoffUntilByKey`. Find the success path(s) of the fetches whose catch blocks call
   `recordOptionUpstreamBackoff` and clear there (a tiny `clearOptionUpstreamBackoff(kind, key)` helper is fine).
3. **Duration:** leave `OPTION_UPSTREAM_BACKOFF_MS` at 60s unless you find concrete in-code evidence a shorter
   default is safe; if you change it, justify in the report. Do not add new env flags.

## MUST NOT
- Touch ONLY `artifacts/api-server/src/services/platform.ts` and the test file you add/extend. The tree is
  dirty with other lanes' WIP — do NOT revert, reformat, or "improve" anything outside your hunks. NEVER
  `git checkout`/`git restore`/`git stash`.
- Do NOT commit, do NOT `git add`. Leave changes in the working tree; the orchestrator commits.
- Signal identity / trading behavior elsewhere byte-identical. Cache-fallback semantics unchanged.
- Laziest solution that works: minimal diff, no new dependencies, no speculative abstraction.
- Another fleet edits other regions of this repo concurrently: run `git diff --stat -- artifacts/api-server/src/services/platform.ts` at start AND end; include both in the report.

## Tests (required)
- Add a focused test for the new behavior. Exporting the narrow predicate and/or small helpers for testability
  is acceptable if that matches existing repo test seams (check how option-chain-policy.test.ts and
  platform-adjacent tests import from platform.ts). Cover at minimum:
  (a) local-timeout error (`massive_options_request_timeout`) does NOT set a backoff;
  (b) `upstream_http_error` 500 and 429 DO set it;
  (c) a subsequent success CLEARS an existing backoff for that key;
  (d) serve-durable-cache on transient error still works (existing behavior).

## Verification (run all; paste tails in the report)
- `cd /home/runner/workspace && pnpm --filter @workspace/api-server run typecheck` → exit 0
- `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts` → baseline is 442 pass / 0 fail; it must stay 442+/0.
- Your new/extended test file → green.
- `pnpm --filter @workspace/api-server exec tsx --test src/services/option-chain-policy.test.ts` → green.

## Report
Write `.codex-watch/wo-fb-oc-backoff-report.md`: what changed (file:line), throw-site evidence for each timeout
code's classification, verbatim test/typecheck tails, start+end `git diff --stat`, risks.
