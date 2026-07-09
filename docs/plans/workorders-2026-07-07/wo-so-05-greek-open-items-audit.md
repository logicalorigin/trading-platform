# WO-SO-05: Greek open-items audit — verify what's ACTUALLY open before fix work begins

You are `codex-worker` (xhigh) for `claude-lead` (session ea30b14a, signal-options lane). Repo `/home/runner/workspace`, branch `main`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. **STRICTLY READ-ONLY on all source code, configs, and env files — your only writes are your report file.** You may run read-only SQL and read-only HTTP GETs against the local API.

## Why

The greeks program (entries + trade management) has a pile of "open" findings across docs written at different times, while concurrent sessions landed fixes (commits `08f336ff`, `cd1e3eb2`, `c9138f63`, `929fcb94`) and another worker (WO-SO-01) is editing signal-options files RIGHT NOW. Before we author fix work orders, produce a definitive verdict table: for each item below, OPEN / FIXED / PARTIAL / NOT-VERIFIABLE, with file:line evidence from the CURRENT working tree (not HEAD, not the docs). Where an item has a runtime component, verify against the live system too.

Cross-reference sources (read them): `docs/reviews/2026-07-07-signal-options-system-review.md` (findings #2,#5,#6,#13,#15,#17,#18), `docs/plans/2026-07-07-signal-options-live-money-plan.md` (T1,T2,T3,T15,T16), `TRADING_STRATEGY_BACKHALF_PLAN_2026-06-16.md` (§3c, G1–G4), `5-28 trading analysis.md` (locked design + 5-31 selector research). Note: the working tree is dirty with WO-SO-01's in-flight scale-out/capture work — timestamp your reads and flag any item whose file was visibly mid-edit.

DB: `psql -h helium -d heliumdb -U postgres`. Live API: `http://127.0.0.1:8080`. Live deployment: `7e2e4e6f-749f-4e65-a011-87d3559a23b0`.

## Items to verify (the audit list)

**Selector correctness:**
1. **gammaTheta dimensional inconsistency** (`lib/backtest-core/src/option-greek-selector.ts` ~:342–348, review #5 / plan T3). Commit `08f336ff` claims "dimensionless gammaTheta" landed; the review's re-verification says still present. Read the CURRENT function: is `gammaMoveValue` divided by entryPrice (premium-fraction) or still spot-scaled dollars ÷ dimensionless ratio? Also `git log --oneline -5 -- lib/backtest-core/src/option-greek-selector.ts` + `git show 08f336ff --stat`.
2. **Legacy fallback drops greek safety checks** (review #2): with `requireLiveGreeks=true`, failed hydration falls back to the slot picker with only the liquidity gate — no 0.15-delta floor, no scoring (`signal-options-automation.ts` ~:3720–3728, :3783–3813, :3394–3513). Is a delta floor / moneyness guard now present in the fallback path?
3. **No re-score at final fill quote** (review #6): settle loop rebuilds the order plan from the live re-quote; liquidity/premium re-enforced but minScore / delta floor / breakeven never re-checked (~:3730–3737, :13169–13277, :13286–13333). Current state?
4. **entryGreeks persisted for synthetic-greek selections** (plan T15): `cd1e3eb2` claims "synthetic entry-greek baseline" fixed. Verify: does every selection path (live-greek, synthetic, fallback_legacy) persist an entry greek snapshot the trail can baseline against?
5. **Candidate universe makes maxCandidates illusory** (review #15): chain fetch sized for the slot picker (~7 strikes, one expiration) so the scorer is a near-ATM tiebreaker. Confirm current fetch breadth (DTE window + strike count) and whether any integration test exercises selection/fallback/minScore/mode gating.

**Wire/greek trail (exits):**
6. **Enforce status**: `PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_ENFORCE` — where is it read (exit-policy gate landed via `08f336ff`?), and is it SET anywhere (.env.example is docs; check `.pyrus-runtime/dev-env.local`, and the LIVE process env: find the API pid via the port or `pgrep -f 'dist/index.mjs'`, then `tr '\0' '\n' < /proc/<pid>/environ | grep -i -E 'WIRE_TRAIL|SIGNAL_OPTIONS_TALLY'` — report only these keys, nothing else from environ). Verdict: is the wire/greek trail currently telemetry-only in the running system?
7. **Greek freshness silently zeroing modulation** (review #18): `greekMaxAgeMs` default 15000 vs worker poll floor 15–20s — greek rung adjustments may zero on most evaluations. Verify the live config value on 7e2e4e6f (SQL: `config->'signalOptions'->'exitPolicy'->'wireGreekTrail'`), then find real telemetry: recent stop-payload / `lastWireTrail` events with `greekAgeMs` (execution_events or diagnostics route — locate where the wire-trail telemetry is persisted and sample the last ~50 evaluations). Report the observed distribution: how often are greeks fresh-enough vs stale-zeroed? This is the single most decision-relevant runtime fact in this audit.
8. **Exit-policy positive-path test coverage** (review #13, greek parts): do tests NOW exist for greek tighten/loosen rungs, `resolveGreekFreshness` branches, `selectUsableWireValue` fallback, short-side structure break (`latestClose >= wire`), regime-flip suppression? (T9/T10/T11 batteries landed via `c9138f63` — check what they actually cover vs this list.) `rg -l 'resolveGreekFreshness|selectUsableWireValue|wire_structure_break' artifacts/api-server/src/services/*.test.ts` and read hits.
9. **Wire-context bar-age guard** (review #18): can a stale (e.g. Friday-close) bar drive a Monday structure break? Is there a bar-age guard now?

**Evidence program (G1–G4):**
10. **G1 — sweep generators set `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED`**: check `scripts/src/signal-options-exit-policy-sweep.ts` + `signal-options-greek-selector-smoke.ts` (and any env plumbing) — was the blocker fixed? Any sweep run AFTER 2026-06-16 that produced non-failed greek variants (`scripts/reports/signal-options-exit-policy-sweeps/*` — check statuses)?
11. **G2 — real greeks from `gex_snapshots`**: (a) is anything reading `gex_snapshots` in the backfill/selector paths yet? (b) DATA CHECK (the BACKHALF says "if thin, that's the finding"): SQL profile of `gex_snapshots` — row count, date range, distinct symbols, snapshot cadence per symbol-day, and 1–3 DTE strike coverage (how many strikes per underlying-expiry near the money). Keep queries bounded (LIMIT/aggregates only).
12. **5-31 selector research step 1 — candidate-level score payload logging**: does the selector log/persist scores for ALL considered candidates (not just the winner)? (Look for candidate score payloads in events or diagnostics; review #15's internals hook automation.ts ~:19253 may be related.)

**Config surface:**
13. **greekSelector knobs invisible / UI-created deployments get selector disabled** (review #17, plan T16): confirm current state of the 6 greekSelector knobs (no UI?) and whether a UI-created deployment's default profile still disables the selector while the tuned server profile enables it.

## Deliverable

`.codex-watch/wo-so-05-greek-open-items-audit-2026-07-07.md`:
1. **Verdict table**: item # | verdict (OPEN/FIXED/PARTIAL/NOT-VERIFIABLE) | one-line evidence (file:line or SQL/telemetry result) | which doc's claim was stale (if any).
2. **Runtime findings**: item 6 (enforce status observed), item 7 (greekAgeMs distribution — the headline), item 11b (gex_snapshots coverage profile).
3. **Recommended fix slicing**: group the OPEN items into 2–4 sequenced work orders sized S/M, respecting that WO-SO-01/02/03 own the signal-options service files until their chain completes (selector fixes in `lib/backtest-core` don't collide; say what can start now vs must queue).
4. Label every claim observed / inferred / unknown. No fixes, no code edits, no flag changes.
