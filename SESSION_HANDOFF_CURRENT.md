# Current Session Handoff

This is a pointer to the active durable handoff. Do not use this file as the full session narrative.

- Last Updated (MT): `2026-06-23 ~17:00 MDT`
- Session ID: `448268a3-eaff-42d9-a3ef-e2bb10e67b33`
- Summary: Resource-pressure remediation (A1-A5, B1, B3 LIVE; B2 + heap-fix done, NOT deployed) + PGlite DB test harness + errant-stale-signals (after-hours/Massive) fix + STA-score direction audit. Handing off before a container reset.
- Handoff: `SESSION_HANDOFF_2026-06-23_448268a3-eaff-42d9-a3ef-e2bb10e67b33.md` (full detail — read this)
- Master Index: `SESSION_HANDOFF_MASTER.md`
- Plan: `docs/plans/errant-resource-pressure-remediation-2026-06-23.md`
- Audit: `docs/audits/sta-score-direction-audit-2026-06-23.md`

## Current Status

- **EVERYTHING UNCOMMITTED — large at-risk footprint: ~161 files (110 modified + 51 untracked).** This includes this session's ~22 files PLUS a big pre-existing dirty tree from prior dropped sessions. Branch `main`, ahead of origin by 1. Nothing committed/pushed.
- LIVE in the running build: A1-A5, B1, B3. NOT deployed (source-only): B2, A2 heap-fix, errant-stale-signals fix.
- api-server `typecheck` CLEAN; all touched pressure / bar-cache / shadow / harness / stale-rescue suites green (run PGlite-harness suites in SEPARATE node processes — multi-suite-in-one-process Bus-errors).
- Open decisions: deploy B2+heap-fix+stale-fix? commit (logically)? STA scoring fork (add a drift prior vs reframe as setup-quality)?

## Next Recommended Steps

1. After reset: `git status --short` — confirm the ~161 files survived (spot-check `resource-pressure.ts`, `market-data-store.ts`, `signal-monitor-local-bar-cache.ts`, `shadow-account.ts`, `lib/db/src/testing.ts`). If anything is missing, the per-session handoff lists the work to recover.
2. Deploy (if chosen): `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit` in background (pid2 cascade / exit 143 is expected but ends clean on 8080 + 18747; do NOT kill-and-wait).
3. Commit (if chosen): group this session's pressure/harness/B1/B3/B2/stale-fix/docs separately from the pre-existing prior-session dirt.
4. STA scoring: see the audit report — reweighting is disproven; next move is a new direction/drift feature or reframing the score.

## Validation Snapshot

- `pnpm --filter @workspace/api-server run typecheck` — CLEAN.
- Behavior-equality (PGlite harness): `market-data-store-batch-equality` 3/3, `market-data-store-persist-equality` 3/3, `signal-monitor-local-bar-cache-prefetch` (with/without prefetch identical), `shadow-account-recompute` 3/3, `signal-monitor-stale-rescue` 6/6.
- Live (pre-reset): `resourceLevel: normal`; saturated-pool snapshot read `watch` not `high` (A1 working); app on ports 8080 + 18747 (→ external 3000 preview).
