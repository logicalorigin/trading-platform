# Live Session Handoff — Python Compute Implementation

- Session ID: `pending`
- Saved At (MT): `2026-05-30 14:58:14 MDT`
- Saved At (UTC): `2026-05-30T20:58:14Z`
- CWD: `/home/runner/workspace`
- Workstream: implement Python compute service for PYRUS math/research workloads

## User Request

Implement the plan for integrating Python into the app, grounded in the earlier pre-crash Python/math pivot.

## What Changed

- Added `python/pyrus_compute/` with a uv-managed FastAPI compute service.
- Added Python jobs: `benchmark_matrix`, `portfolio_risk`, and `greek_scenario_matrix`.
- Added Python dependencies and lockfile for FastAPI/Uvicorn/Pydantic/orjson, NumPy/SciPy/Polars/PyArrow, and pytest/ruff/mypy/httpx.
- Added root commands in `package.json` through `scripts/run-python-compute.mjs`.
- Added API-server Python supervisor in `artifacts/api-server/src/services/python-compute.ts`.
- Wired opt-in startup from `artifacts/api-server/src/index.ts` using `PYRUS_PYTHON_COMPUTE_ENABLED=1`.
- Added diagnostics collection for Python compute status.
- Added API bridge tests and included them in `artifacts/api-server/scripts/runUnitTests.mjs`.
- Updated `.gitignore` for Python virtualenv/cache outputs.
- Added `artifacts/api-server/src/services/account-greek-scenarios.ts` to convert account option positions/position-scaled greeks into Python `greek_scenario_matrix` jobs.
- Wired `getAccountRisk` to attach `greekScenarios` only when `PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED=1` and `PYRUS_PYTHON_COMPUTE_ENABLED=1`.
- Added optional `greekScenarios` to the OpenAPI `AccountRiskResponse` schema and regenerated API clients.
- Added a desktop account exposure Greek scenario strip in `PortfolioExposurePanel.jsx` that summarizes worst/best scenario PnL, worst-case label, status, and top management flags.
- Added focused Pyrus tests for Greek scenario summary visibility/sorting and panel composition.
- Added `buildGreekScenarioMatrixInputWithCoverage` and top-level `greekScenarios.coverage` diagnostics for total option positions, eligible positions, skipped positions, and missing spot/mark/contract/Greek input counts.
- Tightened Greek scenario eligibility so option positions without any usable Greek value are reported as missing a Greek snapshot instead of becoming all-zero Python scenario rows.
- Added hand-calculated Greek unit fixtures proving TS per-contract-to-position scaling and Python `greekScale: "position"` no-rescale scenario PnL math.
- Added `pnpm --filter @workspace/scripts run pyrus:greek-scenarios` as a read-only live inspector for Python runtime diagnostics, account-risk Greek scenario status, coverage, worst/best scenarios, and management flags.
- Exposed `api.pythonCompute` on `/api/diagnostics/runtime` so the live inspector can confirm Python compute health from the same runtime diagnostics endpoint.
- Updated `artifacts/api-server/src/services/bridge-option-quote-stream.ts` so `requiresGreeks` quote requests rehydrate fresh price-only cache entries, retry price-only bridge responses once, and preserve cached Greek fields when a newer price-only quote arrives.
- Updated `artifacts/api-server/src/services/shadow-account.ts` with a Greek-specific shadow quote cache and mark-derived Black-Scholes Greek estimates for shadow options whose bridge/row quote payload still lacks Greek fields.
- Added focused bridge and shadow tests covering price-only Greek rehydration, Greek cache preservation, and Greek estimate fallback behavior.
- Updated `python/pyrus_compute/src/pyrus_compute/jobs.py` and `python/pyrus_compute/src/pyrus_compute/models.py` so each option scenario is bounded by option value rules. Python inputs now carry `strike` and `right`; long/short option scenarios are bounded by intrinsic/no-arbitrage upper value instead of raw unbounded Greek Taylor output. Added Python tests for long loss, short gain, and long-put strike gain bounds.
- Updated `artifacts/api-server/src/services/account-risk-model.ts` to pass option `strike` and `right` into Python Greek scenario inputs, with a focused API assertion in `account-greek-scenarios.test.ts`.
- Updated `artifacts/pyrus/src/screens/account/PortfolioExposurePanel.jsx` to label the row as `Worst Shock` instead of `Worst Case`, because the value is the worst tested Greek shock row, not an exact maximum-loss proof.
- Added the next Python compute phase to the plan: replace the bounded Greek Taylor approximation with Black-Scholes scenario repricing in Python. Keep the current bounded Greek engine as a fallback when inputs such as IV, rate, expiry, strike, or right are missing.
- Implemented that Black-Scholes phase locally: added `python/pyrus_compute/src/pyrus_compute/black_scholes.py` with price/Greeks and implied-volatility inference; extended `greek_scenario_matrix` inputs with IV/rate/yield/pricing-model fields; and changed scenario rows to use Black-Scholes repricing whenever contract inputs are complete.
- Kept bounded Greek approximation as fallback and exposed result diagnostics: `pricingModel`, `repricedPositionScenarioCount`, `fallbackPositionScenarioCount`, `boundedPositionScenarioCount`, plus per-scenario repriced/fallback counts.
- Updated API Greek scenario inputs to pass `impliedVolatility` from IBKR option-chain/bridge/shadow quote snapshots when available. Shadow mark-derived Greek estimates now expose their inferred IV for Python.
- Updated the read-only `pyrus:greek-scenarios` inspector to print pricing-model and repriced/fallback/bounded diagnostics.
- Added the internal `portfolio_optimization` Python compute job. It accepts positions/current weights, returns or covariance input, objective, and constraints; returns advisory-only proposed weights, risk contribution, turnover, concentration, warnings, variance, and volatility. It does not emit trade instructions or connect to broker/order paths.
- The first implementation is deterministic and dependency-free: native NumPy covariance/diagonal fallback, inverse-variance min-variance weights, risk-parity inverse-vol weights, positive-return max-return fallback, long-only clamping, max-weight cap handling, and optional turnover limiting.
- Updated Python compute capabilities and the API-server `PythonComputeJobType` union to include `portfolio_optimization`.
- Added `scripts/src/pyrus-portfolio-optimization.ts` and `pnpm --filter @workspace/scripts run pyrus:portfolio-optimization` as a read-only live inspector. It discovers Python compute from `/api/diagnostics/runtime` by default, confirms `portfolio_optimization` capability, and submits only a deterministic sample advisory job. The default timeout is 30s because runtime diagnostics can exceed 10s under current app load.

