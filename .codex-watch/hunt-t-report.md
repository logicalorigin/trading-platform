# HUNT-T report

1. `artifacts/pyrus/src/features/trade/TradeOrderTicket.shadowBrokerGate.test.mjs:80` | P1 | Live order submit gate is source-sliced, not exercised
Evidence: The test reads `TradeOrderTicket.jsx` as text at lines 7-10, then slices around `"const submitOrder = () => {"` and only regex-checks `gatewayTradingBlocked`/SnapTrade branch ordering at lines 80-147. The actual money-path guard is executable UI code in `TradeOrderTicket.jsx:2075` and button disabling in `TradeOrderTicket.jsx:2336`, but no test invokes the submit path or mocked mutations. Refutation checked: the earlier assertions at lines 12-77 exercise only `buildTicketReadinessModel`, not order submission.
Consequence: A regression that calls a live order mutation before the IBKR/SnapTrade guard, or leaves the guard in dead text, can keep this test green.
Laziest fix: Extract the submit/preview route decision into a pure helper or mount the component with mocked mutations and assert blocked live submits never call the mutation.
Confidence: 0.86

2. `artifacts/api-server/src/routes/account-positions-route.test.ts:26` | P1 | Account admission guard test matches text, so a leaking route can pass
Evidence: `routeSource()` reads `platform.ts` as a string at lines 5-12, and the "real account routes and streams require account admission" test only checks for `/admitAccountRoute\(res/` at lines 26-46. The real handlers need the return value to short-circuit, e.g. `if (!(await admitAccountRoute(res, req.params.accountId))) return;` in `platform.ts:1820`. Refutation checked: there is no request-level assertion here that the account service is skipped after admission denial.
Consequence: A handler could call `admitAccountRoute` but ignore its result, omit `accountId`, or continue into account reads after a denial while this test still passes.
Laziest fix: Add a request-level route test with admission forced to deny, then assert a 503 response and no account service call for each protected route.
Confidence: 0.84

3. `artifacts/api-server/src/services/signal-quality-kpis.test.ts:671` | P2 | Buy/sell KPI split test can pass with one empty side
Evidence: The test comment says the fixture elicits both bullish and bearish signals at lines 668-680, but assertions only require `byDirection` to exist, counts to sum, and metrics to be finite at lines 696-708. `aggregateObservations([])` returns finite zero metrics for empty partitions in `signal-quality-kpis.ts:667-681`, so a broken detector that emits only buys or only sells still passes. Refutation checked: no later assertion in this test requires `buy.signalCount > 0` and `sell.signalCount > 0`.
Consequence: Directional KPI regressions can silently erase one side of the signal population while the "splits KPIs into buy/sell directions" test stays green.
Laziest fix: Assert both directional counts are positive and pin at least one side-specific expected metric for the fixture.
Confidence: 0.91

4. `artifacts/api-server/src/services/signal-quality-kpis.test.ts:623` | P2 | MTF gate telemetry assertion is vacuous on the live evaluator path
Evidence: The test compares open vs gated signal counts and correctly pins `open.mtfFilteredOutCount` to 0 at lines 604-622, but the gated path assertion is only `assert.ok(gated.mtfFilteredOutCount >= 0)` at line 623. Since counts are non-negative by construction, this does not prove the enabled gate observed any failing signals. Refutation checked: the persisted-signal test at lines 629-665 covers a hand-built failing signal, but it does not exercise the live `computeSignalQualityKpis` evaluator fixture above.
Consequence: A regression that stops computing live MTF gate misses can keep the calibration telemetry test green.
Laziest fix: Make the live fixture deterministic and assert `gated.mtfFilteredOutCount > 0`, or replace it with hand-built signals where the expected gate-fail count is pinned.
Confidence: 0.88

5. `artifacts/api-server/src/services/signal-options-automation.test.ts:245` | P2 | Signal Options freshness tests assert call-shape, not fresh output
Evidence: The tests read `signal-options-automation.ts` as text at lines 234-237, then assert `listSignalOptionsAutomationState` and cockpit code contain `getSignalOptionsDashboardSnapshot` and `withFreshSignalOptionsStateSignals` at lines 245-280. The implementation can still return stale snapshot state on refresh failure at `signal-options-automation.ts:13283-13291`, and these tests never seed a stale cache plus newer monitor state to assert the returned signals/candidates. Refutation checked: nearby runtime tests cover pressure predicates and stored-state reader scoping, but not endpoint output freshness for these two paths.
Consequence: The algo control panel can regress to stale Signal Options state/candidates while these default-state/cockpit tests remain green.
Laziest fix: Add a dependency-injected or DB-backed test that seeds cached state and newer monitor states, calls the exported state/cockpit functions, and asserts the returned signals/candidates are refreshed.
Confidence: 0.78

6. `artifacts/api-server/src/services/option-chain-policy.test.ts:53` | P2 | Option-chain upstream policy is guarded by string absence, not behavior
Evidence: The policy test reads `platform.ts`, `bridge-streams.ts`, and `bridge-option-quote-stream.ts` as text at lines 5-12, then asserts Massive strings are present and IBKR strings absent at lines 53-97. The user-facing route behavior is in `platform.ts:2487-2522`, but the test never invokes the route or verifies `getOptionChainWithDebug`/`batchOptionChains` receive `bypassBridgeBackoff`, `allowDelayedSnapshotHydration`, empty retries, and the timeout. Refutation checked: source matches do catch some rename/removal cases, but they do not prove the active route passes the policy to the service call.
Consequence: Trade option-chain requests could reintroduce wrong upstream/backoff behavior with a green test if matching strings remain elsewhere or the active call path changes.
Laziest fix: Add a route or handler unit test with mocked option-chain services and assert the exact policy arguments passed for GET and batch routes.
Confidence: 0.76

Coverage note: Read-only HUNT-T pass sampled the money/trading-heavy tests under `artifacts/api-server/src/services`, `artifacts/api-server/src/routes`, `artifacts/backtest-worker/src`, `lib/backtest-core/src`, and focused frontend trading/account/algo tests under `artifacts/pyrus/src`. I searched for vacuous assertions, skipped/early-return patterns, swallowed async failures, source-regex tests, and mocks that bypass runtime paths. I intentionally did not report the known fixed stale MTF unanimity expectation or the known dashboard last-100-events P&L issue. No tests were run and no app/runtime actions were performed; the only write was this report file.
