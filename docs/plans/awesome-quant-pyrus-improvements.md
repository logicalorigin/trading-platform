# Implementation Plan: Awesome Quant Improvements For Pyrus

Last reviewed: 2026-05-30

## Overview

Use [`wilsonfreitas/awesome-quant`](https://github.com/wilsonfreitas/awesome-quant) as a reference catalog to improve Pyrus in focused, verifiable slices. The first implementation wave should prioritize open-source work that maps directly to current Pyrus surfaces: options fill realism, market calendar correctness, backtest validation, portfolio/risk analytics, factor/signal evaluation, and indicator expansion.

This plan uses the `planning-and-task-breakdown` structure: dependency graph first, small tasks, acceptance criteria, verification, and checkpoints.

## Current Status

- [x] Task 1: Build the initial `awesome-quant` OSS candidate matrix.
- [x] Task 2: Define the dependency admission checklist.
- [x] Task 3: Design the options fill simulation contract. Contract, isolated resolver, and regression fixtures added.
- [x] Task 4: Wire conservative option fills into backtest execution. Tasks 4A-4J now have routing proof, optional quote storage/API/replay contracts, worker end-to-end quote fixtures, and shared-engine opt-in coverage. Task 4K is resolved as an explicit no-exposure decision until a provider supplies historical option bid/ask with timestamps for user-facing option backtests.
- [ ] Task 5: Add backtest validation warnings. Core warning contract and deterministic computation are implemented in `lib/backtest-core`; UI presentation and product-facing severity review remain open.
- [x] Task 8: Add portfolio risk library spike. Completed in `docs/spikes/portfolio-risk-library-spike-2026-05-30.md`; no external optimizer dependency admitted for this wave.

## Architecture Decisions

- Reference first, integrate mature libraries only after license, maintenance, install-size, runtime, and Replit compatibility checks.
- Use the existing Python compute service for scientific Python packages.
- Keep latency-sensitive UI, charting, and market-data ingestion logic native TypeScript or Rust.
- Exclude paid/commercial services from implementation candidates.
- Avoid GPL, AGPL, LGPL, and Commons-Clause dependencies unless explicitly approved; use them as references only.
- Ship vertical slices: each task must leave one usable improvement behind a flag or existing UI surface.

## Dependency Graph

```text
OSS candidate audit
  -> dependency/license decision
  -> compute/API contract changes
  -> backend implementation
  -> generated clients, if public API changes
  -> UI integration
  -> regression tests and QA
```

## Initial OSS Candidate Matrix

Recommendation values:

- `integrate-python`: reasonable candidate for the Python compute service after a focused spike.
- `integrate-ts`: reasonable candidate for direct TypeScript use after a focused spike.
- `port-pattern`: read the implementation and build a small Pyrus-native version.
- `reference`: use architecture, UX, tests, or formulas as guidance only.
- `reject`: not a fit for this wave.

| Candidate | Awesome Quant Area | License | Activity Snapshot | Runtime | Pyrus Fit | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [`flashalpha-fill-simulator`](https://github.com/FlashAlpha-lab/flashalpha-fill-simulator) | Trading & Backtesting | MIT | New/small; pushed 2026-05-06 | Python | High for realistic options fills, stale quote guards, same-bar tie breaks | Small project, low adoption | `port-pattern` |
| [`pandas_market_calendars`](https://github.com/rsheftel/pandas_market_calendars) | Calendars & Market Hours | MIT | Active; pushed 2026-05-27 | Python | High for NYSE holidays, early closes, DST, sessions | Python boundary and timezone edge cases | `integrate-python` spike |
| [`exchange_calendars`](https://github.com/gerrymanoim/exchange_calendars) | Calendars & Market Hours | Apache-2.0 | Active; pushed 2026-04-26 | Python | High for exchange calendar breadth | Similar overlap with `pandas_market_calendars` | `integrate-python` spike |
| [`empyrical-reloaded`](https://github.com/stefan-jansen/empyrical-reloaded) | Portfolio/Risk | Apache-2.0 | Maintained fork; pushed 2025-12-12 | Python | High for Sharpe, Sortino, drawdown, alpha/beta parity checks | Metric drift vs existing native analytics | `reference`, then optional `integrate-python` |
| [`pyfolio-reloaded`](https://github.com/stefan-jansen/pyfolio-reloaded) | Portfolio/Risk | Apache-2.0 | Maintained fork; pushed 2025-12-15 | Python/Jupyter | High for tear-sheet UX and performance reporting | Heavy/report-oriented dependency | `reference` |
| [`alphalens-reloaded`](https://github.com/stefan-jansen/alphalens-reloaded) | Factor Analysis | Apache-2.0 | Maintained fork; pushed 2025-12-15 | Python | High for signal forward-return evaluation | Requires clean signal/price dataset | `reference`, then `port-pattern` |
| [`skfolio`](https://github.com/skfolio/skfolio) | Portfolio/Risk | BSD-3-Clause | Active; pushed 2026-05-29 | Python | High for portfolio optimization via sklearn-style API | New dependency weight and solver behavior | `integrate-python` spike |
| [`Riskfolio-Lib`](https://github.com/dcajasn/Riskfolio-Lib) | Portfolio/Risk | BSD-3-Clause | Active; pushed 2026-05-22 | Python/C++ | High for risk parity, CVaR, HERC, risk contribution | Heavier install and numerical complexity | `integrate-python` spike |
| [`PyPortfolioOpt`](https://github.com/robertmartin8/PyPortfolioOpt) | Portfolio/Risk | MIT | Active; pushed 2026-04-20 | Python | Medium/high for efficient frontier and Black-Litterman | More portfolio-research than trading cockpit | `integrate-python` fallback |
| [`IndicatorTS`](https://github.com/cinar/indicatorts) | Technical Indicators | MIT | Active; pushed 2026-04-20 | TypeScript | High for native indicator expansion | API fit and bundle-size review needed | `integrate-ts` spike |
| [`fin-primitives`](https://github.com/Mattbusel/fin-primitives) | Technical Indicators / Rust primitives | MIT | Small; pushed 2026-03-23 | Rust | Medium for market-data worker primitives and risk monitor patterns | Small project, limited adoption | `reference` or `port-pattern` |
| [`vollib`](https://github.com/vollib/vollib) | Financial Instruments & Pricing | MIT | Older; pushed 2023-06-05 | Python | Medium for Black-Scholes/Black-76 IV and Greeks parity checks | Old package and native/SWIG concerns | `reference` |
| [`bt`](https://github.com/pmorissette/bt) | Trading & Backtesting | MIT | Active; pushed 2026-05-05 | Python | Medium for portfolio backtest composition ideas | Less options-specific than Pyrus needs | `reference` |
| [`vectorbt`](https://github.com/polakowo/vectorbt) | Trading & Backtesting | NOASSERTION / Commons-Clause-like repo terms | Active; pushed 2026-04-25 | Python | High concept fit for matrix parameter sweeps | License/terms risk, heavy dependency | `reference` only |
| [`backtester-mcp`](https://github.com/bcosm/backtester-mcp) | Trading & Backtesting | Apache-2.0 | New/small; pushed 2026-04-17 | Python | Medium/high for anti-overfit checklist ideas | Very low adoption | `reference` |
| [`nautilus_trader`](https://github.com/nautechsystems/nautilus_trader) | Trading & Backtesting | LGPL-3.0 | Very active; pushed 2026-05-30 | Rust/Python | High architecture fit for event-driven backtesting/execution | License/runtime too heavy for embedding | `reference` only |
| [`Lumibot`](https://github.com/Lumiwealth/lumibot) | Trading & Backtesting | GPL-3.0 | Active; pushed 2026-05-30 | Python | Medium for broker/backtest/live workflow ideas | GPL blocks direct integration | `reference` only |
| [`StrateQueue`](https://github.com/StrateQueue/StrateQueue) | Trading & Backtesting | AGPL-3.0 | Active; pushed 2026-05-19 | Python | Medium for safety-control ideas from backtest to live | AGPL blocks direct integration | `reference` only |
| [`optionlab`](https://github.com/rgaveiga/optionlab) | Financial Instruments & Pricing | GPL-3.0 | Active; pushed 2025-12-25 | Python | Medium for options strategy evaluation ideas | GPL blocks direct integration | `reference` only |
| [`FinancePy`](https://github.com/domokane/FinancePy) | Financial Instruments & Pricing | GPL-3.0 | Active; pushed 2026-05-26 | Python | Medium for derivatives pricing ideas | GPL blocks direct integration | `reference` only |
| [`QuantConnect Lean`](https://github.com/QuantConnect/Lean) | Trading & Backtesting | Apache-2.0 | Active; pushed 2026-05-29 | C# | Medium/high architecture reference | Too large and cross-runtime for embedding | `reference` |
| [`Qlib`](https://github.com/microsoft/qlib) | Trading & Backtesting / ML | MIT | Active; pushed 2026-04-22 | Python | Medium for ML pipeline/factor research ideas | Heavy and broader than current app scope | `reference` |

## Dependency Admission Checklist

Use this before adding any package from `awesome-quant`.

| Check | Required Answer |
| --- | --- |
| License | MIT, Apache-2.0, BSD, or equivalent permissive license for direct integration. GPL, AGPL, LGPL, Commons Clause, unclear, or missing license requires explicit approval and usually becomes `reference` only. |
| Maintenance | Recent activity, low critical issue load, clear release process or stable API. Small projects may still be used as references. |
| Runtime fit | Python packages go through `python/pyrus_compute`; TypeScript packages must not bloat the app bundle; Rust code must fit `crates/market-data-worker` without destabilizing ingest. |
| Install size | Dependency must be measured before adoption. Scientific Python packages need a `uv` lock diff review. |
| Determinism | Outputs must be deterministic for tests, backtests, and user-visible analytics. |
| Data requirements | Required input data must already exist or be added through a separate data plan. |
| Security | No network calls, secrets, or arbitrary code execution inside analytics jobs unless specifically designed and reviewed. |
| Replacement cost | If easy to implement natively, prefer `port-pattern` over new dependency. |
| API stability | Public API changes require OpenAPI/zod/client updates and generated-client drift checks. |
| Replit fit | Must run under current Replit startup constraints without modifying `.replit` or artifact startup config unless explicitly planned. |

Admission outcomes:

- `reference`: use concepts, architecture, tests, or formulas only.
- `port-pattern`: implement a small Pyrus-native version.
- `integrate-python`: add to Python compute after spike approval.
- `integrate-ts`: add to frontend/shared TypeScript after bundle and API review.
- `integrate-rust`: add to Rust worker after build/runtime review.
- `reject`: not useful or too risky for this app.

Sample decisions:

- `flashalpha-fill-simulator`: `port-pattern`; its fill behavior maps tightly to Pyrus options backtests, but the project is too small to adopt blindly.
- `pandas_market_calendars` and `exchange_calendars`: `integrate-python` spike; choose one based on NYSE early-close coverage and API fit.
- `vectorbt`: `reference`; useful for parameter-sweep design, not a direct dependency because of licensing/terms ambiguity and dependency weight.

## Candidate Implementation And Regression Decisions

This table is the controlling decision record for the first implementation wave. A candidate should not move into runtime code unless its regression gate is implemented in the same change or already exists.

| Candidate | Implement? | Exact Implementation | Regression Gate |
| --- | --- | --- | --- |
| `flashalpha-fill-simulator` | Yes, as Pyrus-native logic | Do not add the package. Port the fill-model ideas into `lib/backtest-core`: legacy fill remains default; add conservative quote-aware option fills, stale/wide/crossed quote rejection, deterministic same-bar tie break, and post-and-wait fixtures before wiring to the engine. | Existing legacy backtest fixtures must produce identical trades/metrics. New fixtures must cover tight quote fill, missing bid/ask no-fill, crossed quote no-fill, wide spread no-fill, stale quote no-fill, post-and-wait fill/no-fill, and same-bar conflict. Run targeted `backtest-core` tests. |
| `pandas_market_calendars` | Maybe, spike against `exchange_calendars` | Add a Python compute spike only. Compare NYSE full holidays, early closes, DST transitions, RTH/pre/after/overnight windows, and next open/close API ergonomics. Use it only if it beats the current hand-coded session logic and `exchange_calendars` for Pyrus needs. | Existing `marketSession.test.ts` must still pass. Add fixture dates for Good Friday, Juneteenth, Black Friday early close, July 3 early close when applicable, DST week, weekends, and invalid dates. Backend/frontend session labels must agree on the same fixture table. |
| `exchange_calendars` | Maybe, spike against `pandas_market_calendars` | Same spike as above. Choose exactly one calendar dependency; do not ship both. Prefer the one with clearer NYSE schedule/early-close support and smaller integration surface. | Same calendar fixture suite as `pandas_market_calendars`. Any selected dependency must run under `python-compute:doctor` and `python-compute:test` without startup config changes. |
| `empyrical-reloaded` | Not initially; use as parity reference | Keep existing TypeScript `backtest-core` analytics as source of truth. Use `empyrical-reloaded` formulas/test values to add parity fixtures for Sharpe, Sortino, max drawdown, alpha, beta, and annualized volatility. Only integrate into Python compute if native metrics become hard to maintain. | Existing analytics snapshots remain stable unless explicitly versioned. Add fixed-return-series fixture tests comparing Pyrus output against expected values. New metrics must be additive and must not rename existing API fields. |
| `pyfolio-reloaded` | No direct dependency | Use as a tear-sheet UX/reference for backtest report organization: returns, drawdowns, rolling risk, benchmark comparison, and warning presentation. Build Pyrus-native summaries. | Existing backtesting panels render unchanged for old runs. New tear-sheet sections must be hidden when data is missing and covered by UI model tests. No Python dependency is added. |
| `alphalens-reloaded` | Yes, as Pyrus-native signal analytics | Do not add the package. Implement a forward-return dataset and signal-quality metrics in Pyrus services using alphalens concepts: horizon returns, score buckets, direction split, information coefficient-style correlation where data supports it. | Fixed signal/bar fixtures cover complete windows, incomplete windows, missing bars, mixed symbols, long/short direction, and low sample warnings. No automation/trading decision reads these metrics until separately gated. |
| `skfolio` | Maybe, preferred portfolio optimization spike | Evaluate inside `python/pyrus_compute` for an advisory `portfolio_optimization` job. If adopted, expose weights/risk contribution/turnover/warnings only; do not generate broker orders. | `python-compute:doctor`, `python-compute:test`, `python-compute:lint`, and `python-compute:typecheck` pass. Existing `portfolio_risk` fixtures remain unchanged. New optimization fixtures cover empty input, invalid covariance, long-only constraints, max-weight constraints, and deterministic outputs. |
| `Riskfolio-Lib` | Maybe, alternate to `skfolio` | Evaluate only if `skfolio` cannot cover required risk contribution/CVaR/HERC scenarios. Do not ship both in the first wave. | Same Python compute gates as `skfolio`, plus lockfile/install-size review because dependency weight is likely higher. Existing `portfolio_risk` behavior must remain unchanged. |
| `PyPortfolioOpt` | Maybe, fallback only | Use only if `skfolio` and `Riskfolio-Lib` are too heavy or too awkward. Scope to efficient frontier/Black-Litterman-style advisory outputs. | Same Python compute gates as `skfolio`. Output fixtures must be deterministic and advisory-only. |
| `IndicatorTS` | Maybe, TypeScript spike | Spike API and bundle impact. If accepted, use for one high-value indicator slice or as formula reference. Do not replace existing Pyrus indicators wholesale. | Existing chart indicator persistence/tests pass. Add deterministic fixture tests for any new indicator and verify chart settings do not break saved user preferences. Run targeted Pyrus chart tests. |
| `fin-primitives` | Not as dependency | Use as Rust/market-data-worker reference for typed OHLCV, risk monitor, and order-book primitives. Port only small patterns if they simplify existing Rust worker code. | Market-data worker tests and formatting/check commands pass. No worker ingestion behavior changes without before/after fixture output. |
| `vollib` | Reference only for now | Use as an IV/Greeks formula reference if Pyrus needs parity checks beyond current Black-Scholes fallbacks. Avoid dependency until native/SWIG packaging is proven safe. | Greek scenario fixtures must remain stable. If any formula is ported, compare against fixed known option cases and current shadow Greek scenario tests. |
| `bt` | Reference only | Use portfolio backtest composition ideas when expanding multi-asset backtests. No dependency in first wave. | No regression gate needed until a portfolio-backtest task is created; then existing `backtest-core` engine tests must remain stable. |
| `vectorbt` | Reference only | Borrow matrix-sweep and parameter-grid UX ideas. Do not add dependency because license/terms and dependency weight are not acceptable for this wave. | Sweep behavior remains native. Existing sweep dimension tests pass; any new sweep result sorting/ranking must use fixed fixtures. |
| `backtester-mcp` | Reference only | Borrow anti-overfit checklist ideas: PBO, deflated Sharpe, bootstrap confidence, walk-forward warnings. Implement only the pieces Pyrus can test natively. | Existing validation metrics remain backward compatible. Add warning fixtures for low trades, many trials, no OOS window, and unstable Sharpe. |
| `nautilus_trader` | Reference only | Use as architecture inspiration for event-driven separation of data, strategy, execution, and risk. Do not embed due to LGPL/runtime weight. | No runtime regression gate; any architecture refactor inspired by it must preserve existing IBKR/order readiness tests and backtest tests. |
| `Lumibot` | Reference only | Borrow broker/backtest/live workflow concepts only. GPL blocks direct integration. | No dependency can be added. Any broker workflow inspired by it must pass broker readiness and live-confirmation tests. |
| `StrateQueue` | Reference only | Borrow safety-control concepts for moving from backtest to paper/live. AGPL blocks direct integration. | No dependency can be added. Automation safety tests must continue to require explicit gates before live behavior. |
| `optionlab` | Reference only | Borrow option strategy payoff/evaluation concepts only. GPL blocks direct integration. | Any payoff logic port must use clean-room Pyrus-native implementation with fixed payoff fixtures for calls, puts, verticals, and no-position cases. |
| `FinancePy` | Reference only | Borrow derivatives-pricing concepts only. GPL blocks direct integration. | Any formula port requires independently written implementation and fixed pricing/Greeks fixtures. No GPL code copy. |
| `QuantConnect Lean` | Reference only | Use as architecture reference for broker/data/strategy boundaries and result reporting. Do not embed due to size/runtime mismatch. | Any boundary changes must keep OpenAPI/codegen checks and existing backtest/automation tests green. |
| `Qlib` | Reference only | Use as a long-term research-pipeline reference for factor datasets and model evaluation. No first-wave dependency. | No ML pipeline is added in this wave. Any future factor job must include deterministic train/test split fixtures and no live-trading coupling. |

Global regression requirements for every implementation task:

- Existing public API fields remain backward compatible unless an OpenAPI migration is explicitly included.
- Old/default behavior remains default until the new behavior has fixture coverage.
- Any analytics result that changes existing numbers must be versioned, flagged, or deliberately accepted in the task notes.
- New advisory analytics must not connect to broker order placement without a separate trading-safety plan.
- Replit startup config is not touched for these tasks.

## Approved Shortlist Implementation Detail

The first shortlist is approved for deeper implementation planning. This section is the controlling plan before any candidate moves past docs or isolated fixtures.

### 1. `flashalpha-fill-simulator` Pattern: Conservative Option Fills

Decision: implement now as Pyrus-native TypeScript, not as a dependency.

Current implementation state:

- `lib/backtest-core/src/types.ts` now allows optional quote fields on `BacktestBar`: `bid`, `ask`, `mid`, `quoteAsOf`, and `providerContractId`.
- `lib/backtest-core/src/option-fills.ts` contains an isolated resolver for `legacy_open_slippage`, `conservative_quote`, and `post_and_wait`.
- `lib/backtest-core/src/option-fills.test.ts` covers legacy open behavior, bid/ask fills, missing quotes, crossed quotes, wide quotes, stale quotes, post-and-wait fill/no-fill, and post-and-wait crossing.
- Shared-engine behavior is unchanged. The worker has a dormant internal `conservative_quote` opt-in policy path, but existing backtests remain on the old open-plus-slippage/aggregate-bar model unless `optionFillModel` is explicitly set and quote replay is eligible. `post_and_wait` remains isolated shared-resolver groundwork until worker pending-order aging has end-to-end fixtures.

Plan review correction:

- Pyrus has two relevant backtest execution paths:
  - Spot/equity backtests and optimizer sweeps use shared `lib/backtest-core/src/engine.ts`.
  - User-facing Pyrus Signals option backtests use `artifacts/backtest-worker/src/index.ts#runOptionsBacktest`.
- The worker path now preserves optional quote fields when they are present, but current provider-backed option bars remain aggregate/OHLCV in practice.
- The worker still warns that historical quote/NBBO replay is not available on the current data plan. That warning is accurate and must remain until the provider path can actually supply bid/ask with timestamps.
- Therefore, the shared resolver and worker policy path are now ready for synthetic or future quote-populated runs, but the main user-facing signal-options backtest path must keep aggregate fills by default.

Implementation stages:

| Stage | Implement? | Exact Work | Regression Gate |
| --- | --- | --- | --- |
| 4A. User-facing path/data audit | Yes, first | Prove which run modes use shared `runBacktest` vs worker `runOptionsBacktest`. Confirm whether `/bars`, `normalizeBar`, `historical_bars`, and chart replay carry bid/ask/quote timestamps. This audit is the gate before any runtime behavior change. | A doc/code comment or test fixture records that current provider option bars are quote-empty. No UI selector is added while the user-facing worker path lacks quote data. |
| 4B. Shared resolver foundation | Done for first slice | Keep `resolveOptionFill` in `lib/backtest-core` as the single quote-quality and fill-price contract. Do not duplicate quote validation in the worker. | `option-fills.test.ts` stays green and covers the quote rejection matrix. |
| 4C. Quote-data availability decision | Done | Current Massive Options Developer history is aggregate/OHLCV-only for this app path. Historical quote replay remains unavailable, so user-facing conservative fills stay blocked by default. | Decision is recorded with provider/source notes and local tests proving current bars are quote-empty. |
| 4D. Historical-bar quote storage contract | Done as dormant infrastructure | Add nullable `bid`, `ask`, `mid`, `quoteAsOf`, and `providerContractId` columns to historical bar storage and keep old OHLCV rows valid. | Worker storage fixtures cover old OHLCV rows and quote-enriched rows. |
| 4E. API bar contract quote fields | Done as dormant infrastructure | Extend internal `Bar` schema and bridge/client types to allow optional quote fields. Generated clients are refreshed. | API contract tests parse both old OHLCV bars and quote-enriched option bars; `audit:api-codegen` passes. |
| 4F. Worker quote replay | Done as dormant infrastructure | Preserve quote fields through `/bars` normalization, dataset insertion, and cached-row replay. Conservative fills are blocked unless bars are 1m and fully quote-populated. | Worker quote-replay tests pass; aggregate/OHLCV compatibility tests pass. |
| 4G. Worker fill policy | Done, opt-in/internal only | Use the shared resolver for entries, flip exits, risk exits, and run-end liquidation only when internal `optionFillModel` is `conservative_quote` and quote replay is eligible. `post_and_wait` is not enabled in the worker yet. | Worker policy tests cover buy-at-ask, sell-at-bid, missing/stale/crossed/wide no-fill, and legacy-off behavior. |
| 4H. No-fill warnings and pending rules | Done as dormant infrastructure | Add deterministic warning formatting and entry skip / pending-exit handling in the opt-in worker path. | Helper tests prove warning content; worker end-to-end fixtures cover entry expiry, exit persistence, and run-end liquidation over quote-populated option bars. |
| 4I. Same-bar conservative tie break | Done as dormant infrastructure | Add same-bar hard-stop handling for long option conflicts in the opt-in worker path. Legacy aggregate behavior remains unchanged when no policy is selected. | Worker helper fixture proves same-bar stop path; public exposure remains blocked by provider-backed quote-data availability rather than missing helper coverage. |
| 4J. Shared engine opt-in | Done | Add an optional option-fill policy to `ExecutionProfile` only for shared-core synthetic/quote-populated runs and future non-worker option paths. If absent, `runBacktest` executes legacy logic. | Existing `engine.test.ts` legacy trades and metrics are unchanged. New shared-core tests cover quote-populated bars and rejected run-end liquidation without claiming to represent the worker path. |
| 4K. API/UI exposure | Done as no-exposure decision | Do not expose a user-facing fill-model selector until the worker path can enforce the selected model on real provider-backed quote data. No public API/UI schema is changed in this slice. | UI remains unchanged because the selected policy would not yet affect real user-facing option backtests on the current data plan. |

Validation commands for this slice:

- `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/*.test.ts`
- `pnpm --dir artifacts/backtest-worker run typecheck`
- `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/bar-contract.test.ts`
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --dir artifacts/api-server exec node --import tsx --test ../../lib/backtest-core/src/option-fills.test.ts ../../lib/backtest-core/src/engine.test.ts`
- `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/option-fill-worker-e2e.test.ts`
- `pnpm run audit:api-codegen`
- `pnpm run audit:markdown-paths`
- `git diff --check -- docs/plans/awesome-quant-pyrus-improvements.md artifacts/backtest-worker/src/index.ts artifacts/backtest-worker/src/backtest-bars.ts artifacts/backtest-worker/src/option-fill-policy.ts lib/api-spec/openapi.yaml lib/db/src/schema/backtesting.ts lib/ibkr-contracts/src/client.ts artifacts/api-server/src/providers/ibkr/bridge-client.ts`

Stop conditions:

- If any legacy backtest metric changes without an explicit expected-value update, stop and revert the engine wiring for that slice.
- If option quote fields are absent from worker-loaded historical bars, keep signal-options worker fills on aggregate legacy behavior or emit a no-fill warning in the internal opt-in path.
- If no-fill handling changes cash, exposure, or liquidation in a way not covered by fixtures, add fixtures before continuing.
- If a user-facing control would only affect shared-core runs while signal-options option runs still use aggregate bars, do not ship the control.

### 2. Calendar Dependency Spike: `pandas_market_calendars` vs `exchange_calendars`

Decision: plan now, implement after Task 4 unless backtest/date bugs make this urgent.

Implementation stages:

| Stage | Implement? | Exact Work | Regression Gate |
| --- | --- | --- | --- |
| 6A. Fixture table | Yes | Add a repo-local NYSE fixture table for full holidays, early closes, weekends, DST boundaries, and invalid dates. This is dependency-neutral and becomes the oracle for the spike. | Existing session tests still pass. New fixture table covers Good Friday, Juneteenth, Black Friday early close, July 3 early close when applicable, DST week, weekend, and invalid date. |
| 6B. Python spike | Yes | Evaluate both packages inside `python/pyrus_compute` without changing startup config. Measure install diff, import time, API ergonomics, and fixture parity. Choose one or reject both. | `pnpm run python-compute:doctor` and `pnpm run python-compute:test` pass after any dependency change. |
| 6C. Canonical service | Only after spike | Wrap the selected calendar behind a Pyrus service that returns session status, next open, next close, holiday, early-close, and RTH/pre/after/overnight classification. | Frontend and backend agree on the same fixture table. No `.replit` or artifact startup config changes. |

### 3. Backtest Validation Warnings

Decision: implement as native TypeScript analytics after option-fill wiring is stable.

Implementation stages:

| Stage | Implement? | Exact Work | Regression Gate |
| --- | --- | --- | --- |
| 5A. Warning model | Done | Added typed warnings in `lib/backtest-core` for low trade count, too many trials, missing out-of-sample window, drawdown duration, unstable Sharpe, and insufficient sample size. Existing metric fields remain unchanged; string warnings remain available. | `analytics.test.ts` covers each warning family, healthy no-warning output, stable payload shape, and existing advanced metric fields. |
| 5B. UI display | Yes | Surface warnings in existing backtesting panels without chart rewrites. Missing warning data renders nothing. | UI model tests prove old runs render unchanged and new warnings display without requiring new API fields unless a schema task is opened. |

### 4. Portfolio Optimization Libraries

Decision: spike later in Python compute; no broker or order-generation path.

Implementation stages:

| Stage | Implement? | Exact Work | Regression Gate |
| --- | --- | --- | --- |
| 8A. Compare libraries | Yes | Compare `skfolio`, `Riskfolio-Lib`, `PyPortfolioOpt`, and `empyrical-reloaded` for license, install size, runtime, deterministic output, and API fit. Prefer one library or reject all. | Python compute doctor/test/lint/typecheck pass. Existing `portfolio_risk` fixtures are unchanged. |
| 9A. Advisory job | Maybe after 8A | Add a Python compute job that returns suggested weights, risk contribution, turnover, concentration, and warnings. It must not return executable orders. | Fixtures cover empty input, invalid covariance, long-only constraints, max-weight constraints, deterministic output, and advisory-only response shape. |

### 5. Signal Forward-Return Analytics

Decision: implement natively from existing Pyrus signal and bar data; use `alphalens-reloaded` as a reference only.

Implementation stages:

| Stage | Implement? | Exact Work | Regression Gate |
| --- | --- | --- | --- |
| 11A. Dataset builder | Yes | Build normalized rows with signal timestamp, symbol, direction, score, horizons, realized return, adverse excursion, and missing-window status. | Fixtures cover complete windows, missing bars, incomplete windows, mixed symbols, and long/short direction. |
| 12A. Tear sheet metrics | Yes | Add hit rate, forward returns by horizon, score buckets, direction split, and correlation-style signal quality where sample size supports it. | Low-sample warnings are deterministic. No automation or broker decision consumes these analytics. |

### 6. Indicator Expansion

Decision: audit first; implement one native TypeScript indicator only after the inventory selects a high-value gap.

Implementation stages:

| Stage | Implement? | Exact Work | Regression Gate |
| --- | --- | --- | --- |
| 13A. Indicator inventory | Yes | Compare current chart/backtest indicators with `IndicatorTS` and TA-Lib-style coverage. Pick one indicator with clear user value and fixture data. | Docs-only review; no runtime changes. |
| 14A. One indicator slice | Maybe after 13A | Implement calculation, persistence, chart display, and tests for one selected indicator. Do not replace existing indicators wholesale. | Deterministic calculation fixtures, chart setting tests, and safe browser QA with `?pyrusQa=safe`. |

## Task List

### Phase 1: Research Inventory And Guardrails

#### Task 1: Build The Awesome Quant Candidate Matrix

**Description:** Convert the full-catalog sweep into a maintained matrix of open-source candidates mapped to Pyrus feature areas.

**Acceptance criteria:**

- [x] Matrix includes project, category, license, maintenance status, language/runtime, app fit, risk, and recommendation.
- [x] Entries are grouped by Pyrus feature area through the `Awesome Quant Area` and `Pyrus Fit` fields.
- [x] Paid/commercial services are excluded from implementation candidates.

**Verification:**

- [x] Every shortlisted candidate has a source link and rationale.
- [x] No GPL, AGPL, LGPL, or Commons-Clause-risk candidate is marked `integrate`.

**Dependencies:** None

**Estimated scope:** Small

#### Task 2: Define Dependency Admission Checklist

**Description:** Add a repeatable checklist for deciding whether to reference, port, wrap, or install a third-party quant library.

**Acceptance criteria:**

- [x] Checklist covers license, maintenance, install size, runtime compatibility, security, testability, data requirements, and replacement cost.
- [x] Checklist defines outcomes: `reference`, `port-pattern`, `integrate-python`, `integrate-ts`, `integrate-rust`, `reject`.
- [x] Checklist includes sample decisions.

**Verification:**

- [x] Sample decisions exist for `flashalpha-fill-simulator`, `pandas_market_calendars`, `exchange_calendars`, and `vectorbt`.

**Dependencies:** Task 1

**Estimated scope:** Small

### Checkpoint: Research Foundation

- [x] Candidate matrix exists.
- [x] Dependency admission checklist exists.
- [x] First shortlist is approved for deeper implementation planning.

### Phase 2: Options And Backtesting Execution Realism

#### Task 3 Contract Draft: Conservative Option Fill Simulation

Current Pyrus baseline:

- `BacktestBar` carries OHLCV data only.
- `ExecutionProfile` supports `commissionBps` and `slippageBps`.
- `runBacktest` fills pending entries/exits at the next available bar open with bps slippage.
- Option trades can be labeled with `instrumentType: "option"` and `pricingMode: "option_history"`, but fill quality is not modeled from bid/ask quotes.

Design goal:

- Keep legacy fills as the default for backward compatibility.
- Add an option-only conservative fill policy that can reject bad fills and produce deterministic diagnostics.
- Implement single-leg option behavior first; spreads remain out of scope until spread-level bid/ask data exists.

Proposed public shape:

```ts
type FillModel = "legacy_open_slippage" | "conservative_quote" | "post_and_wait";

type OptionFillPolicy = {
  model: FillModel;
  requireBidAsk: boolean;
  maxSpreadPctOfMid: number;
  maxQuoteAgeMs: number;
  missingQuoteAction: "no_fill" | "legacy_fallback";
  sameBarTieBreak: "conservative";
  postAndWait?: {
    entryOffsetPctOfSpread: number;
    exitOffsetPctOfSpread: number;
    maxWaitBars: number;
    crossAfterBars: number;
  };
};
```

Proposed bar extension:

```ts
type OptionBacktestBar = BacktestBar & {
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  quoteAsOf?: Date | null;
  providerContractId?: string | null;
};
```

Fill rules:

- `legacy_open_slippage`: current behavior; buy and sell fill at bar open with bps slippage.
- `conservative_quote`: buy fills at ask and sell fills at bid only when bid/ask are present, non-crossed, fresh, and within spread limits.
- `post_and_wait`: starts from a limit price between mid and the relevant side, waits up to `maxWaitBars`, then optionally crosses after `crossAfterBars`; no fill occurs if quote quality fails.
- Missing bid/ask in conservative modes returns `no_fill`, not a synthetic fill.
- Crossed quotes, zero/negative quotes, stale quotes, and spreads above `maxSpreadPctOfMid` return `no_fill`.
- If entry and risk-exit conditions occur on the same bar, the conservative tie break must choose the outcome least favorable to the strategy, not the highest PnL path.
- Fill diagnostics should be available on trades or warnings: model, requested side, fill price, bid, ask, mid, spread percent, decision, and rejection reason.

Initial fixture list before implementation:

| Fixture | Expected Result |
| --- | --- |
| Legacy open fill | Existing backtests fill exactly as today. |
| Fresh tight quote buy | Conservative buy fills at ask. |
| Fresh tight quote sell | Conservative sell fills at bid. |
| Missing bid/ask | Conservative mode returns no fill. |
| Crossed quote | Conservative mode returns no fill. |
| Wide quote | Conservative mode returns no fill and records `spread_too_wide`. |
| Stale quote | Conservative mode returns no fill and records `quote_stale`. |
| Post-and-wait touched | Limit fills only when the option bar touches the limit within wait bars. |
| Post-and-wait not touched | No fill if the limit is never touched before expiry. |
| Same-bar stop/target conflict | Conservative tie break chooses the worse outcome for the long option. |

Implementation note:

- The first code slice should add types and isolated fill-resolution tests before wiring the policy into `runBacktest`.
- The API/UI should not expose the new fill model until the backtest-core fixtures pass.

#### Task 3: Design Options Fill Simulation Contract

**Description:** Use `flashalpha-fill-simulator` as a reference to define Pyrus-native option fill simulation behavior.

**Acceptance criteria:**

- [x] Contract covers mid-fill, bid/ask fill, post-and-wait limit fill, stale quote rejection, wide quote rejection, deterministic same-bar tie break, and patient exit.
- [x] Contract supports single-leg options first and explicitly defers spreads unless the current backtest data supports them.
- [x] Contract defines inputs and outputs without requiring a new dependency.

**Verification:**

- [x] Unit test cases are written as fixtures before engine wiring.
- [x] Existing backtest behavior is documented as baseline.

**Dependencies:** Tasks 1-2

**Files touched:** `lib/backtest-core/src/option-fills.ts`, `lib/backtest-core/src/option-fills.test.ts`, `lib/backtest-core/src/types.ts`, `lib/backtest-core/src/index.ts`

**Estimated scope:** Medium

#### Task 4 Dependency Graph: Conservative Option Fill Rollout

**Description:** Implement conservative option fills as a staged rollout, starting with the actual user-facing Pyrus Signals option backtest path. Runtime behavior must not change until the worker path has a proven quote data source.

```text
Task 3 resolver contract
  -> Task 4A execution-path routing proof
  -> Task 4B worker option-bar data-shape guard
  -> Task 4C quote-data availability decision
      -> if quote data unavailable: keep aggregate fills and warning tests
      -> if quote data available:
           Task 4D storage contract
           -> Task 4E API bar contract
           -> Task 4F worker quote replay
           -> Task 4G worker fill policy
           -> Task 4H worker no-fill warnings
           -> Task 4I same-bar tie break
  -> Task 4J shared-engine opt-in
  -> Task 4K API/UI exposure
```

#### Task 4A: Prove Backtest Execution Routing

**Description:** Extract or test the routing decision that sends spot/equity runs to shared `runBacktest` and Pyrus Signals option runs to worker `runOptionsBacktest`.

**Acceptance criteria:**

- [x] A side-effect-free routing helper is extracted from the worker entrypoint and covers `spot`, `options`, and `signal_options`.
- [x] `pyrus_signals` plus `options`/`signal_options` is the only path that enters `runOptionsBacktest`.
- [x] Optimizer/walk-forward code remains spot-only unless a separate option sweep task is opened.

**Verification:**

- [x] `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/backtest-execution-mode.test.ts`
- [x] `pnpm --dir artifacts/backtest-worker run typecheck`

**Dependencies:** Task 3

**Files likely touched:**

- `artifacts/backtest-worker/src/index.ts`
- `artifacts/backtest-worker/src/backtest-execution.ts`
- `artifacts/backtest-worker/src/backtest-execution-mode.test.ts`

**Estimated scope:** Small

**Implementation notes:**

- Added `artifacts/backtest-worker/src/backtest-execution.ts` with `resolveBacktestExecutionMode`, `shouldRunOptionsBacktest`, and `shouldRankWalkForwardCandidatesWithSharedCore`.
- Refactored `artifacts/backtest-worker/src/index.ts` to use those helpers without changing runtime fill behavior.
- Regression guard: `artifacts/backtest-worker/src/backtest-execution-mode.test.ts` covers supported execution modes, Pyrus Signals option routing, non-Pyrus fallback, and spot-only walk-forward candidate ranking.

#### Task 4B: Guard Current Worker Option-Bar Shape

**Description:** Add a narrow guard proving the current provider-backed worker option-bar path is quote-empty so future work cannot accidentally claim bid/ask realism without data.

**Acceptance criteria:**

- [x] Side-effect-free bar-shape helpers are extracted from the worker entrypoint and prove current provider bars normalize and persist with `bid`, `ask`, and `quoteAsOf` empty.
- [x] Existing worker warning about aggregate option bars remains present for option runs.
- [x] No runtime fill behavior changes.

**Verification:**

- [x] `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/option-bar-shape.test.ts`
- [x] `pnpm --dir artifacts/backtest-worker run typecheck`

**Dependencies:** Task 4A

**Files likely touched:**

- `artifacts/backtest-worker/src/index.ts`
- `artifacts/backtest-worker/src/backtest-bars.ts`
- `artifacts/backtest-worker/src/option-bar-shape.test.ts`

**Estimated scope:** Small

**Implementation notes:**

- Added `artifacts/backtest-worker/src/backtest-bars.ts` with explicit API normalization, persisted-row normalization, nullable quote insert mapping, and aggregate option-bar warning constants.
- Refactored `artifacts/backtest-worker/src/index.ts` to use the bar helpers for `/bars` responses, historical bar inserts, and cached row loading.
- Regression guard: `artifacts/backtest-worker/src/option-bar-shape.test.ts` proves current provider bars remain quote-empty and that the warning copy stays explicit.

### Checkpoint: Option Fill Data Gate

- [x] Execution routing is tested.
- [x] Worker option bars are proven OHLCV-only or quote-capable.
- [x] If quote fields are absent, conservative worker fills remain blocked and only aggregate-fill transparency work may proceed.
- [x] Human review confirms whether to pursue quote-data enablement or defer public conservative runtime fills.

#### Task 4C: Decide Historical Quote Data Availability

**Description:** Determine whether the current provider/API plan can supply historical option bid/ask with timestamps for the option contracts used by `runOptionsBacktest`.

**Acceptance criteria:**

- [x] Decision record names the source: existing `/bars`, option quote snapshot cache, provider historical quotes, or unavailable.
- [x] If unavailable, public conservative fills remain blocked and the worker keeps aggregate fills with explicit warnings.
- [x] If available, the decision names required schema/API/storage changes before fill wiring.

**Verification:**

- [x] Decision is recorded in this plan under Task 4C notes.
- [x] Any live/provider check used for the decision is linked to a repeatable command or fixture.

**Dependencies:** Task 4B

**Files likely touched:**

- `docs/plans/awesome-quant-pyrus-improvements.md`

**Estimated scope:** Small

**Task 4C notes:**

- Decision: historical quote data is unavailable for conservative worker fills on the current app path. The worker must keep aggregate option fills and explicit warnings until per-contract historical bid/ask quotes with timestamps are available and persisted end to end.
- Human/product decision: implement Task 4D-4I as dormant, opt-in infrastructure now, without approving a provider upgrade, public UI selector, or default fill-behavior change.
- Existing `/bars` source: `artifacts/api-server/src/routes/platform.ts#/bars` calls `getBarsWithDebug`. The generated `Bar` contract now allows optional `bid`, `ask`, `mid`, `quoteAsOf`, and `providerContractId`, but the current provider-backed option path does not populate historical quote records on the Massive Options Developer plan.
- Existing worker path: `artifacts/backtest-worker/src/backtest-bars.ts` now normalizes, stores, and reloads optional quote fields when present. `artifacts/backtest-worker/src/option-bar-shape.test.ts` remains the guard that current provider bars stay quote-empty.
- Option chart/reference source: `getOptionChartBarsWithDebug` can fetch Polygon/Massive option aggregates and can use IBKR midpoint history, but those are still bar-price series, not per-bar NBBO quote records.
- Option quote snapshot cache: usable for live/current valuation and the explicit `allowStudyFallback` one-bar chart fallback only. It is not a historical quote replay source and must not be used to backfill historical fills.
- Provider docs: Massive documents `/v3/quotes/{optionsTicker}` as historical option quotes with bid/ask prices, sizes, exchange identifiers, and timestamps, but the same plan table shows the endpoint is not included for Options Developer and is available at Options Advanced/business tiers. Massive options flat-file quotes are likewise not included for Options Developer. Sources: [Massive options quotes](https://massive.com/docs/rest/options/trades-quotes/quotes), [Massive options flat-file quotes](https://massive.com/docs/flat-files/options/quotes).
- Broker docs: IBKR Client Portal historical bars support a `source` parameter with `Trades`, `Midpoint`, and `Bid_Ask`, but the current bridge returns `BrokerBarSnapshot` as OHLCV bars, not distinct bid/ask quote records. IBKR also documents historical-data limits for expired options and EOD option data, so it is not a sufficient default NBBO replay source for user-facing backtests. Source: [IBKR Client Portal historical market data](https://www.interactivebrokers.com/campus/ibkr-api-page/cpapi-v1/).
- No live provider check was used for this decision. Repeatable local evidence is covered by `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/option-bar-shape.test.ts src/option-bar-replay.test.ts src/option-fill-policy.test.ts` and the generated `lib/api-zod/src/generated/types/bar.ts` contract.
- Production-enable criteria: a paid/provider capability is confirmed and wired for historical option quote records. The synthetic quote-populated worker fixtures and shared-engine opt-in are now complete; reopen Task 4K only when real provider-backed quote replay can make the public selector affect user-facing option backtests.

#### Task 4D: Add Historical-Bar Quote Storage Contract

**Description:** Extend historical bar storage so future option quote fields can survive cache load/replay while old aggregate/OHLCV rows remain valid.

**Acceptance criteria:**

- [x] Storage can persist optional `bid`, `ask`, `mid`, `quoteAsOf`, and `providerContractId` without breaking existing OHLCV rows.
- [x] Old cached OHLCV-only datasets still load as valid bars.
- [x] Quote fields are optional and never required for spot/equity datasets.

**Verification:**

- [x] Targeted worker storage fixtures cover old OHLCV rows and quote-enriched rows.
- [x] `pnpm --dir artifacts/backtest-worker run typecheck`

**Dependencies:** Task 4C. Production use still depends on a confirmed historical quote source.

**Files touched:**

- `lib/db/src/schema/backtesting.ts`
- `lib/db/migrations/20260530_historical_bar_quote_fields.sql`
- `artifacts/backtest-worker/src/backtest-bars.ts`
- `artifacts/backtest-worker/src/option-bar-shape.test.ts`
- `artifacts/backtest-worker/src/option-bar-replay.test.ts`

**Estimated scope:** Medium

**Implementation notes:**

- Added nullable quote columns and a partial provider-contract/quote timestamp index.
- `toHistoricalBarInsert` writes quote fields only when present; old rows normalize to `null` quote fields.

#### Task 4E: Extend API Bar Contract For Quote Fields

**Description:** Extend the internal bar contract so `/bars` can return optional quote fields to the worker when a provider source becomes available.

**Acceptance criteria:**

- [x] `/bars` response can include optional `bid`, `ask`, `mid`, `quoteAsOf`, and `providerContractId`.
- [x] Generated clients/codegen reflect the schema.
- [x] Existing consumers that ignore quote fields remain compatible.

**Verification:**

- [x] Targeted API bar response test covers quote-enriched option bars and old OHLCV bars.
- [x] `pnpm run audit:api-codegen`
- [x] `pnpm --filter @workspace/api-server run typecheck`

**Dependencies:** Task 4C, Task 4D if storage-backed

**Files touched:**

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/bar.ts`
- `artifacts/api-server/src/providers/ibkr/bridge-client.ts`
- `lib/ibkr-contracts/src/client.ts`
- `artifacts/api-server/src/services/bar-contract.test.ts`

**Estimated scope:** Medium

**Implementation notes:**

- `audit:api-codegen` passed after regeneration. The generator also refreshed broader pre-existing generated drift from the current OpenAPI spec; keep those generated changes together with this schema update unless a separate codegen cleanup is opened.

#### Task 4F: Replay Quote-Enriched Bars In The Worker

**Description:** Teach the worker to normalize, cache, and load quote-enriched option bars. Conservative fills remain blocked unless replay data is 1m and fully quote-populated.

**Acceptance criteria:**

- [x] `normalizeBar` preserves quote fields from `/bars`.
- [x] Stored and reloaded option bars retain quote fields.
- [x] Aggregation explicitly blocks conservative fills on non-1m or quote-incomplete bars.

**Verification:**

- [x] `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/option-bar-replay.test.ts`
- [x] `pnpm --dir artifacts/backtest-worker run typecheck`

**Dependencies:** Task 4D, Task 4E

**Files touched:**

- `artifacts/backtest-worker/src/index.ts`
- `artifacts/backtest-worker/src/backtest-bars.ts`
- `artifacts/backtest-worker/src/option-bar-replay.test.ts`
- `artifacts/backtest-worker/src/option-fill-policy.ts`

**Estimated scope:** Medium

#### Task 4G: Wire Worker Entries And Exits Through The Resolver

**Description:** Use `resolveOptionFill` inside `runOptionsBacktest` for option entries, flip exits, risk exits, and end-of-run liquidation only when an internal opt-in policy is selected and quote replay is eligible.

**Acceptance criteria:**

- [x] Legacy aggregate-bar fill mode remains default.
- [x] Conservative mode buys at ask and sells at bid when quotes pass quality checks.
- [x] Missing, crossed, stale, and wide quotes do not synthesize fills.

**Verification:**

- [x] Worker fixtures cover buy-at-ask, sell-at-bid, missing quote, crossed quote, stale quote, and wide quote.
- [x] `pnpm --dir artifacts/backtest-worker run typecheck`
- [x] `pnpm --dir artifacts/api-server exec node --import tsx --test ../../lib/backtest-core/src/option-fills.test.ts`

**Dependencies:** Task 4F

**Files likely touched:**

- `artifacts/backtest-worker/src/index.ts`
- `artifacts/backtest-worker/src/option-fill-policy.test.ts`
- `lib/backtest-core/src/option-fills.ts`

**Estimated scope:** Medium

#### Task 4H: Add Deterministic No-Fill Warnings And Pending Rules

**Description:** Define what happens when the conservative resolver returns `no_fill` in the worker so cash, exposure, and trade counts stay explainable.

**Acceptance criteria:**

- [x] Failed conservative entries expire after the attempted fill bar and add a warning.
- [x] Failed conservative exits remain pending until a valid quote or end-of-run liquidation.
- [x] Warnings include model, side, symbol, timestamp, and rejection reason.

**Verification:**

- [x] End-to-end worker run fixtures cover entry expiry, exit persistence, and end-of-run liquidation before public exposure.
- [x] Existing aggregate-bar warning fixtures remain unchanged when conservative mode is off.
- [x] Helper fixtures prove no-fill warning content and rejection reasons.

**Dependencies:** Task 4G

**Files likely touched:**

- `artifacts/backtest-worker/src/index.ts`
- `artifacts/backtest-worker/src/option-fill-policy.test.ts`

**Estimated scope:** Medium

#### Task 4I: Add Same-Bar Conservative Tie Break

**Description:** Ensure same-bar entry and risk-exit conflicts choose a deterministic conservative outcome rather than profit-ranked behavior.

**Acceptance criteria:**

- [x] Stop is evaluated before target for long option conflicts.
- [x] Same-bar entry plus risk exit uses the least favorable deterministic path.
- [x] Legacy aggregate-bar behavior is unchanged when conservative mode is off.

**Verification:**

- [x] Worker helper fixture with same-bar stop and target closes on the conservative stop path.
- [x] Shared resolver tests remain green.
- [x] Worker end-to-end fixture covers the quote-populated policy path; public API/UI exposure remains provider-gated, not fixture-gated.

**Dependencies:** Task 4H

**Files likely touched:**

- `artifacts/backtest-worker/src/index.ts`
- `artifacts/backtest-worker/src/option-fill-policy.test.ts`

**Estimated scope:** Small

### Checkpoint: Worker Conservative Fills

- [x] Worker option bars can carry quote fields, and conservative fills remain blocked when quote replay is incomplete.
- [x] Conservative worker fills are opt-in/internal only.
- [x] Aggregate-bar default behavior remains compatible.
- [x] No-fill behavior is covered by core and worker helper fixtures.
- [x] Same-bar conflict behavior is covered by a worker helper fixture.
- [x] End-to-end worker fixtures over quote-populated option bars cover conservative entry fills, rejected entry expiry, rejected exit persistence, and run-end quote liquidation.

#### Task 4J: Add Shared-Core Engine Opt-In

**Description:** Add optional conservative option fill support to shared `lib/backtest-core` for synthetic or future quote-populated option runs. This is lower priority than worker support because it is not the main user-facing Pyrus Signals option path.

**Acceptance criteria:**

- [x] `ExecutionProfile` can carry an optional option fill policy.
- [x] Absence of the policy produces identical shared-engine trades and metrics.
- [x] Quote-populated shared-core fixtures use the same resolver as the worker.

**Verification:**

- [x] `pnpm --dir artifacts/api-server exec node --import tsx --test ../../lib/backtest-core/src/engine.test.ts ../../lib/backtest-core/src/option-fills.test.ts`
- [x] `pnpm run typecheck:libs`

**Dependencies:** Task 4G, unless needed earlier for synthetic-only tests

**Files likely touched:**

- `lib/backtest-core/src/engine.ts`
- `lib/backtest-core/src/types.ts`
- `lib/backtest-core/src/engine.test.ts`
- `lib/backtest-core/src/option-fills.ts`

**Estimated scope:** Medium

**Implementation notes:**

- Added `executionProfile.optionFillPolicy` as an internal shared-core opt-in. Missing policy preserves the legacy open-plus-slippage fill path.
- Shared-core fixtures prove legacy behavior, conservative bid/ask fills, missing-quote entry rejection, and final exposure preservation when run-end liquidation rejects.

#### Task 4K: Public Fill Model API/UI Exposure Decision

**Description:** Decide whether to expose conservative fill settings publicly. Because the worker can enforce the policy only for synthetic/future quote-populated bars and the current provider path still lacks historical option quotes, the correct outcome for this slice is no public API/UI exposure.

**Acceptance criteria:**

- [x] UI selector is not added while current user-facing option backtests cannot receive provider-backed historical bid/ask quote replay.
- [x] API schema remains unchanged for public fill-model selection, so old/default runs are unchanged.
- [x] Generated clients are not regenerated for this decision because no public schema change is introduced.

**Verification:**

- [x] No API/UI code is touched for fill-model exposure in this slice.
- [x] Plan stop condition remains: do not ship a selector that only affects synthetic/shared-core runs while real signal-options runs remain provider-gated.
- [x] Browser QA is not required because no public UI control is added.

**Dependencies:** Task 4I and Task 4J if shared-core exposure is included

**Files likely touched:**

- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx`
- `artifacts/pyrus/src/features/backtesting/*test*`

**Estimated scope:** Medium

**Implementation notes:**

- Public exposure is deferred until a provider or broker path supplies historical option bid/ask quote records with timestamps end to end.
- When that data source exists, reopen this task as a public schema/UI task with OpenAPI/zod/client regeneration and backtesting UI tests in the same change.

#### Task 5: Add Backtest Validation Warnings

**Description:** Extend current analytics with clearer anti-overfit and statistical-confidence warnings inspired by `backtester-mcp`, `vectorbt`, and pyfolio-style tear sheets.

**Plan-tune application:** User-declared profile is high scope appetite, low risk tolerance, high detail preference, low autonomy, and high architecture care. Implement this stage as complete additive diagnostics, not as a shortcut warning banner. Warnings must have stable codes, severities, evidence payloads, and regression fixtures before any UI exposure. Any warning that could change user interpretation of a strategy is a product-facing decision point, not a silent metric change.

**Acceptance criteria:**

- [x] Warning contract defines stable `code`, `severity`, `message`, `evidence`, and `scope` fields.
- [x] Warnings cover low trade count, too many parameter trials, no out-of-sample window, excessive drawdown duration, unstable Sharpe, and insufficient sample size for any advanced metric.
- [x] Existing deflated/probabilistic Sharpe outputs remain intact and retain current field names.
- [x] Warnings are additive: old/default backtest outputs remain valid when consumers ignore the new warning field.
- [ ] UI can display warnings without new chart work, broker behavior, or automation coupling.

**Verification:**

- [x] Analytics unit tests cover each warning condition, boundary threshold, and no-warning healthy case.
- [x] Legacy fixture proves existing backtest trades and metrics remain unchanged except for additive warnings.
- [x] Snapshot or contract fixture proves warning payload shape is stable.
- [x] Typecheck and targeted `backtest-core` tests pass before any UI task starts.

**Dependencies:** Task 1

**Files likely touched:** `lib/backtest-core/src/analytics.ts`, `lib/backtest-core/src/types.ts`, `lib/backtest-core/src/analytics.test.ts`, backtesting UI model files

**Estimated scope:** Medium

**Tuned implementation breakdown:**

- [x] **5A. Warning contract:** add typed warning codes/severities and keep the result schema backward-compatible.
- [x] **5B. Warning computation:** implement deterministic warning generation in `backtest-core` without changing existing metrics.
- [ ] **5C. Warning presentation model:** map warnings into current backtest UI surfaces with missing-data-safe rendering.
- [ ] **5D. Exposure decision:** before making warnings prominent in the UI, review wording and severity so users do not mistake diagnostics for trading advice.

### Checkpoint: Backtest Core

- [x] Conservative option fill mode is available as an internal/shared-core and worker quote-populated opt-in.
- [ ] Backtest warnings surface clearly.
- [x] Current backtest defaults remain compatible.

### Phase 3: Market Calendar Correctness

#### Task 6: Replace Hand-Rolled Calendar Assumptions With A Calendar Service

**Description:** Use `exchange_calendars` or `pandas_market_calendars` as the reference for a canonical market-session service.

**Acceptance criteria:**

- [ ] Service returns session status, next open, next close, holidays, early closes, and timezone-aware RTH/pre/after classifications.
- [ ] NYSE behavior matches current UI needs.
- [ ] Current hand-coded holiday logic is either replaced or wrapped behind the new service.

**Verification:**

- [ ] Tests cover DST, weekends, full holidays, early closes, Juneteenth, Good Friday, and invalid dates.
- [ ] Existing chart session tests still pass or are updated intentionally.

**Dependencies:** Tasks 1-2

**Files likely touched:** `artifacts/pyrus/src/features/charting/marketSession.ts`, optional API server market/session service, tests

**Estimated scope:** Medium

#### Task 7: Apply Calendar Service To Trading And Data Admission

**Description:** Use the canonical market calendar in data prewarm, market-data admission, and trading readiness where session correctness matters.

**Acceptance criteria:**

- [ ] Market-data work planner avoids requesting impossible exchange windows.
- [ ] UI session labels match backend readiness/session decisions.
- [ ] Overnight/premarket/RTH/after-hours logic is consistent across frontend and backend.

**Verification:**

- [ ] Targeted API server tests for market-data work planning and chart session behavior.
- [ ] Browser QA with `?pyrusQa=safe` on chart and platform session indicators.

**Dependencies:** Task 6

**Files likely touched:** market-data planner service, charting session code, related tests

**Estimated scope:** Medium

### Checkpoint: Calendar

- [ ] Calendar tests cover holidays and early closes.
- [ ] Frontend and backend session decisions agree.
- [ ] No Replit startup config touched.

### Phase 4: Portfolio And Risk Analytics

#### Task 8: Add Portfolio Risk Library Spike

**Description:** Evaluate `skfolio`, `Riskfolio-Lib`, `PyPortfolioOpt`, and `empyrical-reloaded` inside the existing Python compute service.

**Decision:** Completed on 2026-05-30. Do not add a portfolio/risk dependency to `python/pyrus_compute` in this wave. Keep the native advisory `portfolio_optimization` job as the production path. Prefer `skfolio` only for a future explicit advanced-optimizer spike if Pyrus needs solver-backed min-volatility, CVaR, HERC, risk budgeting, or model-selection behavior. Full spike notes: `docs/spikes/portfolio-risk-library-spike-2026-05-30.md`.

**Acceptance criteria:**

- [x] Spike compares install size, runtime, license, API fit, and sample outputs.
- [x] One library is selected for integration or all are rejected with reasons.
- [x] Existing `portfolio_risk` job remains stable.

**Verification:**

- [x] `pnpm run python-compute:doctor`
- [x] `pnpm run python-compute:test`
- [x] One local sample job compares candidate output against current Python compute portfolio optimization fixture.

**Dependencies:** Tasks 1-2

**Files likely touched:** `python/pyrus_compute/pyproject.toml`, `python/pyrus_compute/src/pyrus_compute/jobs.py`, tests

**Estimated scope:** Medium

#### Task 9: Add Portfolio Optimization Job

**Description:** Add a Python compute job for allocation suggestions using the selected risk/optimization approach.

**Status:** Completed for internal/advisory use on 2026-05-30 via the native `portfolio_optimization` Python compute job and read-only inspector. No API account-risk wrapper or broker/order path was added.

**Acceptance criteria:**

- [x] Job accepts symbols, weights, returns/covariance inputs, constraints, and objective.
- [x] Job returns proposed weights, concentration, turnover, risk contribution, and warnings.
- [x] No trade instructions are generated automatically.

**Verification:**

- [x] Python job tests cover empty input, invalid covariance, long-only constraint, max-weight constraint, and deterministic output.
- [ ] API server job wrapper test validates schema. Deferred because the job remains internal/inspector-only.

**Dependencies:** Task 8

**Files likely touched:** Python compute models/jobs/tests, API server Python compute wrapper

**Estimated scope:** Medium

#### Task 10: Surface Options Risk Recommendations

**Description:** Add an account-facing view/model that displays options-native risk reviews from account premium exposure, Greek coverage, Greek scenario shocks, expiry buckets, and underlying option concentration without implying automatic execution.

**Status:** Completed locally on 2026-05-30 as `riskRecommendations` on the account risk payload plus the desktop Portfolio Exposure `Option Risk Reviews` strip. This intentionally does not expose generic allocation/rebalance copy.

**Acceptance criteria:**

- [x] UI shows option premium exposure, worst option shock, and major coverage/concentration/Greek/expiry reviews.
- [x] Suggestions are explicitly advisory.
- [x] No broker order path is connected.

**Verification:**

- [x] Frontend unit tests for display model.
- [ ] Browser QA with safe fixture data.

**Dependencies:** Task 9

**Files likely touched:** account screen model/components and tests

**Estimated scope:** Medium

### Checkpoint: Portfolio Risk

- [ ] Python compute tests pass.
- [ ] Portfolio suggestions are advisory only.
- [ ] No trading mutation path is introduced.

### Phase 5: Signal And Factor Evaluation

Plan-tune profile for this phase: prefer a complete, careful analytics pipeline over a quick dashboard. Build the dataset contract and regression fixtures before any tear-sheet UI. Signal-quality outputs are advisory only; no automation, broker order path, or live trade gating may consume them until a separate safety plan exists.

#### Task 11: Define Signal Forward-Return Dataset

**Description:** Create a normalized dataset for evaluating Pyrus signals against future returns, inspired by `alphalens-reloaded`.

**Acceptance criteria:**

- [ ] Dataset contract includes signal timestamp, symbol, direction, score, source strategy/profile, source timeframe, forward windows, realized returns, adverse excursion, favorable excursion, and hit/miss labels.
- [ ] Missing bars, incomplete forward windows, duplicate/overlapping signals, mixed symbols, and timezone/session boundaries are represented with explicit status/reason fields.
- [ ] Dataset can be generated from existing signal/backtest data without adding a broker dependency or live-trading side effect.
- [ ] Horizon and bucket defaults are documented before implementation; changing them later requires versioned output or a migration note.
- [ ] Dataset rows are stable enough for later UI, exports, and backtest comparison without re-shaping the contract.

**Verification:**

- [ ] Fixture tests cover complete windows, missing bars, incomplete windows, duplicate signals, mixed symbols, long/short direction, score missing, and session boundary alignment.
- [ ] Generated dataset matches known sample signals with deterministic expected returns and excursion values.
- [ ] No automation or trading service imports the dataset builder.
- [ ] Typecheck and targeted service tests pass before Task 12 starts.

**Dependencies:** Task 1

**Files likely touched:** signal monitor/backtest services and tests

**Estimated scope:** Medium

#### Task 12: Add Signal Quality Tear Sheet

**Description:** Add metrics and UI summaries for whether signals have predictive value.

**Acceptance criteria:**

- [ ] Metrics include forward return by horizon, hit rate, average adverse excursion, average favorable excursion, score bucket performance, direction split, and sample-size/confidence labels.
- [ ] UI can compare current signal profile against historical profile without implying execution recommendation or broker action.
- [ ] Results include confidence warnings for small samples, missing horizons, skewed symbol mix, and stale/insufficient history.
- [ ] Empty, partial, and low-confidence states render as neutral diagnostics rather than hidden failures.
- [ ] Any product-facing wording that could be interpreted as trading advice is reviewed before browser QA.

**Verification:**

- [ ] Unit tests cover metric calculations, bucket boundaries, direction split, missing data, and low-sample warnings.
- [ ] UI model tests cover score buckets, missing data, partial horizons, and neutral low-confidence rendering.
- [ ] Browser QA with `?pyrusQa=safe` and fixture data.
- [ ] Existing signal monitor and automation tests remain unchanged unless intentionally updated.

**Dependencies:** Task 11

**Files likely touched:** signal analytics service, signal monitor UI, tests

**Estimated scope:** Medium

### Checkpoint: Signal Evaluation

- [ ] Forward-return dataset exists.
- [ ] Signal quality metrics are visible.
- [ ] Low-confidence samples are flagged.

### Phase 6: Indicators And Research UX

#### Task 13: Audit Indicator Coverage

**Description:** Compare current chart/backtest indicators against `IndicatorTS`, TA-Lib patterns, and existing Pyrus signal settings.

**Acceptance criteria:**

- [ ] Inventory lists current indicators and missing high-value indicators.
- [ ] Each proposed indicator has formula source, test fixture, and UI use case.
- [ ] Dependency recommendation is explicit: native TypeScript vs library.

**Verification:**

- [ ] Manual review of inventory.
- [ ] No new indicator is approved without fixture data.

**Dependencies:** Task 1

**Files likely touched:** docs only for this task

**Estimated scope:** Small

#### Task 14: Add One Native Indicator Slice

**Description:** Implement the highest-value missing indicator as a vertical slice across calculation, persistence, chart display, and tests.

**Acceptance criteria:**

- [ ] Indicator can be selected in chart settings.
- [ ] Indicator works in backtest/research context if applicable.
- [ ] Indicator calculation has deterministic fixture tests.

**Verification:**

- [ ] Chart indicator tests.
- [ ] Browser QA with `?pyrusQa=safe`.

**Dependencies:** Task 13

**Files likely touched:** chart indicators, persistence, UI model/tests

**Estimated scope:** Medium

### Checkpoint: Indicators

- [ ] Indicator inventory exists.
- [ ] One new indicator ships end-to-end.
- [ ] Calculations are fixture-tested.

## Parallelization Opportunities

- Tasks 3, 6, 8, 11, and 13 can be researched in parallel after Tasks 1-2.
- Tasks 4-5 should be sequential because both affect backtest interpretation.
- Tasks 9-10 should be sequential because UI depends on compute/API output.
- Tasks 11-12 should be sequential because metrics depend on the forward-return dataset.
- Documentation can run in parallel with implementation after each checkpoint.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| License contamination | High | Use the admission checklist before adding dependencies; reject GPL/AGPL/LGPL/Commons-Clause candidates unless approved. |
| Backtest metric drift | High | Keep old defaults; add fixtures comparing old and new execution modes. |
| Calendar regressions | High | Cover DST, holidays, early closes, and invalid dates with tests. |
| Python dependency bloat | Medium | Spike install and runtime size before dependency adoption. |
| UI overpromises analytics | Medium | Label outputs as advisory and show confidence warnings. |
| Overfitting from richer sweeps | Medium | Add trial count, out-of-sample, and low-trade warnings. |

## Open Questions

- Which options-fill behavior should become the default after the conservative mode is validated?
- Should market calendar truth live only in Python compute, or should the API server expose a canonical calendar endpoint for frontend use?
- Should portfolio optimization be advisory-only forever, or eventually connect to broker order tickets with explicit user confirmation?
- Which single indicator should be the first native slice after the indicator audit?

## Source Links

- [`awesome-quant`](https://github.com/wilsonfreitas/awesome-quant)
- [`flashalpha-fill-simulator`](https://github.com/FlashAlpha-lab/flashalpha-fill-simulator)
- [`pandas_market_calendars`](https://github.com/rsheftel/pandas_market_calendars)
- [`exchange_calendars`](https://github.com/gerrymanoim/exchange_calendars)
- [`empyrical-reloaded`](https://github.com/stefan-jansen/empyrical-reloaded)
- [`pyfolio-reloaded`](https://github.com/stefan-jansen/pyfolio-reloaded)
- [`alphalens-reloaded`](https://github.com/stefan-jansen/alphalens-reloaded)
- [`skfolio`](https://github.com/skfolio/skfolio)
- [`Riskfolio-Lib`](https://github.com/dcajasn/Riskfolio-Lib)
- [`PyPortfolioOpt`](https://github.com/robertmartin8/PyPortfolioOpt)
- [`IndicatorTS`](https://github.com/cinar/indicatorts)
- [`fin-primitives`](https://github.com/Mattbusel/fin-primitives)
- [`vollib`](https://github.com/vollib/vollib)
- [`bt`](https://github.com/pmorissette/bt)
- [`vectorbt`](https://github.com/polakowo/vectorbt)
- [`backtester-mcp`](https://github.com/bcosm/backtester-mcp)
- [`nautilus_trader`](https://github.com/nautechsystems/nautilus_trader)
- [`Lumibot`](https://github.com/Lumiwealth/lumibot)
- [`StrateQueue`](https://github.com/StrateQueue/StrateQueue)
- [`optionlab`](https://github.com/rgaveiga/optionlab)
- [`FinancePy`](https://github.com/domokane/FinancePy)
- [`QuantConnect Lean`](https://github.com/QuantConnect/Lean)
- [`Qlib`](https://github.com/microsoft/qlib)

## Plan Eng Review: Task 4A-4C

Review date: 2026-05-30

Scope reviewed:

- Task 4A: prove backtest execution routing.
- Task 4B: guard current worker option-bar shape.
- Task 4C: decide historical quote data availability.

Scope decision:

- The full Task 4A-4K rollout is intentionally too broad for one implementation pass because it spans worker runtime, DB storage, API schema/codegen, shared backtest core, and UI controls.
- The reviewed slice is the smallest useful gate: prove routing, prove current data shape, then decide if quote-data enablement is possible.
- Runtime fill behavior remains unchanged in this slice.

### What Already Exists

| Existing Code Or Flow | Reuse Decision |
| --- | --- |
| `artifacts/backtest-worker/src/index.ts#resolveExecutionMode` already maps `options` and `signal_options` away from spot. | Reuse by extracting a side-effect-free helper rather than rebuilding routing logic. |
| `artifacts/backtest-worker/src/index.ts#executeStudyRun` already routes `pyrus_signals` option modes into `runOptionsBacktest`. | Reuse and cover with focused routing tests. |
| `artifacts/backtest-worker/src/index.ts#runOptionsBacktest` already warns that historical quote/NBBO replay is unavailable. | Preserve this warning until quote fields are proven available. |
| `artifacts/backtest-worker/src/index.ts#normalizeBar`, `insertBars`, and `loadBarsFromDataset` currently handle OHLCV/source/delayed only. | Use these as the current-state data-shape guard. |
| `lib/backtest-core/src/option-fills.ts` already centralizes quote validation and fill decisions. | Keep as the eventual fill resolver; do not duplicate quote-quality logic in the worker. |

### NOT In Scope

- Historical note: the bullets below were the scope limits for the original Task 4A-4C eng review. A later user decision approved dormant 4D-4I infrastructure while keeping public/default behavior blocked.
- DB migration for historical quote fields: review-time deferral; later implemented as nullable dormant storage.
- API `/bars` schema/codegen changes: review-time deferral; later implemented as optional quote fields.
- Worker conservative fill behavior: review-time deferral; later implemented only as an opt-in/internal path that still blocks quote-incomplete bars.
- Shared-core `runBacktest` opt-in: lower priority than the worker path because it is not the main user-facing Pyrus Signals options route.
- API/UI fill-model controls: deferred until the selected mode changes actual user-facing option backtest behavior.

### Architecture Review

1. [P2] (confidence: 9/10) `artifacts/backtest-worker/src/index.ts:1478` — Testing the current worker entrypoint directly would couple tests to a large side-effectful module instead of the routing/bar-shape logic we actually need to lock.

   Motivating lines:

   ```ts
   if (
     resolveExecutionMode(study) !== "spot" &&
     study.strategyId === "pyrus_signals"
   ) {
     const optionResult = await runOptionsBacktest(study, barsBySymbol);
   ```

   Resolution accepted: extract tiny side-effect-free helpers for Task 4A and Task 4B before adding tests. This keeps the implementation boring, explicit, and small.

### Code Quality Review

No additional issues found for the scoped `4A-4C` slice after the helper-extraction decision.

The important code-quality constraint is to keep the new helper modules narrow:

- `backtest-execution.ts`: routing/mode predicates only.
- `backtest-bars.ts`: API bar normalization and quote-field capability checks only.
- No fill behavior, DB migration, or UI concerns in these helpers.

### Test Review

```text
CODE PATHS                                             USER FLOWS
[PLAN] Task 4A routing proof                           [PLAN] Backtest run starts
  ├── [GAP COVERED] spot -> shared runBacktest           ├── [PLAN] Spot/equity runs keep old path
  ├── [GAP COVERED] pyrus_signals/options -> worker      ├── [PLAN] Pyrus Signals options uses worker
  ├── [GAP COVERED] pyrus_signals/signal_options -> worker
  ├── [GAP COVERED] non-pyrus options -> shared fallback
  └── [GAP COVERED] walk-forward training remains spot-only

[PLAN] Task 4B option-bar shape guard                  [PLAN] User reads option backtest results
  ├── [GAP COVERED] current provider ApiBarsResponse has no bid/ask
  ├── [GAP COVERED] normalizeBar does not invent hidden quote
  ├── [GAP COVERED] old historical_bars rows stay OHLCV-only
                                                               ├── [PLAN] Aggregate-bar warning remains visible
                                                               └── [PLAN] No UI fill selector appears yet
  └── [GAP COVERED] aggregate-fill warning remains

[PLAN] Task 4C quote-data decision
  ├── [GAP COVERED] quote unavailable -> block public/default conservative fills
  ├── [GAP COVERED] quote available -> name schema/API/storage changes
  └── [GAP COVERED] live/provider evidence is repeatable or fixture-backed

COVERAGE PLAN: 12/12 scoped paths planned
QUALITY TARGET: behavior + edge + error for routing and data-shape helpers
```

Required tests:

- `artifacts/backtest-worker/src/backtest-execution-mode.test.ts`
- `artifacts/backtest-worker/src/option-bar-shape.test.ts`

Required commands:

- `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/backtest-execution-mode.test.ts src/option-bar-shape.test.ts`
- `pnpm --dir artifacts/backtest-worker run typecheck`
- `pnpm run audit:markdown-paths`

### Failure Modes

| Failure Mode | Covered By Plan? | User Impact |
| --- | --- | --- |
| Test imports the worker entrypoint and accidentally starts worker behavior. | Yes, helper extraction avoids entrypoint imports. | Prevents brittle tests and hidden runtime side effects. |
| Routing test misses non-`pyrus_signals` option modes. | Yes, Task 4A requires the non-worker fallback case. | Prevents a future UI control from claiming support on the wrong path. |
| Bar-shape test checks only TypeScript types, not normalized runtime objects. | Yes, Task 4B requires normalized/persisted shape proof. | Prevents false confidence that bid/ask are available. |
| Quote availability relies on an ad hoc live check with no repeatable evidence. | Yes, Task 4C requires a repeatable command or fixture. | Prevents shipping a plan based on a transient provider result. |

Critical silent gaps: none in the scoped `4A-4C` plan after helper extraction.

### Performance Review

No performance issues found for `4A-4C`.

The scoped work is test and decision infrastructure only. It must not add DB queries, provider calls, worker polling, or runtime fill branches. Task 4C may run a provider check, but that should be an explicit one-off decision command, not part of normal worker execution.

### Parallelization Strategy

Sequential implementation, no parallelization opportunity.

| Step | Modules touched | Depends on |
| --- | --- | --- |
| Task 4A routing helper/test | `artifacts/backtest-worker/src` | Task 3 |
| Task 4B bar-shape helper/test | `artifacts/backtest-worker/src` | Task 4A |
| Task 4C quote-data decision | `docs/plans`, optional provider fixture command | Task 4B |

Execution order: `4A -> 4B -> 4C`, then stop at the Option Fill Data Gate.

### Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P2, human: ~45m / CC: ~10m)** — backtest-worker — Extract routing helper and tests
  - Surfaced by: Architecture Review — avoid importing the side-effectful worker entrypoint.
  - Files: `artifacts/backtest-worker/src/backtest-execution.ts`, `artifacts/backtest-worker/src/backtest-execution-mode.test.ts`, `artifacts/backtest-worker/src/index.ts`
  - Verify: `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/backtest-execution-mode.test.ts`
- [ ] **T2 (P2, human: ~45m / CC: ~10m)** — backtest-worker — Extract bar-shape helper and tests
  - Surfaced by: Test Review — prove current provider option bars are quote-empty at runtime, not only in type declarations.
  - Files: `artifacts/backtest-worker/src/backtest-bars.ts`, `artifacts/backtest-worker/src/option-bar-shape.test.ts`, `artifacts/backtest-worker/src/index.ts`
  - Verify: `pnpm --dir artifacts/backtest-worker exec node --import tsx --test src/option-bar-shape.test.ts`
- [ ] **T3 (P2, human: ~30m / CC: ~5m)** — plan — Record quote-data availability decision
  - Surfaced by: Architecture Review — conservative worker fills must be blocked until quote data is proven.
  - Files: `docs/plans/awesome-quant-pyrus-improvements.md`
  - Verify: `pnpm run audit:markdown-paths`

TODO proposals: none. The scoped review tasks are immediate implementation tasks, not backlog TODOs.

Outside voice: skipped for this pass. The review scope was reduced to `4A-4C`, and no cross-model disagreement was introduced.

Completion summary:

- Step 0: Scope Challenge — scope reduced to `4A-4C` per recommendation.
- Architecture Review: 1 issue found, resolved by helper extraction.
- Code Quality Review: 0 issues found after helper extraction.
- Test Review: diagram produced, 0 unplanned gaps after the helper/tests were added to the plan.
- Performance Review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed.
- Failure modes: 0 critical silent gaps.
- Outside voice: skipped.
- Parallelization: 1 sequential lane, 0 parallel lanes.
- Lake Score: 1/1 recommendations chose the complete option.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | Not required for scoped `4A-4C` engineering gate |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | skipped | Outside voice skipped for scoped review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clear | 1 issue found and resolved, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | No UI changes in scoped `4A-4C` review |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | No developer workflow changes beyond targeted tests |

- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED for scoped `4A-4C` implementation. Later `4D-4K` still require their own review before implementation.