## Validation

- `pnpm run python-compute:doctor` passed.
- `pnpm run python-compute:benchmark` passed.
- `pnpm run python-compute:test` passed: 8 tests.
- `pnpm run python-compute:lint` passed.
- `pnpm run python-compute:typecheck` passed.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/python-compute.test.ts` passed.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-greek-scenarios.test.ts src/services/python-compute.test.ts` passed: 11 tests.
- `pnpm --dir artifacts/api-server run typecheck` passed.
- `pnpm --dir artifacts/api-server run build` passed.
- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/PortfolioExposurePanel.test.js` passed: 11 tests.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- `pnpm --filter @workspace/api-client-react run typecheck` passed.
- `pnpm run audit:api-codegen` passed after regenerating API clients.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-greek-scenarios.test.ts` passed: 6 tests.
- `pnpm --dir artifacts/api-server run typecheck` passed after coverage diagnostics.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-greek-scenarios.test.ts` passed after unit fixtures: 7 tests.
- `pnpm run python-compute:test` passed after unit fixtures: 9 tests.
- `pnpm run python-compute:lint` passed.
- `pnpm run python-compute:typecheck` passed.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/runtime-diagnostics.test.ts` passed after exposing runtime Python diagnostics: 12 tests.
- `pnpm --filter @workspace/scripts run typecheck` passed.
- `pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- --help` passed.
- Live service smoke passed on `127.0.0.1:18769/health`.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/shadow-account.test.ts src/services/account-greek-scenarios.test.ts src/services/python-compute.test.ts` passed after bridge-backed shadow Greek hydration: 119 tests.
- `pnpm run python-compute:test` passed after bridge-backed shadow Greek hydration: 10 tests.
- `pnpm run python-compute:lint` passed.
- `pnpm run python-compute:typecheck` passed.
- `pnpm --dir artifacts/api-server run typecheck` passed after bridge-backed shadow Greek hydration.
- `pnpm --dir artifacts/api-server run build` passed and rebuilt `artifacts/api-server/dist/index.mjs`.
- Source-level `getShadowAccountRisk()` validation with `PYRUS_PYTHON_COMPUTE_PORT=18771` passed: 5/5 shadow option positions matched to Greek snapshots, 0 skipped positions, 140 scenarios, worst estimated PnL `-11094.032017`, best estimated PnL `22963.455423`.
- Pre-restart live inspector still shows old running process state: 1/5 eligible, 4 missing Greek snapshots, Python pid `12685`.
- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/PortfolioExposurePanel.test.js` passed after bridge-backed shadow Greek hydration: 11 tests.
- Targeted `git diff --check` passed for the shadow-risk and handoff files touched in this step.
- After user restart, `pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- --account-id shadow --mode paper --json` reached the new app/Python process on 2026-05-30T18:50:49Z (`pid=18612`) but still reported 1/5 eligible, 4 missing Greek snapshots, and 140 scenarios, exposing the bridge price-only/no-Greek snapshot issue.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/bridge-option-quote-stream.test.ts --test-name-pattern 'Greeks|price-only'` passed after the bridge cache fix: 24 tests.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/shadow-account.test.ts --test-name-pattern 'shadow risk exposes|greek estimates'` passed after the shadow Greek fallback fix: 107 tests.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/bridge-option-quote-stream.test.ts src/services/shadow-account.test.ts src/services/account-greek-scenarios.test.ts src/services/python-compute.test.ts` passed after the final patch: 144 tests.
- `pnpm --dir artifacts/api-server run typecheck` passed after the final patch.
- `pnpm run python-compute:test` passed after the final patch: 10 tests.
- `pnpm run python-compute:lint` passed.
- `pnpm run python-compute:typecheck` passed.
- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/PortfolioExposurePanel.test.js` passed after the final patch: 11 tests.
- Source-level `getShadowAccountRisk()` validation with `PYRUS_PYTHON_COMPUTE_PORT=18774` passed after the final patch: 5/5 shadow option positions matched to Greek snapshots, 0 missing Greek snapshots, 140 scenarios, worst estimated PnL `-5413.278923`, best estimated PnL `23363.118702`.
- `pnpm --dir artifacts/api-server run build` passed after the final patch and rebuilt `artifacts/api-server/dist/index.mjs`.
- `git diff --check -- artifacts/api-server/src/services/bridge-option-quote-stream.ts artifacts/api-server/src/services/bridge-option-quote-stream.test.ts artifacts/api-server/src/services/shadow-account.ts artifacts/api-server/src/services/shadow-account.test.ts SESSION_HANDOFF_CURRENT.md SESSION_HANDOFF_LIVE_2026-05-29_python-compute-implementation.md` passed.
- After the user restarted the default Replit Run App, `pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- --account-id shadow --mode paper --json` passed on 2026-05-30T19:38:41Z: Python compute `healthy`, pid `22383`, `greekScenarios.status=completed`, `eligiblePositions=5`, `missingGreekSnapshot=0`, `scenarioCount=140`, worst estimated PnL `-13460.992495`, best estimated PnL `25330.415901`.
- Source-level shadow risk validation after the premium/value-bound patch reported `premiumExposure=10217.50`, `eligiblePositions=5`, `missingGreekSnapshot=0`, `scenarioCount=140`, worst estimated PnL `-8795.423418`, best estimated PnL `26715.336013`, and `boundedPositionScenarioCount=170`.
- `pnpm run python-compute:test` passed after the premium/value-bound patch: 13 tests.
- `pnpm run python-compute:lint` passed.
- `pnpm run python-compute:typecheck` passed.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-greek-scenarios.test.ts src/services/python-compute.test.ts` passed after the premium-bound patch: 13 tests.
- `pnpm --dir artifacts/api-server run typecheck` passed after adding `strike`/`right` to the scenario input contract.
- `pnpm --dir artifacts/api-server run build` passed after adding `strike`/`right` and rebuilt `artifacts/api-server/dist/index.mjs`.
- `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/PortfolioExposurePanel.test.js` passed after the `Worst Shock` UI label update: 11 tests.
- `git diff --check -- python/pyrus_compute/src/pyrus_compute/jobs.py python/pyrus_compute/src/pyrus_compute/models.py python/pyrus_compute/tests/test_jobs.py artifacts/api-server/src/services/account-risk-model.ts artifacts/api-server/src/services/account-greek-scenarios.test.ts SESSION_HANDOFF_LIVE_2026-05-29_python-compute-implementation.md SESSION_HANDOFF_MASTER.md` passed.
- After the user restarted Replit, `pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- --account-id shadow --mode paper --json` passed on 2026-05-30T19:57:06Z: Python compute `healthy`, pid `28763`, `eligiblePositions=5`, `missingGreekSnapshot=0`, `scenarioCount=140`, worst estimated PnL `-8795.995295`, best estimated PnL `26715.07156`.
- Raw live `/api/accounts/shadow/risk?mode=paper` confirmed `premiumExposure=10217.5`, `boundedPositionScenarioCount=170`, worst `boundedPositionCount=2`, and all 5 positions carry `strike`/`right`.
- `pnpm run python-compute:test` passed after Black-Scholes repricing: 16 tests.
- `pnpm run python-compute:lint` passed after Black-Scholes repricing.
- `pnpm run python-compute:typecheck` passed after Black-Scholes repricing.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-greek-scenarios.test.ts src/services/shadow-account.test.ts src/services/python-compute.test.ts` passed after IV wiring: 120 tests.
- `pnpm --dir artifacts/api-server run typecheck` passed after IV wiring.
- `pnpm --dir artifacts/api-server run build` passed after IV wiring and rebuilt `artifacts/api-server/dist/index.mjs`.
- `pnpm --filter @workspace/scripts run typecheck` passed after inspector diagnostics.
- `git diff --check -- python/pyrus_compute/src/pyrus_compute/black_scholes.py python/pyrus_compute/src/pyrus_compute/jobs.py python/pyrus_compute/src/pyrus_compute/models.py python/pyrus_compute/tests/test_jobs.py artifacts/api-server/src/services/account-risk-model.ts artifacts/api-server/src/services/account.ts artifacts/api-server/src/services/shadow-account.ts artifacts/api-server/src/services/account-greek-scenarios.test.ts scripts/src/pyrus-greek-scenarios.ts SESSION_HANDOFF_LIVE_2026-05-29_python-compute-implementation.md SESSION_HANDOFF_MASTER.md` passed.
- Pre-restart live inspector on 2026-05-30T20:16:24Z still reached the older running Python/API process: `scenarioCount=140`, worst estimated PnL `-9958.641452`, and worst components still showed Greek Taylor keys (`delta`, `gamma`, `theta`, `vega`). Restart the default Replit Run App before expecting live `pricingModel=black_scholes`/`repricing` diagnostics.
- After the user restarted the default Replit Run App, `pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- --account-id shadow --mode paper --json` passed on 2026-05-30T20:40:05Z: Python compute `healthy`, pid `37334`, `eligiblePositions=5`, `scenarioCount=140`, `pricingModel=black_scholes`, `repricedPositionScenarioCount=700`, `fallbackPositionScenarioCount=0`, `boundedPositionScenarioCount=0`, worst estimated PnL `-10216.662615`, best estimated PnL `20417.544889`.
- Raw live `/api/accounts/shadow/risk?mode=paper` confirmed `premiumExposure=10217.5`, all five positions have `pricingModel=black_scholes`, all five use input IV, and worst repriced shock `-10216.669408` remains just inside the shadow option premium/value envelope.
- `pnpm run python-compute:test` passed after adding `portfolio_optimization`: 20 tests.
- `pnpm run python-compute:lint` passed after adding `portfolio_optimization`.
- `pnpm run python-compute:typecheck` passed after adding `portfolio_optimization`.
- `pnpm run python-compute:doctor` passed after adding `portfolio_optimization`.
- `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/python-compute.test.ts` passed after adding the TS job type: 6 tests.
- `pnpm --dir artifacts/api-server run typecheck` passed after adding the TS job type.
- `git diff --check -- python/pyrus_compute/src/pyrus_compute/app.py python/pyrus_compute/src/pyrus_compute/jobs.py python/pyrus_compute/src/pyrus_compute/models.py python/pyrus_compute/tests/test_app.py python/pyrus_compute/tests/test_jobs.py artifacts/api-server/src/services/python-compute.ts artifacts/api-server/src/services/python-compute.test.ts SESSION_HANDOFF_LIVE_2026-05-29_python-compute-implementation.md` passed.
- After the user restarted the default Replit Run App, live Python compute validation passed on 2026-05-30T20:57:xxZ: Python compute `healthy`, pid `46715`, capabilities include `portfolio_optimization`, and a direct internal `portfolio_optimization` sample job completed with `advisoryOnly=true`, `objective=min_variance`, no warnings, and no error.
- Post-restart shadow Greek inspector also passed on 2026-05-30T20:58:08Z: Python compute pid `46715`, `pricingModel=black_scholes`, `repricedPositionScenarioCount=700`, `fallbackPositionScenarioCount=0`, `boundedPositionScenarioCount=0`, 5/5 eligible positions, worst estimated PnL `-10216.96508`.
- Final commit validation on 2026-05-30: Python compute doctor/test/lint/typecheck, focused API Python/Greek/shadow/quote/runtime tests, API-server typecheck/build, scripts typecheck, API-client typecheck, account exposure panel test, and staged diff check passed. `pnpm --filter @workspace/pyrus run typecheck` is blocked by unrelated unstaged charting errors in `ResearchChartSurface.tsx` and `chartPositionOverlays.ts`.
- `pnpm --filter @workspace/scripts run test:pyrus-portfolio-optimization` passed on 2026-05-30T21:43:xxZ: 5 tests.
- `pnpm --filter @workspace/scripts run typecheck` passed after adding the portfolio optimization inspector.
- `pnpm --filter @workspace/scripts run pyrus:portfolio-optimization -- --help` passed.
- Live portfolio optimization inspector passed on 2026-05-30T21:48:18Z against `http://127.0.0.1:18747/api`: Python compute `healthy`, pid `601`, runtime diagnostics latency `13957ms`, capabilities include `portfolio_optimization`, sample job completed in `1.361ms` with `advisoryOnly=true`, `objective=min_variance`, no warnings, and no error.
- `git diff --check -- scripts/src/pyrus-portfolio-optimization.ts scripts/src/pyrus-portfolio-optimization.test.ts scripts/package.json SESSION_HANDOFF_LIVE_2026-05-29_python-compute-implementation.md SESSION_HANDOFF_MASTER.md` passed after handoff updates.
- Task 8A library spike completed on 2026-05-30T22:19:42Z. `docs/spikes/portfolio-risk-library-spike-2026-05-30.md` records source checks, isolated install/runtime measurements, sample outputs, and the decision to admit no external optimizer dependency this wave.
- Post-spike validation passed: `pnpm run python-compute:doctor`, `pnpm run python-compute:test` (20 tests), `pnpm run python-compute:lint`, `pnpm run python-compute:typecheck`, `pnpm run audit:markdown-paths`, and targeted `git diff --check`.
- `pnpm --dir artifacts/pyrus exec node --import tsx --test src/screens/account/accountSafeQaFixtures.test.js src/screens/account/PortfolioExposurePanel.test.js` passed after adding the safe-QA Portfolio Exposure fixture: 16 tests.
- `pnpm --dir artifacts/pyrus run typecheck` passed after fixture wiring.
- `pnpm --dir artifacts/pyrus exec node --import tsx --test --test-name-pattern "safe QA mode disables platform live and diagnostics side effects" src/features/platform/platformRootSource.test.js` passed. A prior incorrectly ordered pattern run executed the full source file and hit the known unrelated pre-existing failures in that file; the safe-QA guard itself passed.
- `git diff --check -- artifacts/pyrus/src/screens/AccountScreen.jsx artifacts/pyrus/src/screens/account/accountSafeQaFixtures.js artifacts/pyrus/src/screens/account/accountSafeQaFixtures.test.js SESSION_HANDOFF_CURRENT.md SESSION_HANDOFF_LIVE_2026-05-29_python-compute-implementation.md` passed.
- `pnpm run replit:config:lock` passed; startup config remains locked.

