# Rename Plan: "Signal Options" → "V1 Options" (full rename incl. code identifiers)

**Date:** 2026-07-07 · **Author:** claude-lead session `ea30b14a` · **Status:** PLAN — execution gated on P1/P2 landing + tree commit (owner decision 2026-07-07: full rename including code identifiers; target name "V1 Options" from owner's wording — confirm exact casing before Stage 3).
**Inventory source:** recon workflow `wf_0990f869-9cc` (2026-07-07): ~3,745 identifier occurrences (api-server 3,175 — dominated by the ~19k-line automation service), 44 file/dir names, ~50 DB-durable string surfaces, ~40 real env vars, 7 route paths + 4 operationIds, ~8 UI labels, ~97 docs/report references.

## Naming convention (proposed — confirm with owner)

| Surface | Old | New |
|---|---|---|
| UI label | Signal Options | V1 Options |
| TS identifiers | SignalOptions* / signalOptions* | V1Options* / v1Options* |
| File names | signal-options-*.ts | v1-options-*.ts |
| DB event types / sources | signal_options_* | v1_options_* |
| Config JSON key | config.signalOptions | config.v1Options |
| executionMode value | "signal_options" | "v1_options" |
| Env vars | SIGNAL_OPTIONS_* / PYRUS_SIGNAL_OPTIONS_* | V1_OPTIONS_* / PYRUS_V1_OPTIONS_* |
| Routes/operationIds | signal-options/... / signalOptions* | v1-options/... / v1Options* |

## Non-negotiable safety rules

1. **Historical rows must stay readable forever.** `execution_events` rows carry `event_type` `signal_options_*` and `source` `signal_options_backfill|_replay|_replay_mark`. Readers that filter on these literals (partial indexes from migrations `20260618`/`20260629`, `lib/db/src/retention.ts` `SIMULATION_SHADOW_BALANCE_SOURCES`, the management-review SQL, dashboards) MUST dual-read old+new prefixes permanently, or a one-time data migration must rewrite the rows. **Recommendation: dual-read, no row rewrite** — rewriting millions of event rows churns WAL and invalidates provenance analysis (created_at forensic evidence was load-bearing this week; see the 6x provenance confound).
2. **Persisted config must be migrated + dual-read.** `executionMode === 'signal_options'` and the `config.signalOptions` key live inside `algo_deployments`/`algo_strategies` JSON and are read by TS AND raw SQL in 5 scripts. One-time `jsonb` migration of live rows + resolver accepts both keys for one release window.
3. **Env vars are a deploy-time break.** Code must read BOTH old and new names during transition (old wins if both set, warn); `.env.example`, `.pyrus-runtime/dev-env.local`, and any Replit-set secrets rename in lockstep at the flip.
4. **One lane, quiet tree.** No rename work while signal-options files carry uncommitted P1/P2/P3 WIP — the changesets would clobber. Gate: WO chain landed + committed.
5. **API compat**: old route paths 307/alias to new for one release window; generated client regenerates (`audit:api-codegen`).

## Stages (each is one codex work order, sequential)

**Stage 0 — pre-flip cheap wins (can run BEFORE the main rename, right after the current tree commits):**
- Rename the `signal_options_seen_signals` table + its 4 indexes in the (still-uncommitted) `20260707` migration IF it has not shipped rows we care about — cheapest moment is before that migration is committed/applied broadly. Coordinate with the seen-signals owner (tally lane residue).
- Add the dual-read env shim helper (`readEnvFirst(['V1_OPTIONS_X','SIGNAL_OPTIONS_X'])`) and the dual-prefix event-type matcher used by retention/indexes — landing the compat layer first makes every later stage safe.

**Stage 1 — DB-durable dual-read layer (S/M):** event-type matchers, source matchers, config-key resolver accepts `v1Options` ?? `signalOptions`, executionMode accepts both values; raw-SQL scripts updated to `IN ('signal_options','v1_options')` / `LIKE ANY`. Tests pin both-shapes reads. New partial indexes for `v1_options_%` mirroring the old ones (old indexes stay).
**Stage 2 — write-side flip (S):** new events/config written with new names; one-time `jsonb` migration rewrites `executionMode` + renames the `signalOptions` config key on live deployment rows (dual-read still active, so ordering is safe). Verify deployment 7e2e4e6f classification + review scripts still see continuous history across the boundary.
**Stage 3 — code identifiers + file names (L, mechanical):** global identifier rename + `git mv` of the 44 files (tsserver-assisted; per-directory batches: backtest-core → scripts → backtest-worker → api-server → pyrus), route aliases added, UI labels swapped, typecheck + full signal-options suites + `audit:api-codegen` + `audit:branding` gates per batch.
**Stage 4 — docs + cleanup (S):** active docs/plans updated (historical handoffs/reports left untouched), old env names removed from `.env.example` (shim stays), dispatch-board note. Old-name grep budget: `rg -c 'signalOptions|signal_options|signal-options'` limited to the dual-read shims + historical docs.

## Verification (per stage + final)

- Typecheck all workspaces; full signal-options + shadow-account suites; `pnpm run audit:guards`.
- SQL: counts of events by old/new type before/after Stage 2 boundary are continuous; management review runs across the boundary window and attributes exits identically.
- Runtime: SIGUSR2 reload; healthz 200; cockpit shows V1 Options deployment functioning; one `pnpm shot` of the algo screen.
- Rollback: Stages 1–2 are additive (dual-read) — rollback = stop writing new names. Stage 3 rolls back by git revert.

## Open questions for owner

1. Confirm exact naming: "V1 Options" (UI) / `v1Options` / `v1_options` as tabled above?
2. Dual-read forever vs one-time event-row rewrite (recommendation: dual-read forever)?
3. Should old API route aliases persist past one release window (external consumers?)?
