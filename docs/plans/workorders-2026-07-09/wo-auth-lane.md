# WO-AUTH-LANE — login/session reads must never queue behind data-plane pool saturation (task #12)

Dispatched by Claude session 26888663 (2026-07-09 ~14:05 MDT), Riley-prioritized ("a timeout impacts
our login, this should not happen"). Worker: Opus agent. Report to `.codex-watch/wo-auth-lane-report.md`.
Edits UNCOMMITTED; dispatcher lands.

## Observed causal chain
- Client: `artifacts/pyrus/src/features/auth/authSession.jsx:15` aborts the session check at
  `AbortSignal.timeout(8000)`; the sign-in POST uses `AUTH_POST_TIMEOUT_MS`; timeout renders
  "Sign in timed out. Please try again." (`:51`).
- Server: auth/session lookups (`readAuthSessionFromToken`, services/auth.ts) go through the SHARED
  max-12 pool, which the bar_cache/equity-history read storm pins at 12/12 with interactive admission
  waits observed at 23.8s max (firehose earlier recorded auth_sessions lookups queueing up to 60s).
  8s client timeout < queue wait ⇒ login fails while the DB is otherwise healthy.

## Fix (control-plane isolation, NOT a band-aid)
1. Isolate auth-critical DB reads/writes (session lookup by token; login credential check + session
   insert; logout/session delete) from data-plane pool contention. The repo already sanctions the
   pattern: the reserved trading lane in `lib/db/src/index.ts` (~:284 comment: a small dedicated pool
   so order/exit writes can never starve). Choose the smallest correct mechanism consistent with the
   BUS-1 admission scheduler (`lib/db/src/admission.ts`):
   a) a reserved auth lane (1 connection dedicated pool, lazy), or
   b) a preemptive admission class that never waits behind interactive/bulk work.
   Justify the choice in the report. Do NOT widen the shared pool (stays 12 — lib/db/src/index.ts:206
   policy). Do NOT bump the client 8s timeout (that re-introduces the connection-starvation freeze the
   comment in queryDefaults.js warns about).
2. Check BUS-3A's auth memo (commit c96f6c8e) — confirm which lookups it already absorbs in-process
   and make sure your lane only carries what genuinely needs the DB (don't double-cache).
3. Keep the change surgical: auth paths only. Other control-plane candidates (healthz etc.) are out
   of scope — note them for follow-up if you see them queueing.

## Tests + verification (required)
- Regression test proving isolation: saturate/occupy the shared pool (existing patterns in
  diagnostics-db-pressure.test.ts / signal-monitor-db-demand.test.ts show how) and assert a session
  lookup completes fast (well under the 8s client budget) instead of queueing.
- Existing auth tests still green; `pnpm --filter @workspace/api-server run typecheck` clean.
- Do NOT restart the app — dispatcher owns runtime verification (SIGUSR2 reload; acceptance = login +
  GET /session stay <1s while pool is pinned 12/12).

## Constraints
- Tree is dirty with other sessions' WIP; touch only auth/lib-db files needed; never revert foreign
  hunks; match existing style; minimal diff (/ponytail full).

## Report
Mechanism chosen + why, files/hunks, tests + results, what the auth memo already covered, exact
modified-file list for staging.