## Current Status

- Python compute service is implemented as opt-in internal infrastructure.
- Existing TS/Rust ownership remains unchanged.
- Portfolio risk Python job remains internal.
- Greek scenario Python job is surfaced as advisory account-risk output behind feature flags only.
- Account-risk Greek scenarios now expose why option positions were or were not eligible before invoking Python.
- Hand-calculated fixtures now prove that 2 contracts x 100 multiplier with 0.50/0.02/-0.10/0.20 per-contract greeks become 100/4/-20/40 position greeks and produce expected Python scenario components.
- The current running Replit app at `http://127.0.0.1:18747/api` now reports `pythonCompute.enabled=true`, Python status `healthy`, and `greekScenarios.enabled=true`.
- Pyrus now renders the advisory Greek scenario summary on the desktop account exposure panel when account risk includes enabled `greekScenarios`.
- Worktree contains many unrelated pre-existing dirty files; Python compute changes are isolated to the new package, root scripts, API supervisor/test wiring, `.gitignore`, and `package.json`.
- API codegen also preserved pre-existing dirty OpenAPI/client changes around option quote snapshot request intent/owner fields and signal-options execution profile response; those are not part of the Python compute scope.
- Resumed on 2026-05-30 from this handoff with broader Rust/Python context from `SESSION_HANDOFF_2026-05-29_019e742a-a3f1-71b3-8374-b51029016cbf.md`.
- Replit startup config remains locked/read-only.
- Current running Replit app has Python/Greek feature flags enabled; live inspector reaches account risk and confirms Python compute is healthy.
- Revalidated on 2026-05-30: Python compute doctor/test/lint/typecheck/benchmark, API Greek scenario/Python/runtime tests, API-server typecheck, Pyrus typecheck, API client typecheck, scripts typecheck, and account exposure panel tests all passed.
- Studied `ib-api-reloaded/ib_async` on 2026-05-30 as a possible improvement path. It is useful for a future Python IBKR TWS/Gateway bridge because it owns socket connectivity, synchronized account/position/order state, market data subscriptions, option chains, and IB model greeks. It should not be added to `python/pyrus_compute`; keep that service broker-free and feed it normalized greeks/positions from the API/bridge layer.
- Re-ran the read-only live inspector on 2026-05-30T18:14:25Z. It reached `http://127.0.0.1:18747/api` for account `U24762790`, but exited 2 because the running Replit app still has `pythonCompute.enabled=false`/status `disabled` and `greekScenarios.enabled=false`/status `disabled`.
- User restarted the Replit app, then the inspector was re-run on 2026-05-30T18:16:01Z. The app was reachable with fresh low latency, but still reported `pythonCompute.enabled=false` and `greekScenarios.enabled=false`. Filtered process-env inspection of the Replit-owned runner/API process showed `PYRUS_REPLIT_RUN=1` and `REPLIT_MODE=workflow`, but neither `PYRUS_PYTHON_COMPUTE_ENABLED` nor `PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED`; the flags need to be added to the Replit app environment/secrets before restarting again.
- After the flags were added and the app was restarted again, the read-only inspector passed on 2026-05-30T18:17:55Z with `pythonCompute.enabled=true`, Python status `healthy`, pid `7694`, and `greekScenarios.enabled=true`. Greek scenarios currently return status `empty` because account `U24762790` has `totalOptionPositions=0`. The paper-mode inspector also passed on 2026-05-30T18:18:08Z with the same empty option-position coverage.
- User noted the shadow account has option positions. Confirmed `/api/accounts/shadow/positions` has 5 option positions, while `/api/accounts/shadow/risk` had no `greekScenarios` field and existing shadow Greek coverage reported `optionPositions=5`, `matchedOptionPositions=0`.
- Added shadow-risk wiring to `resolveAccountGreekScenarios` in `artifacts/api-server/src/services/shadow-account.ts`. It builds `BrokerPositionSnapshot` inputs from shadow positions, extracts/scales any greeks from shadow `optionQuote` payloads, and includes advisory `greekScenarios` in the shadow risk response. With current shadow data this should expose coverage but still report missing Greek snapshots unless option quote greeks are populated.
- After the user restarted Replit again, `pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- --account-id shadow --mode paper --json` passed on 2026-05-30T18:25:20Z. Python compute was healthy with pid `10018`; shadow Greek scenarios completed with `totalOptionPositions=5`, `eligiblePositions=5`, `skippedPositions=0`, `scenarioCount=45`, worst estimated PnL `-2412.631996`, best estimated PnL `7748.184005`, and one MSFT management flag.
- Follow-up tuning found a correctness issue in the first shadow sample: shadow `null` Greek values were being coerced to `0`, which made four positions look eligible even though they had no Greek snapshot. Fixed `artifacts/api-server/src/services/shadow-account.ts` to preserve missing shadow greeks as `null`, widened the default stress grid to 7 spot shocks x 5 IV shocks x 4 day offsets in `artifacts/api-server/src/services/account-risk-model.ts` and `python/pyrus_compute/src/pyrus_compute/models.py`, and added Python management-flag severity scoring/sorting in `python/pyrus_compute/src/pyrus_compute/jobs.py`.
- Source-level validation after the correction reports the honest shadow baseline: 5 total option positions, 1 eligible position, 4 skipped for missing Greek snapshots, and 140 scenarios. This needs one more Replit Run App restart before the live inspector reflects the rebuilt API bundle and restarted Python compute process.
- After the user restarted Replit, `pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- --account-id shadow --mode paper --json` passed on 2026-05-30T18:33:08Z with Python pid `12685`, `greekScenarios.status=completed`, `totalOptionPositions=5`, `eligiblePositions=1`, `missingGreekSnapshot=4`, `scenarioCount=140`, worst estimated PnL `-2641.717884`, best estimated PnL `15519.658749`. Raw shadow risk confirmed MSFT management flag severity scoring (`severityScore=19.950829`).
- Implemented on 2026-05-30T18:45:14Z: `artifacts/api-server/src/services/shadow-account.ts` now requests Greek-capable bridge option quotes for shadow risk with `requiresGreeks: true` and owner prefix `shadow-risk-greek`, then prefers those IBKR/bridge Greek quotes over row quotes when building shadow Greek snapshots.
- After the user restarted, the live inspector loaded the rebuilt API/Python process but still showed `eligiblePositions=1` and `missingGreekSnapshot=4`. Root cause: the bridge can return fresh price-only quote snapshots, and the prior shared cache treated them as good enough for `requiresGreeks` and could overwrite cached Greek fields.
- Implemented on 2026-05-30T19:07:36Z: bridge quote cache semantics now respect `requiresGreeks`, price-only bridge results are retried, cached Greek fields are preserved across price-only updates, shadow risk keeps a Greek-specific quote cache, and any remaining missing shadow option Greeks are filled from mark-derived Black-Scholes estimates.
- Source-level validation now confirms 5/5 shadow option positions matched to Greek snapshots, 0 missing Greek snapshots, 140 scenarios, no Greek warning, worst estimated PnL `-5413.278923`, and best estimated PnL `23363.118702`.
- After the user restarted the default Replit Run App, the live inspector confirmed the rebuilt app now resolves all 5 shadow option positions into Greek scenario inputs with 0 missing Greek snapshots and 140 scenarios.
- User flagged that live worst scenario PnL `-13460.992495` exceeds the roughly `10217.50` shadow option market value. Audit confirmed this is not mixing real and shadow accounts; the Python Greek scenario engine was using an unbounded Taylor estimate, so long-option scenarios could incorrectly lose more than premium.
- Implemented option-value-bounded scenario PnL in Python compute. Source-level and live shadow validation now report worst estimated PnL below the `10217.50` shadow option premium exposure. The live post-restart inspector reports worst estimated PnL `-8795.995295`.
- Implemented and live-validated Black-Scholes scenario repricing. The current Replit app reports all shadow scenario rows as Black-Scholes repriced with no fallback rows.
- User explicitly declined new pricing diagnostics in the UI. The next Python-plan slice is now implemented and live-validated as internal compute only: `portfolio_optimization` for advisory weights/risk contribution with no UI and no broker/order path.
- Added and live-validated the read-only portfolio optimization inspector. It does not read broker state, write account state, create orders, or expose UI/API surfaces.
- Completed Task 8A portfolio risk library spike. Immediate decision: reject adding `skfolio`, `Riskfolio-Lib`, `PyPortfolioOpt`, or `empyrical-reloaded` as a Python compute dependency now. Keep the native advisory optimizer; use `skfolio` as the preferred future candidate only if advanced solver-backed optimization is explicitly needed.
- Added the next options-native account-risk advisory slice: `riskRecommendations` is now built from option premium exposure, Greek coverage, Greek scenario worst shock, management flags, expiry buckets, and underlying premium concentration. It is explicitly read-only (`advisoryOnly=true`) and contains no order actions, sides, quantities, limit prices, or trade-ticket wiring.
- Surfaced the advisory payload in the desktop Portfolio Exposure panel as `Option Risk Reviews`, next to Greek scenarios. It stays scoped to options risk language: premium, worst shock, theta, gamma, vega, expiry, coverage, and concentration. Updated `docs/plans/awesome-quant-pyrus-improvements.md` so Task 10 is now explicitly options-risk recommendations rather than generic allocation/rebalance suggestions.
- Live API validation after the user restarted Replit confirmed `/api/accounts/shadow/risk?mode=paper` returns completed Greek scenarios plus `riskRecommendations.status=ready`, 5 option positions, 5 underlyings, premium exposure `10217.5`, worst shock PnL `-10217.5`, and review-only recommendations.
- Browser QA with `?pyrusQa=safe` verified the desktop Account / Portfolio Exposure `Option Risk Reviews` strip renders without trade-action language. During QA, patched safe-mode gaps so the platform shell no longer fires live positions/orders, market quote/bars, latest diagnostics, or client-metrics writes while safe QA is active.
- Resumed on 2026-05-31 at 09:38:29 MDT. Current task is the next recorded slice: add a deterministic safe-QA Portfolio Exposure fixture so completed Greek shock and option-risk review rows render without live account queries or a warmed React Query cache.
- Safe-QA Portfolio Exposure now has deterministic fixture data for completed Greek scenario shock details and option-risk reviews, independent of live account requests and prior React Query cache state.
- Added `artifacts/pyrus/src/screens/account/accountSafeQaFixtures.js` with deterministic safe-QA summary, allocation, positions, completed Black-Scholes Greek scenarios, and options-scoped review-only `riskRecommendations`.
- Added `artifacts/pyrus/src/screens/account/accountSafeQaFixtures.test.js` to prove the fixture includes completed shock/review content, remains review-only, seeds React Query with requests disabled, and is wired from `AccountScreen.jsx`.
- Wired `AccountScreen.jsx` to pass safe-QA fixture data as `initialData` for account summary, allocation, positions, and risk queries only when `safeQaMode` is active.

