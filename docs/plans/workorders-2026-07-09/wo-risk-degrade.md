# WO-RISK-DEGRADE — risk/concentration panels degrade gracefully instead of 500ing (item #2 durable fix)

Planned by Fable (session 26888663, 2026-07-09 ~15:15 MDT), Riley-directed. Executor: Opus now
(codex sol credit-blocked until ~17:22 MDT; codex runs the adversarial verify pass afterwards).
Report to `.codex-watch/wo-risk-degrade-report.md`. Edits UNCOMMITTED.
DISPATCH GATE: do not start until the WO-EQH-FIX worker releases shadow-account.ts (dispatcher enforces).

## Diagnosis (evidence)
- Riley's live render: Risk Level + Concentration + one adjacent panel showed raw
  "HTTP 500 Internal Server Error" with Retry. Cause at that moment: VACUUM FULL held
  execution_events' ACCESS EXCLUSIVE lock; 3-4 panel queries observed blocked (pg_stat_activity,
  Lock:relation). Transient — but the same failure shape recurs WITHOUT maintenance: statement_timeout
  57014 and pool-acquire stalls were observed all day under pressure (auth 11.3s, interactive maxWait
  51s), and any of those in the risk path produce the same raw 500.
- Route: GET /accounts/:accountId/risk (artifacts/api-server/src/routes/platform.ts:1938). Reads go
  through the shadowAccountReads cache (ttl 2.5s, staleTtl 60s, staleWait 1.5s — "shadow risk:*" /
  "risk-build:*" families). A 60s stale window cannot ride out a multi-minute lock or storm, so the
  cache goes empty → fresh read blocks → throws → 500.
- Client: platformJsonRequest surfaces status 500 as a raw error banner; react-query deliberately
  never retries timeouts; panels have no degraded state.

## Decision (options weighed)
- CHOSEN: (a) serve-stale-on-degraded-error at the risk read layer + (b) structured 503 when no stale
  exists + (c) client degraded rendering. Uses the existing servedStale mechanics; smallest correct.
- REJECTED: widening statement timeouts (band-aid; hides pressure), catching ALL errors (masks real
  bugs), maintenance-mode special-casing (doesn't cover the pressure-storm recurrence).

## Plan
1. Add a narrow degraded-error classifier (api-server, near the shadow read cache): pg SQLSTATE
   57014 (query_canceled/statement_timeout), 55P03 (lock_not_available), lock-wait/pool-acquire
   timeout shapes. ONLY these classify as degraded; anything else still throws.
2. Risk family reads ("shadow risk", "risk-build", and whatever the concentration panel calls —
   trace from the route handler): on degraded-class error, serve the last-known payload if present,
   with `{ degraded: true, degradedReason, asOf }` merged into the response envelope. Extend stale
   retention for the risk family only (riskStaleTtlMs ~15 min) so last-known survives maintenance
   windows; do NOT touch other families' stale semantics.
3. No stale available → throw HttpError(503, code "degraded_upstream") with Retry-After ~15s
   (client already parses retryAfterMs via parseRetryAfterMs; 429 handling shows the pattern —
   extend to 503 for these panels).
4. Client (artifacts/pyrus/src — risk/concentration panel components in AccountScreen area): render
   degraded payloads with a subtle "stale · as of <time>" badge instead of an error; render 503
   degraded_upstream as "temporarily degraded, retrying…" with auto-retry honoring retryAfterMs;
   real 500s keep the current error+Retry.
5. Tests: server — degraded-class error with warm stale → 200 + degraded:true; with no stale → 503 +
   Retry-After + code; non-degraded error (TypeError) → still 500. Client — 503 degraded_upstream
   renders soft state and schedules retry; degraded:true payload shows badge. Run adjacent suites +
   typechecks (direct tsc if the pnpm wrapper hits a validation lock).

## Constraints
/ponytail full; minimal diffs; tree carries uncommitted waves (EQH/positions in shadow-account.ts,
SSE in account-page-streams.ts) — build on them, never revert; no app restart; no commits.

## Report
Files/hunks, the exact degraded-class list, stale-retention choice, tests + results, modified-file
list for staging.
