# WO-SSE-FIX — kill the always-true SSE change detection (confirmed ~10% of busy CPU)

Dispatched by Claude session 26888663 (2026-07-09 ~13:25 MDT), Riley signed off. Worker: codex sol.
Report to: `.codex-watch/wo-sse-change-detection-fix-report.md`. Leave ALL edits UNCOMMITTED —
the dispatcher stages hunks around foreign WIP and lands.

Basis: two independent analyses agree (Claude agent + codex sol, both in
`.codex-watch/wo-elu-sse-cluster-report.md`). Fix the three confirmed defects ONLY, plus the cheap
instrumentation gap. Codex's secondary findings (bridge poller full scans, diagnostics shared-snapshot
re-serialization, stock-status global payload scope) are OUT OF SCOPE — follow-up WOs.

## Discipline
- /ponytail full: smallest correct diff; port the proven in-repo pattern
  (object-identity guard `shadow-account-streams.ts:129`; serialize-once fan-out already exists in the
  stock quote/aggregate path) rather than inventing new machinery.
- NO band-aids: no tick-rate cranks, no TTL fiddling. The defect is change detection that can never
  say "unchanged"; fix that.
- Dirty tree: `marketing-shadow-dashboard.ts` and `signal-options-automation.ts` carry other sessions'
  WIP — build around it, never revert or reformat foreign hunks.

## Defect 1 — account-page live + derived streams (account-page-streams.ts ~:498/:523/:960, :817/:985)
`fetchAccountPageLivePayload`/`...Derived` stamp wall-clock `updatedAt` into every payload; the tick's
`stableStringify(snapshot)` signature includes it → `changed` is always true → two full-payload
stringifies + a full SSE frame per second per subscriber even when idle (derived: every 30s, the
app's largest payload).
Fix: make the payload builders content-identity — derive `updatedAt` from the underlying data (or move
volatile stamps outside the compared payload), return the SAME object when inputs are unchanged, and
replace stringify-compare with the object-identity guard. Result: zero stringifies and zero emits when
nothing changed.

## Defect 2 — marketing shadow dashboard (marketing-shadow-dashboard.ts ~:826-828, :804, :718)
Its shadow-change subscriber lacks the `mark_refresh` filter its siblings have
(`shadow-account-streams.ts:153`, `account-page-streams.ts:1038`), so account-page mark-refresh kicks
drive it at the 1s coalesce floor; `signatureForPayload` then re-stringifies the full dashboard
(50 jsonb events) even when the 5s cache returned the identical object.
Fix: add the mark_refresh filter (sibling parity) AND skip signature/serialize when the producer
returned the identical object (identity memo keyed on the payload object).

## Defect 3 — algo-cockpit gate (algo-cockpit-streams.ts ~:60; signal-options-automation.ts ~:13440)
Signature nulls only the top-level `updatedAt`; the nested `cockpit.generatedAt` (rebuilt every 2s
cache refresh, polled at 5s) makes unchanged rebuilds look changed.
Fix: exclude the nested volatile stamp from the signature (or make the cockpit builder content-identity
like Defect 1). Keep the exclusion list adjacent to the payload type so new volatile fields are caught.

## Client-compatibility gate (BLOCKING — verify BEFORE suppressing emits)
Suppressing no-change emits alters stream cadence. Check the pyrus client consumers of each stream
(account page, marketing dashboard, algo cockpit) for logic that depends on periodic events: staleness
detectors, "last updated" clocks, reconnect watchdogs. If any consumer needs a liveness signal, send a
cheap SSE heartbeat/comment frame (no payload serialization) on the old cadence instead of full frames.
State in the report what each consumer needed.

## Instrumentation (cheap, in scope)
The marketing and automation SSE routes bypass the SSE diagnostics counters (why these streams were
invisible in /api/diagnostics/runtime). Wire them into the same counters the other routes use.

## Verification (required)
- `pnpm --filter @workspace/api-server run typecheck` clean.
- New/extended focused tests: unchanged inputs → no emit + no serialize (assert via counters/spies);
  changed inputs → exactly one emit; mark_refresh no longer triggers marketing rebuild; cockpit
  signature stable across cache rebuilds with identical data. Run each touched service's existing
  tests too; list results.
- If frontend heartbeat handling changed: `pnpm --filter @workspace/pyrus run typecheck` + adjacent tests.
- Do NOT restart/reload the app — dispatcher owns runtime verification (SIGUSR2 reload + re-profile;
  acceptance = signatureForPayload/stableStringify/serializeSseEventData self-time collapses in a 20s
  CPU profile and account-page SSE frames stop on an idle account).

## Report format
Per defect: fix applied (files + hunks), tests added + results, client-compat verdict per stream,
exact list of modified files for hunk-level staging.