## ib_async Recommendation

- Use `ib_async` as an implementation detail behind the existing IBKR bridge HTTP contract, not as a replacement for the API-server contract, line planner, runtime diagnostics, or Python compute service.
- First spike should be read-only against paper TWS/Gateway: `/health`, `/accounts`, `/positions`, `/options/chains`, `/options/quotes`, `/streams/options/quotes`, and `/bars`, mapped to the existing `IbkrBridgeClient` expectations.
- Prioritize Greek scenario inputs before trading: account option positions, qualified option contracts/conIds, underlying spot/mark, and `Ticker` option greeks (`bidGreeks`, `askGreeks`, `lastGreeks`, `modelGreeks`).
- Keep line-budget/admission controls in the TypeScript API-server. `ib_async` simplifies IBKR protocol/event handling but does not remove IBKR pacing, market-data-line limits, or subscription entitlement constraints.
- Defer order placement until the read-only bridge is stable and has parity diagnostics versus the current bridge.

## Next Step

If continuing this work, decide whether the native `portfolio_optimization` job should feed a future options-risk advisory wrapper, or remain internal. Do not expose generic allocation/rebalance recommendations; this platform surface should stay grounded in options trading risk.

## Planned Black-Scholes Upgrade

Goal: move Greek scenarios from a first-order/second-order approximation to scenario repricing. Python should own this math because it already owns the compute service and has SciPy/NumPy available.

Implementation slices:

1. Add a Python Black-Scholes utility module.
   - Inputs: spot, strike, days to expiration, risk-free rate, dividend yield, implied volatility, option right.
   - Outputs: theoretical option price plus delta/gamma/theta/vega for call/put.
   - Tests: known textbook fixtures and put/call parity sanity checks.

2. Extend the `greek_scenario_matrix` input contract.
   - Include `strike`, `right`, `impliedVolatility`, `daysToExpiration`, optional `riskFreeRate`, optional `dividendYield`, and `pricingModel`.
   - Keep `greekScale: "position"` for fallback Greek-based calculations.
   - API-server should pass available contract and quote fields without making TypeScript own the pricing math.

3. Reprice each scenario in Python when inputs are complete.
   - For each option, compute current theoretical price and shocked theoretical price.
   - Scenario PnL = `(shockedPrice - currentPrice) * quantity * multiplier`.
   - Fall back to the current bounded Greek approximation when repricing inputs are incomplete.

4. Expose diagnostics.
   - Add result metadata such as `pricingModel: "black_scholes"` or `"bounded_greek_approximation"`.
   - Add counts for repriced positions versus fallback positions.
   - Surface fallback warnings through the existing `pythonJob.warnings` path.

5. Validate live.
   - Python unit tests for Black-Scholes pricing/Greeks.
   - API tests confirming scenario inputs include IV/expiry/strike/right.
   - Shadow inspector should show 5/5 coverage and a bounded, repriced worst shock.
   - UI should still call the row `Worst Shock`, not `Worst Case`.

## Current Implementation Plan

1. Completed: inspect the account risk/exposure surface and generated `AccountRiskResponse` typing.
2. Completed: add optional `greekScenarios` schema/type field without disturbing existing account-risk consumers.
3. Completed: render a compact advisory panel for management flags and worst/best scenario rows when `risk.greekScenarios` exists and is enabled.
4. Completed: add focused frontend tests for hidden/visible Greek scenario states.
5. Completed: run targeted Pyrus frontend tests plus typecheck/codegen checks needed for the touched surface.
6. Completed: add Greek scenario input coverage diagnostics and targeted API tests.
7. Completed: add hand-calculated unit fixtures proving position-scaled Greek PnL semantics before scenario-grid or management-flag tuning.
8. Completed: add a read-only live inspector and expose Python runtime health in `/api/diagnostics/runtime`.
9. Completed: live-enable Python/Greek scenario flags through Replit Run App and inspect runtime/account-risk payloads.
10. Completed: wire shadow account risk to the optional Python Greek scenario coverage path.
11. Completed: restart the Replit app and validate `--account-id shadow --mode paper` with non-empty eligible Greek coverage.
12. Completed: tune scenario grid/management thresholds and fix shadow null-greek coverage.
13. Completed: restart Replit app and re-run the shadow inspector with corrected 1/5 eligible coverage and 140 scenarios.
14. Completed locally: improve shadow Greek snapshot coverage by hydrating option greeks from the bridge/IBKR path, preserving Greek-bearing quote cache entries, and estimating any remaining missing shadow option greeks from mark/underlying/contract data.
15. Completed: restart Replit Run App and verify live shadow Greek snapshot coverage improves from 1/5 to 5/5.
16. Completed locally: pass option `strike`/`right` into Python and bound Greek scenario PnL by option value rules so displayed stress PnL stays inside basic payoff constraints.
17. Completed: restart Replit Run App and re-run the shadow inspector to confirm live worst scenario PnL no longer exceeds the shadow option value.
18. Completed: verify the shadow account UI path displays the Greek scenario summary cleanly with the `Worst Shock` label.
19. Completed locally: implement Black-Scholes scenario repricing in Python compute, with the bounded Greek approximation retained as fallback.
20. Completed: restart Replit Run App and re-run the shadow inspector to confirm live `pricingModel` and repriced/fallback diagnostics.
21. Completed by user decision: keep pricing-model diagnostics out of the UI and leave them inspector/API-only.
22. Completed and live-validated: add an internal advisory `portfolio_optimization` Python job with deterministic weights, risk contribution, turnover, warnings, and no trade instructions.
23. Completed and live-validated: add a read-only `pyrus:portfolio-optimization` inspector that discovers Python compute, checks capabilities, and runs a deterministic advisory sample job.
24. Completed: Task 8A portfolio risk library spike. Compared `skfolio`, `Riskfolio-Lib`, `PyPortfolioOpt`, and `empyrical-reloaded`; recorded decision in `docs/spikes/portfolio-risk-library-spike-2026-05-30.md`; no external optimizer dependency admitted for this wave. Keep native advisory `portfolio_optimization`; prefer `skfolio` only for a future advanced optimizer spike.
25. Completed locally: added options-native `riskRecommendations` to live and shadow account risk payloads, with a pure builder/test suite that consumes option premium, Greek coverage, scenario shock PnL, management flags, expiry, and concentration. The builder stays advisory-only and does not emit trade-ticket fields.
26. Completed locally: rendered `Option Risk Reviews` in the desktop Portfolio Exposure panel and added frontend summary/source tests.
27. Validation passed: `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/account-risk-recommendations.test.ts src/services/account-greek-scenarios.test.ts`; `pnpm --dir artifacts/pyrus exec node --import tsx --test src/screens/account/PortfolioExposurePanel.test.js`; `pnpm --dir artifacts/api-server run typecheck`; `pnpm --dir artifacts/pyrus run typecheck`; `pnpm --filter @workspace/api-spec run codegen`; `pnpm run audit:api-codegen`; `pnpm run audit:markdown-paths`; targeted `git diff --check`; `pnpm run replit:config:lock`.
28. Completed: live-dogfooded `/api/accounts/shadow/risk?mode=paper` after restart; confirmed option-risk advisory payload is present, ready, options-scoped, and read-only.
29. Completed: browser-dogfooded the Account / Portfolio Exposure panel with `?pyrusQa=safe`; confirmed `Option Risk Reviews` renders. Also fixed safe-QA shell/runtime gaps that caused 429 console noise from live positions/orders, market quote/bars, latest diagnostics, and client-metrics writes.
30. Validation passed: focused safe-QA source test, `useMemoryPressureSignal.test.js`, `PortfolioExposurePanel.test.js`, Pyrus typecheck, and targeted `git diff --check`. Full `platformRootSource.test.js` still has unrelated pre-existing failures outside the safe-QA test pattern.
31. Completed: added a dedicated safe fixture for Portfolio Exposure so `?pyrusQa=safe` can show completed Greek scenario shock details without relying on live account queries or prior React Query cache.
32. Completed: browser-dogfooded Account / Portfolio Exposure with `?pyrusQa=safe`; confirmed the deterministic safe-QA fixture renders completed Greek scenario shocks and `Option Risk Reviews`.
33. Completed: fixed safe-QA side-effect leaks found during browser validation: gated Account section prefetches behind `accountQueriesEnabled`, disabled safe-QA account list boot queries, passed `safeQaMode` into the IBKR header diagnostics gate, and tied position quote streams/registrations to live quote enablement.
34. Validation passed: `pnpm run python-compute:test`; `pnpm --dir artifacts/pyrus exec node --import tsx --test src/screens/account/accountSafeQaFixtures.test.js src/screens/account/PortfolioExposurePanel.test.js`; targeted safe-QA/platform source tests by `--test-name-pattern`; Playwright smoke at `http://127.0.0.1:18747/?pyrusQa=safe` with no account, market-data, diagnostics, quote, bars, or position-stream API side effects. Full `platformRootSource.test.js` still has unrelated pre-existing failures in this dirty worktree outside the safe-QA pattern.
35. Next: decide whether the native `portfolio_optimization` job should feed a future options-risk advisory wrapper, or remain internal. Keep any user-facing surface options-risk-specific rather than generic allocation/rebalance guidance.
