# Session Handoff — 2026-06-01

## Session Metadata

- Session ID: `019e84aa-c1d5-79e1-adba-5a743d03c8cc`
- Saved At (MT): `2026-06-01 17:12:29 MDT`
- Saved At (UTC): `2026-06-01T23:12:34Z`
- Summary: 2026-06-01 17:12:29 MDT | 019e84aa-c1d5-79e1-adba-5a743d03c8cc | STA audit plus Algo page upper-area UI cleanup; browser QA completed in pickup session `019e856e...`.
- Repo Root: `/home/runner/workspace`
- Thread CWD: `/home/runner/workspace`
- Rollout Path: `/home/runner/.codex/sessions/2026/06/01/rollout-2026-06-01T13-30-43-019e84aa-c1d5-79e1-adba-5a743d03c8cc.jsonl`
- Branch: `main`
- HEAD: `5bfe96e71a6028cfd1f7994cc80debefffe60711`
- Latest Commit: `fix: harden shadow signal-options monitoring`
- Latest Commit Session ID: `unknown`
- Title: D. IBKR Gateway Launch / Line Diagnostics continuation
- Model: `gpt-5.5`
- Reasoning Effort: `xhigh`
- Tokens Used: `7685231`

## Latest Audit Update

- User challenged the prior "what contract would have selected" answer; audit confirmed the challenge was correct.
- Root cause: `candidateFromEvent` allowed candidate rows to fall back to `position.selectedContract`, so a skipped/current candidate could display an existing open position contract as though the current candidate selected it.
- Live example: HOOD current candidate is `sell`/`put` with no candidate selected contract, but the read model displayed the existing `HOOD20260605C90` call position.
- Fix: candidate rows now only use `payload.selectedContract` or `candidate.selectedContract`; `position.selectedContract` is only used for position-only events with no candidate payload.
- Regression tests added:
  - skipped candidates do not inherit existing position contracts.
  - position-only mark events can still carry their position contract.
- Replay audit against current option-chain data:
  - HOOD `sell`/`put`: candidate target would be `HOOD20260605P92`, but not trade-ready due missing/delayed bid/ask.
  - GLW `buy`/`call`: candidate target would be `GLW20260605C1725`, but not trade-ready due missing/delayed bid/ask.
  - RTX `buy`/`call`: candidate target would be `RTX20260605C1725`, but not trade-ready due missing/delayed bid/ask.
  - SMCI `buy`/`call`: new-entry replay target would be `SMCI20260605C475`, but current row is blocked by `same_direction_position_open`; not trade-ready.
  - APH `sell`/`put`: no selected contract in replay; current row is blocked by `mtf_not_aligned`.
  - ROK was not present in latest state output; earlier evidence showed no DTE-window selection.
- Validation passed:
  - `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts`
  - `pnpm --dir artifacts/api-server run typecheck`
  - `pnpm --dir artifacts/api-server run build`
  - `git diff --check -- artifacts/api-server/src/services/signal-options-automation.ts artifacts/api-server/src/services/signal-options-automation.test.ts SESSION_HANDOFF_2026-06-01_019e84aa-c1d5-79e1-adba-5a743d03c8cc.md SESSION_HANDOFF_MASTER.md`
- Restart needed: live Replit API process still needs to reload this patch before HOOD/SMCI stop showing existing position contracts in current candidate rows.

## MTF / Bid-Ask Audit Update

- Current paper STA profile from live state/DB:
  - MTF gate enabled with `entryGate.mtfAlignment.requiredCount: 2`.
  - `entryHaltControls.mtfAlignmentEnabled: true`.
  - Greek selector enabled, mode `all`, `requireLiveGreeks: true`, fallback legacy enabled.
  - Liquidity gate has `requireBidAsk: true`, `requireFreshQuote: false`, `maxSpreadPctOfMid: 25`, `minBid: 0.01`.
  - Option selection is scoped: `minDte: 1`, `targetDte: 3`, `maxDte: 7`, calls slots `[2,1,0]`, puts slots `[4,3]`.
- MTF rule path:
  - Pyrus Signals core computes `filterState.mtfDirections` from configured MTFs.
  - Because Pyrus signal filters are currently disabled (`filterState.enabled: false`), `filterState.passes` can still be `true`; that does not mean STA MTF passed.
  - STA independently counts first three `mtfDirections` that match candidate direction; buy/call wants `1`, sell/put wants `-1`.
  - `mtf_not_aligned` is emitted when matches are below required count.
- Live APH evidence:
  - APH current candidate was `sell`/`put`.
  - Its signal metadata had `mtfDirections: [1, 1, 1]`, ADX `15.682988`, Pyrus filters disabled.
  - STA result is `mtfMatches: 0`, `requiredMtfCount: 2`, reasons include `mtf_not_aligned`, `adx_below_minimum`, `mtf_fully_bullish`; top reason is `mtf_not_aligned`.
  - This is rule-correct under current STA controls; the confusing part is the UI/event also shows Pyrus `mtfPass: [true,true,true]` because signal filters are disabled.
- Bid/ask findings:
  - Rows blocked by MTF or gateway/session quiet do not need live bid/ask and should not trade.
  - `market_session_quiet` is a gateway readiness skip reason, and `processEntryCandidate` returns before contract resolution when that blocker is present.
  - Direct metadata chain probes for GLW/RTX returned bounded contracts with delayed last/mark but `bid: 0`, `ask: 0`.
  - Direct snapshot hydration probes for GLW/RTX returned zero contracts after a long wait; later API requests were shed with `api-resource-pressure-critical`.
  - Since the live paper profile requires positive bid/ask, delayed metadata marks alone are not trade-ready.
  - Follow-up DB audit corrected the earlier broad explanation: bid/ask failures also occurred during regular market hours, not only after the close.
  - Market-hours `missing_bid_ask` rows at `2026-06-01T16:46Z` and `2026-06-01T17:46-17:48Z` selected contracts such as `NRG20260605C129`, `GOOGL20260603C3725`, `GLW20260605C1725`, `HOOD20260605C90`, and `DIA20260605C508`, but the quote payload still had `bid:null`, `ask:null`, `mark:null`, `marketDataMode:"live"`, and `quoteFreshness:"metadata"`.
  - Those rows predated the `17:54Z` profile update that enabled `greekSelector.requireLiveGreeks`, so they represent metadata-first selection where selected-contract live quote hydration did not produce bid/ask before the liquidity gate ran.
  - After `17:54Z`, `greekSelector.mode:"all"` plus `requireLiveGreeks:true` makes `resolveSignalOptionsCandidateContract` override `quoteHydration:"metadata"` to `"snapshot"`, which is heavier: the bounded strike/DTE chain must hydrate live quote/Greek snapshots before selection. Later failures were mostly `candidate_resolution_timeout` or `greek_selector_no_candidates` with `options_upstream_failure`.
  - Code path: after a contract is selected, STA declares `automation-live` demand for exactly the selected `providerContractId`, calls `fetchBridgeOptionQuoteSnapshots`, retries once after `750ms` if cache is still metadata/pending/stale/unavailable, then evaluates liquidity. The 120s live-demand TTL keeps the quote demand alive for later cache updates; it does not make the current candidate wait 120s.
  - Diagnostic gap found: liquidity skip payloads include selected contract, quote, liquidity, chain debug, and chain attempts, but omit `contractResolution.detail.liveQuoteDemand`, so old persisted `missing_bid_ask` events do not show whether the selected-contract quote lease was admitted, rejected, blocked, or returned empty.
  - Implemented diagnostic fix: liquidity skip payloads now preserve `contractResolution.detail.liveQuoteDemand` when selected-contract live quote demand exists. This lets new `missing_bid_ask` rows show whether the selected option quote was pending, awaiting Greeks, unavailable, stale, admitted/rejected, or otherwise blocked by market-data demand state.
  - Current line usage after restart (`/api/settings/ibkr-line-usage` on port `8080`) shows `40/200` active lines, `3` active option lines, automation `6/200`, zero automation rejections since restart, and API pressure header fluctuating `watch/high`. This does not reconstruct old admission state, but it rules out current app-wide 200-line exhaustion.
- Runtime note:
  - During the audit the local Replit app/API restarted and route admission went critical. Heavy STA/cockpit/options routes returned 503/429 while Vite/API startup consumed CPU.
  - This is separate from MTF correctness but explains disappearing/hydration failures during live poking.
- Validation after diagnostic fix:
  - `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts` passed: `120/120`.
  - `pnpm --dir artifacts/api-server run typecheck` passed.
  - `pnpm --dir artifacts/api-server run build` passed.
  - Scoped `git diff --check` passed for the touched API and handoff files.
- Selected-contract quote retry fix:
  - Implemented a bounded live quote settle loop for STA entry resolution after a contract is selected. It still requests exactly one `providerContractId`; it does not expand DTE, strike slots, strike coverage, or candidate count.
  - The loop waits up to `2.5s`, polling every `500ms`, and is still capped by the existing `9s` candidate-resolution abort signal. It retries only hydration misses (`metadata`/`pending`/`unavailable`, `missing_bid_ask`, `missing_mark`, `quote_not_fresh`), not real liquidity rejects such as `spread_too_wide`.
  - `liveQuoteDemand` diagnostics now include `hydrationAttempts`, `hydrationWaitMs`, and `snapshotDebug` so the next skip can show admission/snapshot counts and blocked/error details.
  - Focused validation after this change: `pnpm --dir artifacts/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts` passed `121/121`; `pnpm --dir artifacts/api-server run build` passed; scoped `git diff --check` passed.
  - `pnpm --dir artifacts/api-server run typecheck` is blocked by unrelated existing `src/services/signal-options-position-tick-manager.test.ts` errors (`Cannot find module './signal-options-position-tick-manager'`, `"long"` not assignable to `SignalDirection`, and implicit `any`s). No `signal-options-automation.ts` type errors remain.
- Post-reload check:
  - Old API process was stopped; repo guard correctly refused Codex-owned full-app startup, then Replit-owned `pnpm --filter @workspace/pyrus run dev:replit` came back on PID `71873` with API PID `71911`.
  - `/api/session` responds on port `8080`; line usage after reload showed `38/200` active lines, `3` option lines, automation pool `0/200`, and zero automation rejections since restart.
  - DB had `0` Signal Options events for deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0` after `2026-06-01T21:25:00Z`; no fresh liquidity skip exists yet to prove the new `liveQuoteDemand` payload.
  - Light `/signal-options/state` responds with `7` current candidates; all are historical terminal blocks such as `greek_selector_no_candidates` or `mtf_not_aligned`, with no selected contract/live quote demand. Full cockpit/state remains heavy: `/cockpit?view=full` returned `504 signal_options_dashboard_build_timeout`.
  - Reloaded again after the selected-contract retry build. Replit-owned app returned after about three minutes with app PID `79591` and API PID `79629`. `/api/session` returned `200` with pressure `normal`; line usage showed `31/200` active lines, `0` active option lines, automation pool `0/200`, and zero automation-live admissions/rejections since reload.
  - DB had `0` Signal Options events for deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0` after `2026-06-01T21:33:00Z`; no fresh post-retry liquidity skip exists yet.

## Algo Page Upper-Area UI Update

- User asked to redesign the upper area of the Algo page and remove redundancies/duplications.
- Changed files:
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`
  - `artifacts/pyrus/src/screens/algo/AlgoOperationsPrimitives.jsx`
  - `artifacts/pyrus/src/screens/algo/OperationsAttentionStrip.jsx`
  - `artifacts/pyrus/src/screens/algo/OperationsTransitionsStrip.jsx`
  - `artifacts/pyrus/src/screens/AlgoScreen.jsx`
  - `artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js`
  - `artifacts/pyrus/src/screens/algo/algoHelpers.test.js`
- UI changes:
  - Header title now says `Pyrus Signal-Options` instead of the old `Pyrus Signals Shadow`.
  - Header metadata now carries timeframe/horizon/BOS/watchlist/scan recency, replacing separate Scan/Event overview tiles.
  - Overview metrics were reduced from eight tiles to four: `P&L`, `Exposure`, `Risk`, and `Record`.
  - Pipeline stage display now groups the eight small stage tiles into four phases: `Signal Cycle`, `Entry Path`, `Orders`, and `Management`.
  - Empty `Since ... no change`, `Attention All clear`, and `Last 60s Awaiting next scan` filler no longer renders in the Algo page upper area.
  - Record display now infers wins/losses from closed-trade count plus win rate when the API summary has closed trades but omits explicit wins/losses, avoiding `0W / 0L` with nonzero closed-trade stats.
  - Visible scan toast copy in `AlgoScreen.jsx` was changed from old `Shadow scan ...` wording to `Signal-options scan ...`.
- Validation passed:
  - `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/OperationsSignalRow.test.js` -> 15/15.
  - `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/algo/algoHelpers.test.js` -> 33/33.
  - `pnpm --filter @workspace/pyrus run typecheck` -> pass.
  - Scoped `git diff --check` for touched UI/test files -> pass.
- Validation caveat:
  - Full `platformRootSource.test.js` currently fails 56/57 on an unrelated `PlatformApp` signal-matrix scheduler source assertion: expected `signalMatrixQueuedEvaluationDelayMsRef.current = Math.max`. This path was not touched by the Algo upper-area redesign.
- Browser visual QA was completed in pickup session `019e856e-bffa-7833-b2b7-da4c35f1f4ed` against the already-running Replit-owned app at `http://127.0.0.1:18747/?pyrusQa=safe`.
  - Explicit readiness selectors used: `algo-screen`, `algo-live-content`, `algo-operations-header`, `algo-operations-overview`, and four `algo-pipeline-stage-*` elements.
  - Desktop and mobile passed with no console warnings/errors and no page errors.
  - Verified four overview metrics: `P&L`, `Exposure`, `Risk`, and `Record`.
  - Verified four grouped pipeline phases: `Signal Cycle`, `Entry Path`, `Orders`, and `Management`.
  - Verified stale copy/filler is absent from the upper area: `Pyrus Signals Shadow`, `Shadow scan`, `Since ... no change`, `Attention All clear`, and `Last 60s Awaiting next scan`.
  - Screenshots: `/tmp/pyrus-algo-upper-desktop-settled.png`, `/tmp/pyrus-algo-upper-mobile-settled.png`.

## Current User Request

Continue dropped session D without handwaving:

- ID: `019e8366-b25f-7921-bbd5-2bfc17403296`
- File: `SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md`
- Workstream: IBKR Gateway launch / line diagnostics.
- User direction: no glossing over; diagnose every potential issue.
- Starting next step from D: restart normal Replit app and verify line usage / cockpit diagnostics on the new backend.

## Prior Handoffs

- `SESSION_HANDOFF_2026-06-01_75218067-d9b9-4264-8b7a-3243c1a06ca1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-d2bd-7103-91a9-a73c9fcfb9c1.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-83ed-7462-8cd5-1c29cc47fbd7.md`
- `SESSION_HANDOFF_2026-06-01_019e84aa-1f90-7b41-b68e-5b0b7120b56c.md`
- `SESSION_HANDOFF_2026-06-01_019e8411-18fc-7911-9c4d-4aeecba402ac.md`
- `SESSION_HANDOFF_2026-06-01_019e83a8-59ca-7843-b17d-1eb1b26d5363.md`
- `SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md`
- `SESSION_HANDOFF_2026-06-01_019e8368-7762-7122-81b8-8a37bfbb0e60.md`
- `SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md`
- `SESSION_HANDOFF_2026-06-01_019e8361-9248-72a3-9743-ffd530b4d55e.md`
- `SESSION_HANDOFF_2026-05-31_019e80a2-9969-70a2-a92d-39cf6a379925.md`
- `SESSION_HANDOFF_2026-05-31_019e8076-ad60-7ee3-9c89-87f101b7545a.md`
- `SESSION_HANDOFF_2026-05-31_019e802e-8fc0-77a0-8857-7f3208f84734.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-7aa8-7832-9d3b-d9a1f55357d2.md`
- `SESSION_HANDOFF_2026-05-31_019e802d-21e9-7bf1-961a-4c205f226e9e.md`
- `SESSION_HANDOFF_2026-05-31_019e7ff7-d9da-7333-9c5f-43f9156a8d45.md`
- `SESSION_HANDOFF_2026-05-31_019e7fc7-29fb-7991-9d61-98d6224fb6da.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa4-ed2e-70e1-ac7f-a54fee386518.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md`
- `SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md`
- `SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md`
- `SESSION_HANDOFF_2026-05-31_019e7e9b-e240-7c30-98d2-a1ad94723f11.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-c715-7200-b4a6-1bb0adf72b13.md`
- `SESSION_HANDOFF_2026-05-30_019e7acd-1f10-7e00-9474-efbb5051b670.md`
- `SESSION_HANDOFF_2026-05-30_019e7a9a-5ec9-7eb3-95f1-d0c5503ed8a0.md`
- `SESSION_HANDOFF_2026-05-30_019e7a20-0e2f-73f1-ae20-ddf1fb495be5.md`
- `SESSION_HANDOFF_2026-05-30_019e7995-e4a1-7bf2-b6a0-339a98d29317.md`
- `SESSION_HANDOFF_2026-05-30_019e7994-2d67-7883-840f-7d3c3d92d721.md`
- `SESSION_HANDOFF_2026-05-29_019e752f-259e-7553-9866-4b0c4544dd05.md`
- `SESSION_HANDOFF_2026-05-29_019e752d-9895-7653-936f-31f010b764d5.md`
- `SESSION_HANDOFF_2026-05-29_019e752a-b590-79a3-a82b-ee464537fd82.md`
- `SESSION_HANDOFF_2026-05-29_019e7529-c353-7b83-a39a-5f8a0fe69745.md`
- `SESSION_HANDOFF_2026-05-29_019e7499-013e-7c80-ad40-9c917f319149.md`
- `SESSION_HANDOFF_2026-05-29_019e7442-882b-7a13-b625-d886421780aa.md`
- `SESSION_HANDOFF_2026-05-29_019e742a-a3f1-71b3-8374-b51029016cbf.md`
- `SESSION_HANDOFF_2026-05-29_019e7426-9371-7430-9a71-6686f1347001.md`
- `SESSION_HANDOFF_2026-05-29_019e7421-ba22-78a1-a721-7446ea362dd7.md`
- `SESSION_HANDOFF_2026-05-28_019e6f40-5f2f-78f1-afca-4032e91e55db.md`
- `SESSION_HANDOFF_2026-05-28_019e6f32-5565-76d0-8ae0-06b4e2e30a0e.md`
- `SESSION_HANDOFF_2026-05-28_019e6ea4-f32b-7261-8ca3-9d57cc9d40b5.md`
- `SESSION_HANDOFF_2026-05-27_019e6bbb-f865-7563-96f6-ede09cfc4167.md`
- `SESSION_HANDOFF_2026-05-26_019e654e-1409-7621-bde7-f8c231fda8d0.md`
- `SESSION_HANDOFF_2026-05-26_019e6477-7493-7191-acfb-8aa632788e6c.md`
- `SESSION_HANDOFF_2026-05-25_019e6049-463f-7ab0-a520-95e909a2eff6.md`
- `SESSION_HANDOFF_2026-05-22_019e509e-5038-7b20-a757-cf053441bc8d.md`
- `SESSION_HANDOFF_2026-05-22_019e5096-b2ce-7881-83b4-84fd5ae9aea9.md`
- `SESSION_HANDOFF_2026-05-22_019e4fde-9151-7940-a16a-b90a6bf12517.md`
- `SESSION_HANDOFF_2026-05-22_019e4fdd-cf2f-77a2-84e7-35d48584074b.md`
- `SESSION_HANDOFF_2026-05-22_019e4fd1-20ef-7931-9b08-e4cc646ccb00.md`
- `SESSION_HANDOFF_2026-05-21_019e4e27-3e58-7c51-a2ee-431ce0637c44.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5e-ddaa-7d22-90ff-4b3b56c16ab1.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5d-d653-7702-86a8-c20a83ee23ff.md`
- `SESSION_HANDOFF_2026-05-21_019e4d5c-a277-71d0-afd5-4a740991a8c6.md`
- `SESSION_HANDOFF_2026-05-21_019e4c7a-19cf-7740-84f6-5eb3a1f36fae.md`
- `SESSION_HANDOFF_2026-05-21_019e4c26-0d56-7120-b85e-bf5e18f14721.md`
- `SESSION_HANDOFF_2026-05-21_019e4c16-3a66-7302-8ada-1206e23e11df.md`
- `SESSION_HANDOFF_2026-05-21_019e4c15-88e9-7a42-aad0-86eed917c98a.md`
- `SESSION_HANDOFF_2026-05-21_019e4c14-fe5e-7802-970c-bae01f8b7212.md`
- `SESSION_HANDOFF_2026-05-21_019e4acb-958e-76f2-89fc-f534179f2902.md`
- `SESSION_HANDOFF_2026-05-20_019e46ed-0bc3-78f3-bad7-f7ca24065531.md`
- `SESSION_HANDOFF_2026-05-20_019e45cf-44f8-7fe2-87f5-7d055c00513f.md`
- `SESSION_HANDOFF_2026-05-20_019e45ab-830c-76d1-8f63-448f25c8f681.md`
- `SESSION_HANDOFF_2026-05-20_019e45a3-68ab-7160-ab80-038d09482d6a.md`
- `SESSION_HANDOFF_2026-05-19_019e4057-cc09-7610-9cd5-2b159d78b023.md`
- `SESSION_HANDOFF_2026-05-14_019e26f3-cc37-7351-94a3-c52aae3be0c7.md`
- `SESSION_HANDOFF_2026-05-13_019e21ab-042e-7d62-82c5-621bb214aaf4.md`
- `SESSION_HANDOFF_2026-05-13_019e219a-97c1-7c81-a23d-86233b1a8ccc.md`
- `SESSION_HANDOFF_2026-05-13_019e2194-a0c5-7fd1-8c6e-f3fd3869af34.md`
- `SESSION_HANDOFF_2026-05-13_019e2191-5255-7b50-9d9d-d66432f7cc23.md`
- `SESSION_HANDOFF_2026-05-13_019e2168-cce7-7f22-8a53-a394d6279949.md`
- `SESSION_HANDOFF_2026-05-11_019e1777-ea5d-7a03-aa38-a7da139985d7.md`
- `SESSION_HANDOFF_2026-05-08_019e0920-564f-78d0-8463-410e50e52b5d.md`
- `SESSION_HANDOFF_2026-05-08_019e0826-0850-7bf2-8100-0b3eada42e32.md`
- `SESSION_HANDOFF_2026-05-06_019dff8b-c488-7ec1-bab2-7eeca931697f.md`
- `SESSION_HANDOFF_2026-05-06_019dff88-574a-74f3-8ead-27ea141dfd2f.md`
- `SESSION_HANDOFF_2026-05-06_019dff6f-d657-70a2-bed9-7c3a2469bed7.md`
- `SESSION_HANDOFF_2026-05-06_019dff68-fd69-7fd1-84aa-f97b89d2efe8.md`
- `SESSION_HANDOFF_2026-05-06_019dff67-f5a1-7332-8624-585ac4cd1435.md`
- `SESSION_HANDOFF_2026-05-06_019dff66-df3f-7bc1-abe4-39b68ed2dcff.md`
- `SESSION_HANDOFF_2026-05-06_019dfe4d-4d96-7552-80ac-346c0646adb1.md`
- `SESSION_HANDOFF_2026-05-06_019dfe49-d18c-7bd1-97d1-7e004ff154f0.md`
- `SESSION_HANDOFF_2026-05-06_019dfe45-759c-77c0-b66f-9cc21addb43b.md`
- `SESSION_HANDOFF_2026-05-06_019dfe1c-e228-72b2-932c-6d9faa06df81.md`

## Recent User Messages

- `2026-06-01T19:40:09.696Z` please pick up this session: C. Greek Contract Selection /
  Backtest Exit Sweeps
  ID: 019e838b-6af5-7b72-b4aa-
  ee78a7bd3449
  File: SESSION_HANDOFF_2026-
  06-01_019e838b-6af5-7b72-
  b4aa-ee78a7bd3449.md
  Latest work note: 2026-06-01
  13:15 MT
  Work: Greek-selected entries,
  exit-policy sweep variants,
  wire-trail vs no-wire
  controls, dry-run reports.
  Validation: sweep tests
  10/10, scripts typecheck, API
  signal-options automation
  110/110.
  Next: full 90-symbol fixed-
  floor control vs wire fixed-
  floor comparison.
- `2026-06-01T19:41:04.333Z` proceed
- `2026-06-01T20:02:35.770Z` just give me a summary of your findings
- `2026-06-01T20:03:23.606Z` did we learn anything from the backtesting?

## Session Activity Summary

- `2026-06-01T19:40:09.696Z` User: please pick up this session: C. Greek Contract Selection / Backtest Exit Sweeps ID: 019e838b-6af5-7b72-b4aa- ee78a7bd3449 File: SESSION_HANDOFF_2026- 06-01_019e838b-6af5-7b72- b4a…
- `2026-06-01T19:40:24.078Z` Agent: I’ll use the context-restore/session handoff flow and first read the saved handoff plus the repo state, then I’ll continue with the next fixed-floor comparison rather than guessin…
- `2026-06-01T19:40:24.082Z` Tool: exec_command sed -n '1,220p' /home/runner/workspace/.agents/skills/gstack/context-restore/SKILL.md
- `2026-06-01T19:40:24.083Z` Tool: exec_command sed -n '1,220p' /home/runner/workspace/.agents/skills/session-handoff/SKILL.md
- `2026-06-01T19:40:24.085Z` Tool: exec_command git status --short
- `2026-06-01T19:40:24.086Z` Tool: exec_command sed -n '1,260p' SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md
- … 119 lower-signal transcript events omitted …
- `2026-06-01T20:02:01.708Z` Agent: The second foreground run was killed again with status 130 at about 12 minutes, with no script-level error. This looks like the command session being interrupted externally rather…
- `2026-06-01T20:02:01.713Z` Tool: exec_command pnpm --filter @workspace/scripts exec tsx -e "import { pool } from '@workspace/db'; (async () => { const result = await pool.query(\`select l.pid, l.objid::text as objid, l.grante…
- `2026-06-01T20:02:01.757Z` Tool: exec_command ps -eo pid,ppid,pgid,sid,tty,stat,etime,cmd | rg -i "signal-options-exit-policy-sweep|pnpm --filter @workspace/scripts run signal-options|pnpm --filter @workspace/pyrus run dev:re…
- `2026-06-01T20:02:01.758Z` Tool: exec_command find /home/runner/workspace/scripts/reports/signal-options-exit-policy-sweeps/fixed-floor-control-vs-wire-90-symbols-2026-05-04-through-2026-05-21 -type f -printf '%p %s\n' 2>/dev…
- `2026-06-01T20:02:15.720Z` Agent: The Replit app auto-restarted under the default artifact dev workflow, so stopping the process tree is not durable. The workable approach is to have the detached sweep grab the ad…
- `2026-06-01T20:02:16.038Z` Tool: write_stdin session 91242
- `2026-06-01T20:02:35.770Z` User: just give me a summary of your findings
- `2026-06-01T20:02:56.118Z` Agent: Summary of findings: - The prior Greek/backtest work was restored correctly from `SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md`. - The sweep code already has…
- `2026-06-01T20:03:23.606Z` User: did we learn anything from the backtesting?
- `2026-06-01T20:03:41.846Z` Agent: Yes, but only from the completed scoped backtests, not the full 90-symbol run. What we learned: - Greek-selected entries are working well enough to run historical dry replays and…

## High-Signal Changed Files

- `.gitignore`
- `.replit`
- `5-28 trading analysis.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md`
- `SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md`
- `SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md`
- `SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md`
- `SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md`
- `SESSION_HANDOFF_CURRENT.md`
- `SESSION_HANDOFF_MASTER.md`
- `artifacts/api-server/package.json`
- `artifacts/api-server/scripts/runUnitTests.mjs`
- `artifacts/api-server/scripts/sampleFlowPremiumDistribution.mjs`
- `artifacts/api-server/src/lib/runtime.test.ts`
- `artifacts/api-server/src/lib/runtime.ts`
- `artifacts/api-server/src/lib/values.ts`
- `artifacts/api-server/src/providers/ibkr/client.ts`
- `artifacts/api-server/src/providers/polygon/market-data.test.ts`
- `artifacts/api-server/src/providers/polygon/market-data.ts`
- `artifacts/api-server/src/routes/automation.ts`
- `artifacts/api-server/src/routes/platform-streams-source.test.ts`
- `artifacts/api-server/src/routes/platform.ts`
- `artifacts/api-server/src/services/account-positions.test.ts`
- `artifacts/api-server/src/services/account.ts`
- `artifacts/api-server/src/services/algo-deployment-account.ts`
- `artifacts/api-server/src/services/automation.test.ts`
- `artifacts/api-server/src/services/automation.ts`
- `artifacts/api-server/src/services/backend-settings.ts`
- `artifacts/api-server/src/services/backtesting.ts`
- `artifacts/api-server/src/services/bridge-governor.test.ts`

## Repo State Snapshot

```text
## main...origin/main
 M .gitignore
 M .replit
 M "5-28 trading analysis.md"
 M SESSION_HANDOFF_2026-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md
 M SESSION_HANDOFF_2026-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md
 M SESSION_HANDOFF_2026-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md
 M SESSION_HANDOFF_2026-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md
 M SESSION_HANDOFF_2026-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md
 M SESSION_HANDOFF_CURRENT.md
 M SESSION_HANDOFF_MASTER.md
 M artifacts/api-server/package.json
 M artifacts/api-server/scripts/runUnitTests.mjs
 M artifacts/api-server/scripts/sampleFlowPremiumDistribution.mjs
 M artifacts/api-server/src/lib/runtime.test.ts
 M artifacts/api-server/src/lib/runtime.ts
 M artifacts/api-server/src/lib/values.ts
 M artifacts/api-server/src/providers/ibkr/client.ts
 D artifacts/api-server/src/providers/polygon/market-data.test.ts
 D artifacts/api-server/src/providers/polygon/market-data.ts
 M artifacts/api-server/src/routes/automation.ts
 M artifacts/api-server/src/routes/platform-streams-source.test.ts
 M artifacts/api-server/src/routes/platform.ts
 M artifacts/api-server/src/services/account-positions.test.ts
 M artifacts/api-server/src/services/account.ts
 M artifacts/api-server/src/services/algo-deployment-account.ts
 M artifacts/api-server/src/services/automation.test.ts
 M artifacts/api-server/src/services/automation.ts
 M artifacts/api-server/src/services/backend-settings.ts
 M artifacts/api-server/src/services/backtesting.ts
 M artifacts/api-server/src/services/bridge-governor.test.ts
 M artifacts/api-server/src/services/bridge-governor.ts
 M artifacts/api-server/src/services/bridge-option-quote-stream.test.ts
 M artifacts/api-server/src/services/bridge-option-quote-stream.ts
 M artifacts/api-server/src/services/bridge-quote-stream.ts
 M artifacts/api-server/src/services/bridge-streams.ts
 M artifacts/api-server/src/services/diagnostics.test.ts
 M artifacts/api-server/src/services/flow-events-model.test.ts
 M artifacts/api-server/src/services/flow-events-model.ts
 M artifacts/api-server/src/services/flow-premium-distribution.test.ts
 M artifacts/api-server/src/services/gex.test.ts
 M artifacts/api-server/src/services/gex.ts
 M artifacts/api-server/src/services/historical-flow-events.test.ts
 M artifacts/api-server/src/services/historical-flow-events.ts
 M artifacts/api-server/src/services/ibkr-bridge-runtime.test.ts
 M artifacts/api-server/src/services/ibkr-bridge-runtime.ts
 M artifacts/api-server/src/services/ibkr-lanes.ts
 M artifacts/api-server/src/services/ibkr-line-usage.test.ts
 M artifacts/api-server/src/services/ibkr-line-usage.ts
 M artifacts/api-server/src/services/market-data-admission.test.ts
 M artifacts/api-server/src/services/market-data-admission.ts
 M artifacts/api-server/src/services/market-data-ingest.ts
 M artifacts/api-server/src/services/market-data-store.ts
 M artifacts/api-server/src/services/market-data-work-planner.test.ts
 M artifacts/api-server/src/services/market-data-work-planner.ts
 M artifacts/api-server/src/services/market-identity.ts
 M artifacts/api-server/src/services/massive-stock-quote-stream.test.ts
 M artifacts/api-server/src/services/massive-stock-quote-stream.ts
 M artifacts/api-server/src/services/nasdaq-symbol-directory.ts
 M artifacts/api-server/src/services/option-chain-batch.test.ts
 M artifacts/api-server/src/services/option-metadata-store.ts
 M artifacts/api-server/src/services/options-flow-scanner.test.ts
 M artifacts/api-server/src/services/options-flow-scanner.ts
 M artifacts/api-server/src/services/platform-massive-stock-routing.test.ts
 M artifacts/api-server/src/services/platform-quote-snapshot.test.ts
 M artifacts/api-server/src/services/platform-runtime-status.ts
 M artifacts/api-server/src/services/platform-ticker-search.test.ts
 M artifacts/api-server/src/services/platform.ts
 D artifacts/api-server/src/services/polygon-delayed-stream.test.ts
 D artifacts/api-server/src/services/polygon-delayed-stream.ts
 M artifacts/api-server/src/services/resource-pressure.test.ts
 M artifacts/api-server/src/services/resource-pressure.ts
 M artifacts/api-server/src/services/route-admission.test.ts
 M artifacts/api-server/src/services/route-admission.ts
 M artifacts/api-server/src/services/runtime-diagnostics.test.ts
 M artifacts/api-server/src/services/runtime-flight-recorder.test.ts
 M artifacts/api-server/src/services/shadow-account.test.ts
 M artifacts/api-server/src/services/shadow-account.ts
 M artifacts/api-server/src/services/signal-monitor.test.ts
 M artifacts/api-server/src/services/signal-monitor.ts
 M artifacts/api-server/src/services/signal-options-automation.test.ts
 M artifacts/api-server/src/services/signal-options-automation.ts
 M artifacts/api-server/src/services/signal-options-worker.test.ts
 M artifacts/api-server/src/services/signal-options-worker.ts
 M artifacts/api-server/src/services/sp500-constituents.ts
 M artifacts/api-server/src/services/stock-aggregate-stream.test.ts
 M artifacts/api-server/src/services/stock-aggregate-stream.ts
 M artifacts/api-server/src/services/trade-monitor-worker.test.ts
 M artifacts/api-server/src/services/trade-monitor-worker.ts
 M artifacts/api-server/src/services/volume-footprints.ts
 M artifacts/api-server/src/services/watchlist-prewarm.test.ts
 M artifacts/api-server/src/ws/options-quotes.ts
 M artifacts/backtest-worker/src/index.ts
 M artifacts/ibkr-bridge/src/tws-provider.test.ts
 M artifacts/ibkr-bridge/src/work-scheduler.ts
 M artifacts/pyrus/docs/architecture/market-data-ingest-worker.md
 M artifacts/pyrus/docs/architecture/modularization-tracker.md
 M artifacts/pyrus/e2e/algo-signal-row.spec.ts
 M artifacts/pyrus/e2e/chart-hydration-startup.spec.ts
 M artifacts/pyrus/e2e/diagnostics-chart-hydration.spec.ts
 M artifacts/pyrus/e2e/flow-layout.spec.ts
 M artifacts/pyrus/e2e/market-live-flow.spec.ts
 M artifacts/pyrus/e2e/market-premium-flow.spec.ts
 M artifacts/pyrus/e2e/market-responsive.spec.ts
 M artifacts/pyrus/e2e/memory-soak.spec.ts
 M artifacts/pyrus/e2e/platform-shell.spec.ts
 M artifacts/pyrus/e2e/render-policy.spec.ts
 M artifacts/pyrus/e2e/ticker-search.spec.ts
 M artifacts/pyrus/e2e/warmup-policy.spec.ts
 M artifacts/pyrus/package.json
 M artifacts/pyrus/scripts/runUnitTests.mjs
 M artifacts/pyrus/src/components/platform/BottomSheet.jsx
 M artifacts/pyrus/src/components/platform/DenseVirtualTable.jsx
 M artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx
 M artifacts/pyrus/src/components/platform/signal-language/thresholds.js
 M artifacts/pyrus/src/features/account/positionDisplayModel.js
 M artifacts/pyrus/src/features/account/positionDisplayModel.test.js
 M artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx
 M artifacts/pyrus/src/features/charting/ChartParityLab.tsx
 M artifacts/pyrus/src/features/charting/ResearchChartFrame.tsx
 M artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx
 M artifacts/pyrus/src/features/charting/chartApiBars.js
 M artifacts/pyrus/src/features/charting/chartApiBars.test.js
 M artifacts/pyrus/src/features/charting/chartEvents.test.ts
 M artifacts/pyrus/src/features/charting/chartHydrationStats.test.ts
 M artifacts/pyrus/src/features/charting/flowChartEvents.test.ts
 M artifacts/pyrus/src/features/charting/marketSession.test.ts
 M artifacts/pyrus/src/features/charting/marketSession.ts
 M artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts
 M artifacts/pyrus/src/features/charting/useMassiveStreamedStockBars.test.ts
 M artifacts/pyrus/src/features/flow/ContractDetailInline.jsx
 M artifacts/pyrus/src/features/flow/FlowDistributionScannerPanel.jsx
 M artifacts/pyrus/src/features/flow/flowEventMapper.js
 M artifacts/pyrus/src/features/flow/flowEventMapper.test.js
 M artifacts/pyrus/src/features/flow/flowPresentation.js
 M artifacts/pyrus/src/features/gex/HeatmapColorLegend.jsx
 M artifacts/pyrus/src/features/gex/gexDataWiring.test.js
 M artifacts/pyrus/src/features/gex/gexGlossary.js
 M artifacts/pyrus/src/features/gex/gexModel.js
 M artifacts/pyrus/src/features/gex/gexModel.test.js
 M artifacts/pyrus/src/features/market/MarketActivityPanel.jsx
 M artifacts/pyrus/src/features/market/MarketChartCell.jsx
 M artifacts/pyrus/src/features/market/MultiChartGrid.jsx
 M artifacts/pyrus/src/features/market/marketChartWiring.test.js
 M artifacts/pyrus/src/features/platform/AppHeader.jsx
 M artifacts/pyrus/src/features/platform/HeaderBroadcastScrollerStack.jsx
 M artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx
 M artifacts/pyrus/src/features/platform/IbkrConnectionStatus.test.js
 M artifacts/pyrus/src/features/platform/MobileMoreSheet.jsx
 M artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx
 M artifacts/pyrus/src/features/platform/PlatformApp.jsx
 M artifacts/pyrus/src/features/platform/PlatformScreenRouter.jsx
 M artifacts/pyrus/src/features/platform/PlatformShell.jsx
 M artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx
 M artifacts/pyrus/src/features/platform/appWorkScheduler.js
 M artifacts/pyrus/src/features/platform/appWorkScheduler.test.js
 M artifacts/pyrus/src/features/platform/headerBroadcastModel.js
 M artifacts/pyrus/src/features/platform/headerBroadcastModel.test.js
 M artifacts/pyrus/src/features/platform/ibkrPopoverModel.js
 M artifacts/pyrus/src/features/platform/marketFlowScannerConfig.js
 M artifacts/pyrus/src/features/platform/marketFlowScannerConfig.test.js
 M artifacts/pyrus/src/features/platform/marketFlowStore.js
 M artifacts/pyrus/src/features/platform/marketFlowStore.test.js
 M artifacts/pyrus/src/features/platform/memoryPressureModel.js
 M artifacts/pyrus/src/features/platform/memoryPressureModel.test.js
 M artifacts/pyrus/src/features/platform/memoryPressurePopoverModel.js
 M artifacts/pyrus/src/features/platform/platformRootSource.test.js
 M artifacts/pyrus/src/features/platform/runtimeControlModel.js
 M artifacts/pyrus/src/features/platform/runtimeControlModel.test.js
 M artifacts/pyrus/src/features/platform/screenRegistry.jsx
 M artifacts/pyrus/src/features/platform/signalMatrixScheduler.js
 M artifacts/pyrus/src/features/platform/signalMatrixScheduler.test.js
 M artifacts/pyrus/src/features/platform/tickerSearch/TickerSearch.jsx
 M artifacts/pyrus/src/features/platform/tradeFlowStore.test.js
 M artifacts/pyrus/src/features/platform/useLiveMarketFlow.js
 M artifacts/pyrus/src/features/platform/useMemoryPressureSignal.js
 M artifacts/pyrus/src/features/platform/watchlistModel.js
 M artifacts/pyrus/src/features/platform/watchlistModel.test.js
 M artifacts/pyrus/src/features/research/lib/researchApi.js
 M artifacts/pyrus/src/features/signals/signalsRowModel.js
 M artifacts/pyrus/src/features/signals/signalsRowModel.test.js
 M artifacts/pyrus/src/features/trade/TradeEquityPanel.jsx
 M artifacts/pyrus/src/features/workers/analyticsWorkerApi.test.js
 M artifacts/pyrus/src/screens/AlgoScreen.jsx
 M artifacts/pyrus/src/screens/FlowScreen.jsx
 M artifacts/pyrus/src/screens/GexScreen.jsx
 M artifacts/pyrus/src/screens/SettingsScreen.jsx
 M artifacts/pyrus/src/screens/SignalsScreen.jsx
 M artifacts/pyrus/src/screens/TradeScreen.jsx
 M artifacts/pyrus/src/screens/account/PositionsPanel.test.js
 M artifacts/pyrus/src/screens/algo/AlgoAuditPanel.test.js
 M artifacts/pyrus/src/screens/algo/AlgoDiagnosticsTab.jsx
 M artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx
 M artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js
 M artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx
 M artifacts/pyrus/src/screens/algo/algoAuditModel.js
 M artifacts/pyrus/src/screens/algo/algoHelpers.js
 M artifacts/pyrus/src/screens/algo/algoHelpers.test.js
 M crates/market-data-worker/src/compute/gex.rs
 M crates/market-data-worker/src/config.rs
 M crates/market-data-worker/src/ingest.rs
 M crates/market-data-worker/src/main.rs
 M crates/market-data-worker/src/providers/massive.rs
 M crates/market-data-worker/src/providers/mod.rs
 D crates/market-data-worker/src/providers/polygon.rs
 M docs/plans/awesome-quant-pyrus-improvements.md
 M lib/api-client-react/src/generated/api.schemas.ts
 M lib/api-client-react/src/generated/api.ts
 M lib/api-spec/openapi.yaml
 M lib/api-zod/src/generated/api.ts
 M lib/api-zod/src/generated/types/accountAllocationBucket.ts
 M lib/api-zod/src/generated/types/accountAllocationResponse.ts
 M lib/api-zod/src/generated/types/accountCashActivity.ts
 M lib/api-zod/src/generated/types/accountCashActivityResponse.ts
 M lib/api-zod/src/generated/types/accountCashEvent.ts
 M lib/api-zod/src/generated/types/accountClosedTradesResponse.ts
 M lib/api-zod/src/generated/types/accountDividend.ts
 M lib/api-zod/src/generated/types/accountEquityHistoryResponse.ts
 M lib/api-zod/src/generated/types/accountEquityHistoryResponseSourceScope.ts
 M lib/api-zod/src/generated/types/accountEquityHistoryResponseTerminalPointSource.ts
 M lib/api-zod/src/generated/types/accountEquityPoint.ts
 M lib/api-zod/src/generated/types/accountEquityPointSource.ts
 M lib/api-zod/src/generated/types/accountExposureSummary.ts
 M lib/api-zod/src/generated/types/accountFx.ts
 M lib/api-zod/src/generated/types/accountFxRates.ts
 M lib/api-zod/src/generated/types/accountHistoryRange.ts
 M lib/api-zod/src/generated/types/accountMetric.ts
 M lib/api-zod/src/generated/types/accountMetricSource.ts
 M lib/api-zod/src/generated/types/accountOrder.ts
 M lib/api-zod/src/generated/types/accountOrderSourceType.ts
 M lib/api-zod/src/generated/types/accountOrdersResponse.ts
 M lib/api-zod/src/generated/types/accountOrdersResponseDebug.ts
 M lib/api-zod/src/generated/types/accountOrdersResponseTab.ts
 M lib/api-zod/src/generated/types/accountPositionDateActivity.ts
 M lib/api-zod/src/generated/types/accountPositionLot.ts
 M lib/api-zod/src/generated/types/accountPositionRiskOverlay.ts
 M lib/api-zod/src/generated/types/accountPositionRow.ts
 M lib/api-zod/src/generated/types/accountPositionRowAttributionStatus.ts
 M lib/api-zod/src/generated/types/accountPositionRowAutomationContext.ts
 M lib/api-zod/src/generated/types/accountPositionRowSourceType.ts
 M lib/api-zod/src/generated/types/accountPositionsAtDateResponse.ts
 M lib/api-zod/src/generated/types/accountPositionsAtDateResponseStatus.ts
 M lib/api-zod/src/generated/types/accountPositionsResponse.ts
 M lib/api-zod/src/generated/types/accountRiskResponse.ts
 M lib/api-zod/src/generated/types/accountSummaryAccount.ts
 M lib/api-zod/src/generated/types/accountSummaryMetrics.ts
 M lib/api-zod/src/generated/types/accountSummaryResponse.ts
 M lib/api-zod/src/generated/types/accountTrade.ts
 M lib/api-zod/src/generated/types/accountTradeFilterState.ts
 M lib/api-zod/src/generated/types/accountTradeMetadata.ts
 M lib/api-zod/src/generated/types/accountTradeOptionContract.ts
 M lib/api-zod/src/generated/types/accountTradeOptionRight.ts
 M lib/api-zod/src/generated/types/accountTradeSelectedContract.ts
 M lib/api-zod/src/generated/types/accountTradeSource.ts
 M lib/api-zod/src/generated/types/accountTradeSourceType.ts
 M lib/api-zod/src/generated/types/accountsResponse.ts
 M lib/api-zod/src/generated/types/algoCockpitAttentionItem.ts
 M lib/api-zod/src/generated/types/algoCockpitAttentionItemSeverity.ts
 M lib/api-zod/src/generated/types/algoCockpitFleetSummary.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStage.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStageActiveScanPhase.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStageId.ts
 M lib/api-zod/src/generated/types/algoCockpitPipelineStageStatus.ts
 M lib/api-zod/src/generated/types/algoCockpitReadiness.ts
 M lib/api-zod/src/generated/types/algoCockpitSnapshotResponse.ts
 M lib/api-zod/src/generated/types/algoCockpitSourceBacktest.ts
 M lib/api-zod/src/generated/types/algoDeployment.ts
 M lib/api-zod/src/generated/types/algoDeploymentsResponse.ts
 M lib/api-zod/src/generated/types/assetClass.ts
 M lib/api-zod/src/generated/types/backtestChartBar.ts
 M lib/api-zod/src/generated/types/backtestChartBarRange.ts
 M lib/api-zod/src/generated/types/backtestChartMarker.ts
 M lib/api-zod/src/generated/types/backtestChartMarkerPosition.ts
 M lib/api-zod/src/generated/types/backtestChartMarkerShape.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadge.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadgeFormat.ts
 M lib/api-zod/src/generated/types/backtestComparisonBadgeWinner.ts
 M lib/api-zod/src/generated/types/backtestDatasetRef.ts
 M lib/api-zod/src/generated/types/backtestDirectionMode.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategiesResponse.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategy.ts
 M lib/api-zod/src/generated/types/backtestDraftStrategyConfig.ts
 M lib/api-zod/src/generated/types/backtestEquitySeriesPoint.ts
 M lib/api-zod/src/generated/types/backtestExecutionProfile.ts
 M lib/api-zod/src/generated/types/backtestIndicatorEvent.ts
 M lib/api-zod/src/generated/types/backtestIndicatorEventMeta.ts
 M lib/api-zod/src/generated/types/backtestIndicatorMarkerPayload.ts
 M lib/api-zod/src/generated/types/backtestIndicatorMarkerPayloadMarkersByTradeId.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindow.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindowDirection.ts
 M lib/api-zod/src/generated/types/backtestIndicatorWindowMeta.ts
 M lib/api-zod/src/generated/types/backtestIndicatorZone.ts
 M lib/api-zod/src/generated/types/backtestIndicatorZoneMeta.ts
 M lib/api-zod/src/generated/types/backtestJobStatus.ts
 M lib/api-zod/src/generated/types/backtestJobSummary.ts
 M lib/api-zod/src/generated/types/backtestJobsResponse.ts
 M lib/api-zod/src/generated/types/backtestMetrics.ts
 M lib/api-zod/src/generated/types/backtestOptimizerMode.ts
 M lib/api-zod/src/generated/types/backtestParameterDefinition.ts
 M lib/api-zod/src/generated/types/backtestParameterDefinitionType.ts
 M lib/api-zod/src/generated/types/backtestPoint.ts
 M lib/api-zod/src/generated/types/backtestPortfolioRules.ts
 M lib/api-zod/src/generated/types/backtestRunChart.ts
 M lib/api-zod/src/generated/types/backtestRunChartChartPriceContext.ts
 M lib/api-zod/src/generated/types/backtestRunChartDefaultVisibleLogicalRange.ts
 M lib/api-zod/src/generated/types/backtestRunDetail.ts
 M lib/api-zod/src/generated/types/backtestRunSummary.ts
 M lib/api-zod/src/generated/types/backtestRunsResponse.ts
 M lib/api-zod/src/generated/types/backtestStrategiesResponse.ts
 M lib/api-zod/src/generated/types/backtestStrategyCatalogItem.ts
 M lib/api-zod/src/generated/types/backtestStrategyCatalogItemDefaultParameters.ts
 M lib/api-zod/src/generated/types/backtestStrategyStatus.ts
 M lib/api-zod/src/generated/types/backtestStudiesResponse.ts
 M lib/api-zod/src/generated/types/backtestStudyInput.ts
 M lib/api-zod/src/generated/types/backtestStudyInputOptimizerConfig.ts
 M lib/api-zod/src/generated/types/backtestStudyInputParameters.ts
 M lib/api-zod/src/generated/types/backtestStudyPreviewChart.ts
 M lib/api-zod/src/generated/types/backtestStudyRecord.ts
 M lib/api-zod/src/generated/types/backtestStudyRecordOptimizerConfig.ts
 M lib/api-zod/src/generated/types/backtestStudyRecordParameters.ts
 M lib/api-zod/src/generated/types/backtestSweepDetail.ts
 M lib/api-zod/src/generated/types/backtestSweepDimension.ts
 M lib/api-zod/src/generated/types/backtestTimeToTradeIdsEntry.ts
 M lib/api-zod/src/generated/types/backtestTrade.ts
 M lib/api-zod/src/generated/types/backtestTradeDiagnostics.ts
 M lib/api-zod/src/generated/types/backtestTradeExitConsequences.ts
 M lib/api-zod/src/generated/types/backtestTradeInstrumentType.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroup.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroupDir.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroupKind.ts
 M lib/api-zod/src/generated/types/backtestTradeMarkerGroups.ts
 M lib/api-zod/src/generated/types/backtestTradeOptionContract.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlay.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlayChartPriceContext.ts
 M lib/api-zod/src/generated/types/backtestTradeOverlayDir.ts
 M lib/api-zod/src/generated/types/backtestTradePricingMode.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStep.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStepEmphasis.ts
 M lib/api-zod/src/generated/types/backtestTradeReasonTraceStepKind.ts
 M lib/api-zod/src/generated/types/backtestTradeSelectionFocus.ts
 M lib/api-zod/src/generated/types/backtestTradeSelectionFocusVisibleLogicalRange.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdPath.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegment.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegmentKind.ts
 M lib/api-zod/src/generated/types/backtestTradeThresholdSegmentStyle.ts
 M lib/api-zod/src/generated/types/bar.ts
 M lib/api-zod/src/generated/types/barDataSource.ts
 M lib/api-zod/src/generated/types/barMarketDataMode.ts
 M lib/api-zod/src/generated/types/barTimeframe.ts
 M lib/api-zod/src/generated/types/barsHistoryPage.ts
 M lib/api-zod/src/generated/types/barsHistoryPageCacheStatus.ts
 M lib/api-zod/src/generated/types/barsHistoryPageHydrationStatus.ts
 M lib/api-zod/src/generated/types/barsResponse.ts
 M lib/api-zod/src/generated/types/barsResponseMarketDataMode.ts
 M lib/api-zod/src/generated/types/benchmarkFlowScannerBody.ts
 M lib/api-zod/src/generated/types/benchmarkFlowScannerBodyStrikeCoverage.ts
 M lib/api-zod/src/generated/types/brokerAccount.ts
 M lib/api-zod/src/generated/types/brokerConnection.ts
 M lib/api-zod/src/generated/types/brokerConnectionProvider.ts
 M lib/api-zod/src/generated/types/brokerConnectionsResponse.ts
 M lib/api-zod/src/generated/types/brokerProvider.ts
 M lib/api-zod/src/generated/types/brokerTradingReadinessState.ts
 M lib/api-zod/src/generated/types/cancelAccountOrderRequest.ts
 M lib/api-zod/src/generated/types/cancelOrderRequest.ts
 M lib/api-zod/src/generated/types/cancelOrderResponse.ts
 M lib/api-zod/src/generated/types/chartBarTimeframe.ts
 M lib/api-zod/src/generated/types/connectionStatus.ts
 M lib/api-zod/src/generated/types/createAlgoDeploymentRequest.ts
 M lib/api-zod/src/generated/types/createBacktestRunRequest.ts
 M lib/api-zod/src/generated/types/createBacktestRunRequestParameters.ts
 M lib/api-zod/src/generated/types/createBacktestSweepRequest.ts
 M lib/api-zod/src/generated/types/createBacktestSweepRequestBaseParameters.ts
 M lib/api-zod/src/generated/types/createPineScriptRequest.ts
 M lib/api-zod/src/generated/types/createPineScriptRequestMetadata.ts
 M lib/api-zod/src/generated/types/createWatchlistRequest.ts
 M lib/api-zod/src/generated/types/diagnosticClientEventRequest.ts
 M lib/api-zod/src/generated/types/diagnosticEvent.ts
 M lib/api-zod/src/generated/types/diagnosticEventDetailResponse.ts
 M lib/api-zod/src/generated/types/diagnosticEventRecordResponse.ts
 M lib/api-zod/src/generated/types/diagnosticEventStatus.ts
 M lib/api-zod/src/generated/types/diagnosticEventsResponse.ts
 M lib/api-zod/src/generated/types/diagnosticExportResponse.ts
 M lib/api-zod/src/generated/types/diagnosticHistoryPoint.ts
 M lib/api-zod/src/generated/types/diagnosticHistoryResponse.ts
 M lib/api-zod/src/generated/types/diagnosticSeverity.ts
 M lib/api-zod/src/generated/types/diagnosticSnapshot.ts
 M lib/api-zod/src/generated/types/diagnosticStatus.ts
 M lib/api-zod/src/generated/types/diagnosticThreshold.ts
 M lib/api-zod/src/generated/types/diagnosticThresholdsResponse.ts
 M lib/api-zod/src/generated/types/diagnosticThresholdsUpdateRequest.ts
 M lib/api-zod/src/generated/types/diagnosticThresholdsUpdateRequestThresholdsItem.ts
 M lib/api-zod/src/generated/types/diagnosticsLatestResponse.ts
 M lib/api-zod/src/generated/types/enableAlgoDeploymentParams.ts
 M lib/api-zod/src/generated/types/enableAlgoDeploymentView.ts
 M lib/api-zod/src/generated/types/ensureDefaultSignalOptionsPaperDeploymentBody.ts
 M lib/api-zod/src/generated/types/environmentMode.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorMatrixRequest.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorMatrixRequestClientRole.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorMatrixRequestRequestOrigin.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorRequest.ts
 M lib/api-zod/src/generated/types/evaluateSignalMonitorRequestMode.ts
 M lib/api-zod/src/generated/types/executionEvent.ts
 M lib/api-zod/src/generated/types/executionEventsResponse.ts
 M lib/api-zod/src/generated/types/exportDiagnosticsParams.ts
 M lib/api-zod/src/generated/types/flexHealthResponse.ts
 M lib/api-zod/src/generated/types/flexTestResponse.ts
 M lib/api-zod/src/generated/types/flowDataProvider.ts
 M lib/api-zod/src/generated/types/flowEvent.ts
 M lib/api-zod/src/generated/types/flowEventBasis.ts
 M lib/api-zod/src/generated/types/flowEventConfidence.ts
 M lib/api-zod/src/generated/types/flowEventMoneyness.ts
 M lib/api-zod/src/generated/types/flowEventSourceBasis.ts
 M lib/api-zod/src/generated/types/flowEventsResponse.ts
 M lib/api-zod/src/generated/types/flowEventsSource.ts
 M lib/api-zod/src/generated/types/flowEventsSourceIbkrStatus.ts
 M lib/api-zod/src/generated/types/flowEventsSourceProvider.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerCoverage.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerCoverageLastScannedAt.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerCoverageMode.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerPhase.ts
 M lib/api-zod/src/generated/types/flowEventsSourceScannerStrikeCoverage.ts
 M lib/api-zod/src/generated/types/flowEventsSourceStatus.ts
 M lib/api-zod/src/generated/types/flowEventsSourceUnderlyingSpotSource.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionBucket.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionBucketThresholds.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionBuckets.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionClassificationConfidence.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionHydrationDiagnostics.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionHydrationDiagnosticsQuoteProbeStatus.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionResponse.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionResponseStatus.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionResponseTimeframe.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSource.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceCache.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceCoverageMode.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceHydrationStatus.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceProvider.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceQuoteAccess.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceSideBasis.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceTimeframe.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionSourceTradeAccess.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidget.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetConfidence.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetMarketCapTier.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetQuoteAccess.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetSideBasis.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetSource.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetTimeframe.ts
 M lib/api-zod/src/generated/types/flowPremiumDistributionWidgetTradeAccess.ts
 M lib/api-zod/src/generated/types/flowSentiment.ts
 M lib/api-zod/src/generated/types/flowUniverseCoverage.ts
 M lib/api-zod/src/generated/types/flowUniverseCoverageLastScannedAt.ts
 M lib/api-zod/src/generated/types/flowUniverseCoverageMode.ts
 M lib/api-zod/src/generated/types/flowUniverseResponse.ts
 M lib/api-zod/src/generated/types/flowUniverseSources.ts
 M lib/api-zod/src/generated/types/footprintCandle.ts
 M lib/api-zod/src/generated/types/footprintDiagnostics.ts
 M lib/api-zod/src/generated/types/footprintDiagnosticsClassificationMethod.ts
 M lib/api-zod/src/generated/types/footprintDiagnosticsMinTickSource.ts
 M lib/api-zod/src/generated/types/footprintDiagnosticsSourceProvider.ts
 M lib/api-zod/src/generated/types/footprintLevel.ts
 M lib/api-zod/src/generated/types/footprintPartialReason.ts
 M lib/api-zod/src/generated/types/footprintResponse.ts
 M lib/api-zod/src/generated/types/footprintSourcePreference.ts
 M lib/api-zod/src/generated/types/footprintTimeframe.ts
 M lib/api-zod/src/generated/types/getAccountAllocationParams.ts
 M lib/api-zod/src/generated/types/getAccountCashActivityParams.ts
 M lib/api-zod/src/generated/types/getAccountClosedTradesParams.ts
 M lib/api-zod/src/generated/types/getAccountClosedTradesPnlSign.ts
 M lib/api-zod/src/generated/types/getAccountEquityHistoryParams.ts
 M lib/api-zod/src/generated/types/getAccountOrdersParams.ts
 M lib/api-zod/src/generated/types/getAccountOrdersTab.ts
 M lib/api-zod/src/generated/types/getAccountPositionsAtDateParams.ts
 M lib/api-zod/src/generated/types/getAccountPositionsParams.ts
 M lib/api-zod/src/generated/types/getAccountRiskParams.ts
 M lib/api-zod/src/generated/types/getAccountSummaryParams.ts
 M lib/api-zod/src/generated/types/getBacktestRunChartParams.ts
 M lib/api-zod/src/generated/types/getBarsParams.ts
 M lib/api-zod/src/generated/types/getFlowPremiumDistributionCoverageMode.ts
 M lib/api-zod/src/generated/types/getFlowPremiumDistributionParams.ts
 M lib/api-zod/src/generated/types/getFlowPremiumDistributionTimeframe.ts
 M lib/api-zod/src/generated/types/getFootprintsParams.ts
 M lib/api-zod/src/generated/types/getMarketDepth200.ts
 M lib/api-zod/src/generated/types/getMarketDepthParams.ts
 M lib/api-zod/src/generated/types/getNewsParams.ts
 M lib/api-zod/src/generated/types/getOptionChainParams.ts
 M lib/api-zod/src/generated/types/getOptionChartBarsParams.ts
 M lib/api-zod/src/generated/types/getOptionExpirationsParams.ts
 M lib/api-zod/src/generated/types/getQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/getResearchEarningsCalendarParams.ts
 M lib/api-zod/src/generated/types/getResearchFinancialsParams.ts
 M lib/api-zod/src/generated/types/getResearchFundamentalsParams.ts
 M lib/api-zod/src/generated/types/getResearchSecFilingsParams.ts
 M lib/api-zod/src/generated/types/getResearchSnapshotsParams.ts
 M lib/api-zod/src/generated/types/getResearchTranscriptParams.ts
 M lib/api-zod/src/generated/types/getResearchTranscriptsParams.ts
 M lib/api-zod/src/generated/types/getSignalMonitorProfileParams.ts
 M lib/api-zod/src/generated/types/getSignalMonitorStateParams.ts
 M lib/api-zod/src/generated/types/getUniverseLogosParams.ts
 M lib/api-zod/src/generated/types/gexDashboardResponse.ts
 M lib/api-zod/src/generated/types/gexDashboardResponseFlowContextStatus.ts
 M lib/api-zod/src/generated/types/gexFlowClassificationBasisCounts.ts
 M lib/api-zod/src/generated/types/gexFlowClassificationConfidenceCounts.ts
 M lib/api-zod/src/generated/types/gexFlowContext.ts
 M lib/api-zod/src/generated/types/gexOptionRow.ts
 M lib/api-zod/src/generated/types/gexOptionRowCp.ts
 M lib/api-zod/src/generated/types/gexProfile.ts
 M lib/api-zod/src/generated/types/gexSnapshot.ts
 M lib/api-zod/src/generated/types/gexSource.ts
 M lib/api-zod/src/generated/types/gexSourceFlowStatus.ts
 M lib/api-zod/src/generated/types/gexSourceProvider.ts
 M lib/api-zod/src/generated/types/gexSourceStatus.ts
 M lib/api-zod/src/generated/types/gexTickerDetails.ts
 M lib/api-zod/src/generated/types/healthStatus.ts
 M lib/api-zod/src/generated/types/healthStatusStatus.ts
 M lib/api-zod/src/generated/types/ibkrBridgeActivationCancelResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeActivationProgress.ts
 M lib/api-zod/src/generated/types/ibkrBridgeActivationStatusResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeAttachResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthMarketDataMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthRole.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthStreamState.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionHealthTransport.ts
 M lib/api-zod/src/generated/types/ibkrBridgeConnectionsHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeCredentialHandoff.ts
 M lib/api-zod/src/generated/types/ibkrBridgeCredentialHandoffAlgorithm.ts
 M lib/api-zod/src/generated/types/ibkrBridgeCredentialHandoffMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeDetachResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealth.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthMarketDataMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthStreamState.ts
 M lib/api-zod/src/generated/types/ibkrBridgeHealthTransport.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLauncherResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLauncherResponseAutoLoginMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginEnvelopeClaimResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginEnvelopeClaimResponseEnvelope.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginEnvelopeClaimResponseEnvelopeAlgorithm.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginKeyReadResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeLoginKeyReadResponseAlgorithm.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteLaunch.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteLaunchMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteLauncherResponse.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdown.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdownAction.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdownMode.ts
 M lib/api-zod/src/generated/types/ibkrBridgeRemoteShutdownResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktop.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopHeartbeatResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopJobStatusResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopJobStatusResponseAction.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopJobStatusResponseState.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopLaunchClaimResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopLaunchClaimResponseAction.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopRegisterResponse.ts
 M lib/api-zod/src/generated/types/ibkrRemoteDesktopsResponse.ts
 M lib/api-zod/src/generated/types/index.ts
 M lib/api-zod/src/generated/types/jsonObject.ts
 M lib/api-zod/src/generated/types/listAccountsParams.ts
 M lib/api-zod/src/generated/types/listAggregateFlowEventsParams.ts
 M lib/api-zod/src/generated/types/listAggregateFlowEventsScope.ts
 M lib/api-zod/src/generated/types/listAlgoDeploymentsParams.ts
 M lib/api-zod/src/generated/types/listBacktestRunsParams.ts
 M lib/api-zod/src/generated/types/listDiagnosticEventsParams.ts
 M lib/api-zod/src/generated/types/listDiagnosticHistoryParams.ts
 M lib/api-zod/src/generated/types/listExecutionEventsParams.ts
 M lib/api-zod/src/generated/types/listExecutions200.ts
 M lib/api-zod/src/generated/types/listExecutionsParams.ts
 M lib/api-zod/src/generated/types/listFlowEventsParams.ts
 M lib/api-zod/src/generated/types/listFlowEventsScope.ts
 M lib/api-zod/src/generated/types/listOrdersParams.ts
 M lib/api-zod/src/generated/types/listPositionsParams.ts
 M lib/api-zod/src/generated/types/listSignalMonitorEventsParams.ts
 M lib/api-zod/src/generated/types/marketDataFreshness.ts
 M lib/api-zod/src/generated/types/marketDataProvider.ts
 M lib/api-zod/src/generated/types/newsArticle.ts
 M lib/api-zod/src/generated/types/newsPublisher.ts
 M lib/api-zod/src/generated/types/newsResponse.ts
 M lib/api-zod/src/generated/types/okResponse.ts
 M lib/api-zod/src/generated/types/optionChainBatchRequest.ts
 M lib/api-zod/src/generated/types/optionChainBatchResponse.ts
 M lib/api-zod/src/generated/types/optionChainBatchResult.ts
 M lib/api-zod/src/generated/types/optionChainBatchResultStatus.ts
 M lib/api-zod/src/generated/types/optionChainQuote.ts
 M lib/api-zod/src/generated/types/optionChainQuoteHydration.ts
 M lib/api-zod/src/generated/types/optionChainQuoteMarketDataMode.ts
 M lib/api-zod/src/generated/types/optionChainResponse.ts
 M lib/api-zod/src/generated/types/optionChainStrikeCoverage.ts
 M lib/api-zod/src/generated/types/optionChartBarsDataSource.ts
 M lib/api-zod/src/generated/types/optionChartBarsResolutionSource.ts
 M lib/api-zod/src/generated/types/optionChartBarsResponse.ts
 M lib/api-zod/src/generated/types/optionContract.ts
 M lib/api-zod/src/generated/types/optionContractResolutionResponse.ts
 M lib/api-zod/src/generated/types/optionContractResolutionStatus.ts
 M lib/api-zod/src/generated/types/optionExpirationSummary.ts
 M lib/api-zod/src/generated/types/optionExpirationsResponse.ts
 M lib/api-zod/src/generated/types/optionOrderPositionEffect.ts
 M lib/api-zod/src/generated/types/optionOrderStrategyIntent.ts
 M lib/api-zod/src/generated/types/optionQuoteSnapshotsRequest.ts
 M lib/api-zod/src/generated/types/optionQuoteSnapshotsRequestIntent.ts
 M lib/api-zod/src/generated/types/optionQuoteSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/optionRight.ts
 M lib/api-zod/src/generated/types/order.ts
 M lib/api-zod/src/generated/types/orderPreview.ts
 M lib/api-zod/src/generated/types/orderSide.ts
 M lib/api-zod/src/generated/types/orderStatus.ts
 M lib/api-zod/src/generated/types/orderType.ts
 M lib/api-zod/src/generated/types/ordersResponse.ts
 M lib/api-zod/src/generated/types/ordersResponseDebug.ts
 M lib/api-zod/src/generated/types/pauseAlgoDeploymentParams.ts
 M lib/api-zod/src/generated/types/pauseAlgoDeploymentView.ts
 M lib/api-zod/src/generated/types/pineScriptPaneType.ts
 M lib/api-zod/src/generated/types/pineScriptRecord.ts
 M lib/api-zod/src/generated/types/pineScriptRecordMetadata.ts
 M lib/api-zod/src/generated/types/pineScriptStatus.ts
 M lib/api-zod/src/generated/types/pineScriptsResponse.ts
 M lib/api-zod/src/generated/types/placeOrderRequest.ts
 M lib/api-zod/src/generated/types/placeOrderRequestSource.ts
 M lib/api-zod/src/generated/types/position.ts
 M lib/api-zod/src/generated/types/positionOpenedAtSource.ts
 M lib/api-zod/src/generated/types/positionQuote.ts
 M lib/api-zod/src/generated/types/positionQuoteSource.ts
 M lib/api-zod/src/generated/types/positionsResponse.ts
 M lib/api-zod/src/generated/types/promoteBacktestRunRequest.ts
 M lib/api-zod/src/generated/types/proxyUniverseLogoParams.ts
 M lib/api-zod/src/generated/types/quoteSnapshot.ts
 M lib/api-zod/src/generated/types/quoteSnapshotLatency.ts
 M lib/api-zod/src/generated/types/quoteSnapshotMarketDataMode.ts
 M lib/api-zod/src/generated/types/quoteSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/quoteSource.ts
 M lib/api-zod/src/generated/types/readinessState.ts
 M lib/api-zod/src/generated/types/readinessStatus.ts
 M lib/api-zod/src/generated/types/readinessStatusAppReadiness.ts
 M lib/api-zod/src/generated/types/readinessStatusAppReadinessDiagnosticsSeverity.ts
 M lib/api-zod/src/generated/types/readinessStatusAppReadinessDiagnosticsStatus.ts
 M lib/api-zod/src/generated/types/readinessStatusBrokerTradingReadiness.ts
 M lib/api-zod/src/generated/types/readinessStatusBrokerTradingReadinessChecks.ts
 M lib/api-zod/src/generated/types/readinessStatusLiveness.ts
 M lib/api-zod/src/generated/types/readinessStatusLivenessStatus.ts
 M lib/api-zod/src/generated/types/readinessStatusPressureLevel.ts
 M lib/api-zod/src/generated/types/recordIbkrBridgeActivationProgress200.ts
 M lib/api-zod/src/generated/types/reorderWatchlistItemsRequest.ts
 M lib/api-zod/src/generated/types/replaceOrderRequest.ts
 M lib/api-zod/src/generated/types/requestDebug.ts
 M lib/api-zod/src/generated/types/requestDebugCacheStatus.ts
 M lib/api-zod/src/generated/types/researchAnnualEarningsPoint.ts
 M lib/api-zod/src/generated/types/researchBalanceSheetPeriod.ts
 M lib/api-zod/src/generated/types/researchCalendarEntry.ts
 M lib/api-zod/src/generated/types/researchCalendarResponse.ts
 M lib/api-zod/src/generated/types/researchCashFlowPeriod.ts
 M lib/api-zod/src/generated/types/researchFiling.ts
 M lib/api-zod/src/generated/types/researchFilingsResponse.ts
 M lib/api-zod/src/generated/types/researchFinancials.ts
 M lib/api-zod/src/generated/types/researchFinancialsResponse.ts
 M lib/api-zod/src/generated/types/researchFundamentals.ts
 M lib/api-zod/src/generated/types/researchFundamentalsResponse.ts
 M lib/api-zod/src/generated/types/researchIncomeStatementPeriod.ts
 M lib/api-zod/src/generated/types/researchProvider.ts
 M lib/api-zod/src/generated/types/researchQuarterlyEpsPoint.ts
 M lib/api-zod/src/generated/types/researchRatiosPeriod.ts
 M lib/api-zod/src/generated/types/researchSnapshot.ts
 M lib/api-zod/src/generated/types/researchSnapshotsResponse.ts
 M lib/api-zod/src/generated/types/researchStatus.ts
 M lib/api-zod/src/generated/types/researchTranscriptResponse.ts
 M lib/api-zod/src/generated/types/researchTranscriptsResponse.ts
 M lib/api-zod/src/generated/types/resolveBacktestOptionContract200.ts
 M lib/api-zod/src/generated/types/resolveBacktestOptionContractBody.ts
 M lib/api-zod/src/generated/types/resolveBacktestOptionContractBodyRight.ts
 M lib/api-zod/src/generated/types/resolveOptionContractParams.ts
 M lib/api-zod/src/generated/types/runSignalOptionsShadowBackfillBody.ts
 M lib/api-zod/src/generated/types/runtimeApiDiagnostics.ts
 M lib/api-zod/src/generated/types/runtimeDiagnosticsResponse.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnostics.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnosticsMarketDataMode.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnosticsStreamState.ts
 M lib/api-zod/src/generated/types/runtimeIbkrDiagnosticsTransport.ts
 M lib/api-zod/src/generated/types/runtimeMemoryDiagnostics.ts
 M lib/api-zod/src/generated/types/runtimeOrderCapabilityDiagnostics.ts
 M lib/api-zod/src/generated/types/searchUniverseTickersMode.ts
 M lib/api-zod/src/generated/types/searchUniverseTickersParams.ts
 M lib/api-zod/src/generated/types/sessionIbkrRuntime.ts
 M lib/api-zod/src/generated/types/sessionInfo.ts
 M lib/api-zod/src/generated/types/sessionInfoConfigured.ts
 M lib/api-zod/src/generated/types/sessionMarketDataProviders.ts
 M lib/api-zod/src/generated/types/sessionMarketDataProvidersResearch.ts
 M lib/api-zod/src/generated/types/sessionRuntime.ts
 M lib/api-zod/src/generated/types/signalMonitorDirection.ts
 M lib/api-zod/src/generated/types/signalMonitorEvent.ts
 M lib/api-zod/src/generated/types/signalMonitorEventsResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCacheStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCoverage.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCoverageCacheStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixResponseCoverageSourceStrategy.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixState.ts
 M lib/api-zod/src/generated/types/signalMonitorMatrixTimeframe.ts
 M lib/api-zod/src/generated/types/signalMonitorProfile.ts
 M lib/api-zod/src/generated/types/signalMonitorStateResponse.ts
 M lib/api-zod/src/generated/types/signalMonitorStateResponseCacheStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorStateResponseStateSource.ts
 M lib/api-zod/src/generated/types/signalMonitorSymbolState.ts
 M lib/api-zod/src/generated/types/signalMonitorSymbolStatus.ts
 M lib/api-zod/src/generated/types/signalMonitorTimeframe.ts
 M lib/api-zod/src/generated/types/signalMonitorUniverseSummary.ts
 M lib/api-zod/src/generated/types/signalMonitorUniverseSummaryMode.ts
 M lib/api-zod/src/generated/types/signalMonitorUniverseSummarySource.ts
 M lib/api-zod/src/generated/types/signalOptionsAutomationState.ts
 M lib/api-zod/src/generated/types/signalOptionsAutomationStateMode.ts
 M lib/api-zod/src/generated/types/signalOptionsExecutionProfile.ts
 M lib/api-zod/src/generated/types/signalOptionsExecutionProfileMode.ts
 M lib/api-zod/src/generated/types/signalOptionsExecutionProfileVersion.ts
 M lib/api-zod/src/generated/types/signalOptionsManualDeviationRequest.ts
 M lib/api-zod/src/generated/types/signalOptionsManualDeviationRequestSource.ts
 M lib/api-zod/src/generated/types/signalOptionsManualDeviationResponse.ts
 M lib/api-zod/src/generated/types/signalOptionsPerformanceResponse.ts
 M lib/api-zod/src/generated/types/sseStream.ts
 M lib/api-zod/src/generated/types/stockAggregateStreamSessionResponse.ts
 M lib/api-zod/src/generated/types/streamAccountPageOrderTab.ts
 M lib/api-zod/src/generated/types/streamAccountPageParams.ts
 M lib/api-zod/src/generated/types/streamAccountPagePnlSign.ts
 M lib/api-zod/src/generated/types/streamAccountsParams.ts
 M lib/api-zod/src/generated/types/streamBarsParams.ts
 M lib/api-zod/src/generated/types/streamExecutionsParams.ts
 M lib/api-zod/src/generated/types/streamFootprintsParams.ts
 M lib/api-zod/src/generated/types/streamMarketDepthParams.ts
 M lib/api-zod/src/generated/types/streamOptionChainsParams.ts
 M lib/api-zod/src/generated/types/streamOptionQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/streamOrdersParams.ts
 M lib/api-zod/src/generated/types/streamQuoteSnapshotsParams.ts
 M lib/api-zod/src/generated/types/streamStockAggregatesParams.ts
 M lib/api-zod/src/generated/types/submitIbkrOrdersRequest.ts
 M lib/api-zod/src/generated/types/submitIbkrOrdersResponse.ts
 M lib/api-zod/src/generated/types/timeInForce.ts
 M lib/api-zod/src/generated/types/transcriptDateEntry.ts
 M lib/api-zod/src/generated/types/transcriptEntry.ts
 M lib/api-zod/src/generated/types/universeMarket.ts
 M lib/api-zod/src/generated/types/universeTicker.ts
 M lib/api-zod/src/generated/types/universeTickerContractMeta.ts
 M lib/api-zod/src/generated/types/universeTickersResponse.ts
 M lib/api-zod/src/generated/types/updateAlgoDeploymentStrategySettingsRequest.ts
 M lib/api-zod/src/generated/types/updateAlgoDeploymentStrategySettingsRequestBosConfirmation.ts
 M lib/api-zod/src/generated/types/updateAlgoDeploymentStrategySettingsResponse.ts
 M lib/api-zod/src/generated/types/updatePineScriptRequest.ts
 M lib/api-zod/src/generated/types/updatePineScriptRequestMetadata.ts
 M lib/api-zod/src/generated/types/updateSignalMonitorProfileRequest.ts
 M lib/api-zod/src/generated/types/updateSignalOptionsExecutionProfileResponse.ts
 M lib/api-zod/src/generated/types/updateStockAggregateStreamSymbolsBody.ts
 M lib/api-zod/src/generated/types/updateWatchlistRequest.ts
 M lib/api-zod/src/generated/types/watchlist.ts
 M lib/api-zod/src/generated/types/watchlistItem.ts
 M lib/api-zod/src/generated/types/watchlistSymbolRequest.ts
 M lib/api-zod/src/generated/types/watchlistsResponse.ts
 M lib/backtest-core/src/index.ts
 M lib/backtest-core/src/signal-options.test.ts
 M lib/backtest-core/src/signal-options.ts
 M lib/db/migrations/20260529_market_data_ingest.sql
 M lib/db/src/index.ts
 M lib/db/src/pool-error-handler.test.ts
 M lib/db/src/pool-error-handler.ts
 M lib/db/src/schema/enums.ts
 M lib/db/src/schema/flow.ts
 M lib/db/src/schema/instruments.ts
 M lib/db/src/schema/market-data.ts
 M lib/ibkr-contracts/src/client.ts
 M lib/ibkr-contracts/src/runtime.ts
 M pnpm-lock.yaml
 M scripts/README.md
 M scripts/package.json
 M scripts/src/hydrate-universe-catalog-ibkr.ts
 M scripts/src/market-data-schema-audit.ts
 M scripts/src/shadow-options-management-review.ts
 D scripts/src/shadow-polygon-options-audit.ts
 M scripts/src/signal-options-exit-policy-sweep.test.ts
 M scripts/src/signal-options-exit-policy-sweep.ts
 M scripts/src/sync-listed-universe.ts
 M scripts/src/sync-nasdaq-listed-universe.ts
 M scripts/src/sync-sp500-universe.ts
 M scripts/src/sync-universe-catalog.ts
 M scripts/windows/pyrus-ibkr-helper.ps1
 M tsconfig.json
?? 'executionMode'
?? 'expirationCoverage'
?? 'greekSelector'
?? 'optionSelection'-
?? 'parameters'-
?? SESSION_HANDOFF_2026-05-31_019e7fa4-ed2e-70e1-ac7f-a54fee386518.md
?? SESSION_HANDOFF_2026-05-31_019e7fc7-29fb-7991-9d61-98d6224fb6da.md
?? SESSION_HANDOFF_2026-05-31_019e7ff7-d9da-7333-9c5f-43f9156a8d45.md
?? SESSION_HANDOFF_2026-05-31_019e802d-21e9-7bf1-961a-4c205f226e9e.md
?? SESSION_HANDOFF_2026-05-31_019e802d-7aa8-7832-9d3b-d9a1f55357d2.md
?? SESSION_HANDOFF_2026-05-31_019e802e-8fc0-77a0-8857-7f3208f84734.md
?? SESSION_HANDOFF_2026-05-31_019e8076-ad60-7ee3-9c89-87f101b7545a.md
?? SESSION_HANDOFF_2026-05-31_019e80a2-9969-70a2-a92d-39cf6a379925.md
?? SESSION_HANDOFF_2026-06-01_019e8361-9248-72a3-9743-ffd530b4d55e.md
?? SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md
?? SESSION_HANDOFF_2026-06-01_019e8368-7762-7122-81b8-8a37bfbb0e60.md
?? SESSION_HANDOFF_2026-06-01_019e838b-6af5-7b72-b4aa-ee78a7bd3449.md
?? SESSION_HANDOFF_2026-06-01_019e83a8-59ca-7843-b17d-1eb1b26d5363.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-1f90-7b41-b68e-5b0b7120b56c.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-83ed-7462-8cd5-1c29cc47fbd7.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-c1d5-79e1-adba-5a743d03c8cc.md
?? SESSION_HANDOFF_2026-06-01_019e84aa-d2bd-7103-91a9-a73c9fcfb9c1.md
?? SESSION_HANDOFF_2026-06-01_75218067-d9b9-4264-8b7a-3243c1a06ca1.md
?? SESSION_HANDOFF_LIVE_2026-05-31_gex-projection-cone.md
?? artifacts/api-server/src/providers/massive/
?? artifacts/api-server/src/services/gex-projection-api.test.ts
?? artifacts/api-server/src/services/gex-projection.test.ts
?? artifacts/api-server/src/services/gex-projection.ts
?? artifacts/api-server/src/services/ibkr-live-demand-coordinator.test.ts
?? artifacts/api-server/src/services/ibkr-live-demand-coordinator.ts
?? artifacts/api-server/src/services/massive-stock-aggregate-stream.test.ts
?? artifacts/api-server/src/services/massive-stock-aggregate-stream.ts
?? artifacts/api-server/src/services/massive-stock-websocket.test.ts
?? artifacts/api-server/src/services/massive-stock-websocket.ts
?? artifacts/api-server/src/services/option-metadata-store.test.ts
?? artifacts/api-server/src/services/treasury-yield-curve.test.ts
?? artifacts/api-server/src/services/treasury-yield-curve.ts
?? artifacts/pyrus/src/features/backtesting/backtestValidationWarnings.test.ts
?? artifacts/pyrus/src/features/backtesting/backtestValidationWarnings.ts
?? artifacts/pyrus/src/features/gex/gexDate.js
?? artifacts/pyrus/src/features/gex/gexHeatmapModel.js
?? artifacts/pyrus/src/features/gex/gexHeatmapModel.test.js
?? artifacts/pyrus/src/features/gex/gexProjectionChartWiring.test.js
?? artifacts/pyrus/src/features/gex/useGexProjection.js
?? artifacts/pyrus/src/features/gex/useGexProjection.test.js
?? artifacts/pyrus/src/features/platform/userFacingRuntimeError.d.ts
?? artifacts/pyrus/src/features/platform/userFacingRuntimeError.js
?? artifacts/pyrus/src/features/platform/userFacingRuntimeError.test.js
?? artifacts/pyrus/src/features/signals/signalStateFreshness.js
?? artifacts/pyrus/src/features/signals/signalStateFreshness.test.js
?? artifacts/pyrus/src/features/signals/signalsMatrixHydration.js
?? artifacts/pyrus/src/features/signals/signalsMatrixHydration.test.js
?? docs/analytics/
?? docs/audits/
?? docs/plans/ibkr-data-line-architecture-plan.md
?? docs/plans/live-ibkr-signal-options-rollout.md
?? docs/plans/signals-row-drilldown.md
?? lib/api-zod/src/generated/types/accountPositionRiskOverlayActiveStopKind.ts
?? lib/api-zod/src/generated/types/gexExpirationCoverage.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorDirection.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorMtfSnapshot.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorSnapshot.ts
?? lib/api-zod/src/generated/types/signalMonitorIndicatorStrength.ts
?? lib/api-zod/src/generated/types/signalMonitorTrendAgeBucket.ts
?? lib/backtest-core/src/option-greek-selector.test.ts
?? lib/backtest-core/src/option-greek-selector.ts
?? lib/backtest-core/src/signal-forward-returns.test.ts
?? lib/backtest-core/src/signal-forward-returns.ts
?? lib/db/migrations/20260531_option_chain_snapshot_latest_per_contract_idx.sql
?? lib/db/migrations/20260601_massive_provider_rename.sql
?? lib/market-calendar/
?? scripts/reports/signal-options-exit-policy-sweeps/control-fixed-floor-9-symbols-2026-05-04-through-2026-05-21/
?? scripts/reports/signal-options-exit-policy-sweeps/current-greek-control-9-symbols-2026-05-04-through-2026-05-21/
?? scripts/reports/signal-options-exit-policy-sweeps/wire-trail-phase1a-9-symbols-2026-05-04-through-2026-05-21/
?? scripts/src/shadow-massive-options-audit.ts
?? scripts/src/signal-options-greek-selector-smoke.test.ts
?? scripts/src/signal-options-greek-selector-smoke.ts
```

## Diff Summary

```text
 .gitignore                                         |    1 +
 .replit                                            |   32 +
 5-28 trading analysis.md                           |  159 +-
 ...6-05-31_019e7f57-3814-7572-a4ab-f649059f9b14.md |  517 +--
 ...6-05-31_019e7f57-871a-71d2-8eb5-2662044d89b6.md |  607 +--
 ...6-05-31_019e7f59-b4e2-7303-9a13-63ee370879ca.md |  299 +-
 ...6-05-31_019e7f62-78ff-7773-a075-7f29d6a5269f.md |  257 +-
 ...6-05-31_019e7fa0-bbf9-7033-ad99-00fd18019559.md |  386 +-
 SESSION_HANDOFF_CURRENT.md                         |   50 +-
 SESSION_HANDOFF_MASTER.md                          |    8 +-
 artifacts/api-server/package.json                  |    1 +
 artifacts/api-server/scripts/runUnitTests.mjs      |    5 +-
 .../scripts/sampleFlowPremiumDistribution.mjs      |   16 +-
 artifacts/api-server/src/lib/runtime.test.ts       |   32 +-
 artifacts/api-server/src/lib/runtime.ts            |   52 +-
 artifacts/api-server/src/lib/values.ts             |    2 +-
 artifacts/api-server/src/providers/ibkr/client.ts  |    4 +-
 .../src/providers/polygon/market-data.test.ts      | 1025 -----
 .../src/providers/polygon/market-data.ts           | 4615 --------------------
 artifacts/api-server/src/routes/automation.ts      |   66 +-
 .../src/routes/platform-streams-source.test.ts     |   25 +
 artifacts/api-server/src/routes/platform.ts        |   71 +-
 .../src/services/account-positions.test.ts         |   46 +-
 artifacts/api-server/src/services/account.ts       |  206 +-
 .../src/services/algo-deployment-account.ts        |    3 +-
 .../api-server/src/services/automation.test.ts     |    4 +
 artifacts/api-server/src/services/automation.ts    |    2 +
 .../api-server/src/services/backend-settings.ts    |    2 +-
 artifacts/api-server/src/services/backtesting.ts   |   20 +-
 .../src/services/bridge-governor.test.ts           |   24 +-
 .../api-server/src/services/bridge-governor.ts     |    4 +-
 .../services/bridge-option-quote-stream.test.ts    |  391 +-
 .../src/services/bridge-option-quote-stream.ts     |  272 +-
 .../api-server/src/services/bridge-quote-stream.ts |   23 +-
 .../api-server/src/services/bridge-streams.ts      |   55 +-
 .../api-server/src/services/diagnostics.test.ts    |    6 +-
 .../src/services/flow-events-model.test.ts         |    6 +-
 .../api-server/src/services/flow-events-model.ts   |   12 +-
 .../src/services/flow-premium-distribution.test.ts |   57 +-
 artifacts/api-server/src/services/gex.test.ts      |  200 +-
 artifacts/api-server/src/services/gex.ts           |  172 +-
 .../src/services/historical-flow-events.test.ts    |   10 +-
 .../src/services/historical-flow-events.ts         |   14 +-
 .../src/services/ibkr-bridge-runtime.test.ts       |   13 +-
 .../api-server/src/services/ibkr-bridge-runtime.ts |    2 +-
 artifacts/api-server/src/services/ibkr-lanes.ts    |    8 +-
 .../src/services/ibkr-line-usage.test.ts           |  105 +-
 .../api-server/src/services/ibkr-line-usage.ts     |   77 +-
 .../src/services/market-data-admission.test.ts     |   59 +
 .../src/services/market-data-admission.ts          |   71 +-
 .../api-server/src/services/market-data-ingest.ts  |   26 +-
 .../api-server/src/services/market-data-store.ts   |    2 +-
 .../src/services/market-data-work-planner.test.ts  |   85 +-
 .../src/services/market-data-work-planner.ts       |  160 +-
 .../api-server/src/services/market-identity.ts     |    2 +-
 .../services/massive-stock-quote-stream.test.ts    |   47 +-
 .../src/services/massive-stock-quote-stream.ts     |  215 +-
 .../src/services/nasdaq-symbol-directory.ts        |    2 +-
 .../src/services/option-chain-batch.test.ts        |  467 +-
 .../src/services/option-metadata-store.ts          |   45 +-
 .../src/services/options-flow-scanner.test.ts      |  301 +-
 .../src/services/options-flow-scanner.ts           |    2 +-
 .../platform-massive-stock-routing.test.ts         |   10 +-
 .../src/services/platform-quote-snapshot.test.ts   |   12 +-
 .../src/services/platform-runtime-status.ts        |   68 +-
 .../src/services/platform-ticker-search.test.ts    |   20 +-
 artifacts/api-server/src/services/platform.ts      |  988 +++--
 .../src/services/polygon-delayed-stream.test.ts    |   22 -
 .../src/services/polygon-delayed-stream.ts         |  435 --
 .../src/services/resource-pressure.test.ts         |    4 +-
 .../api-server/src/services/resource-pressure.ts   |    2 +-
 .../src/services/route-admission.test.ts           |   54 +-
 .../api-server/src/services/route-admission.ts     |   32 +-
 .../src/services/runtime-diagnostics.test.ts       |  132 +-
 .../src/services/runtime-flight-recorder.test.ts   |    4 +-
 .../api-server/src/services/shadow-account.test.ts |   22 +-
 .../api-server/src/services/shadow-account.ts      |   61 +-
 .../api-server/src/services/signal-monitor.test.ts |  245 +-
 .../api-server/src/services/signal-monitor.ts      |  743 +++-
 .../src/services/signal-options-automation.test.ts |  212 +-
 .../src/services/signal-options-automation.ts      |  429 +-
 .../src/services/signal-options-worker.test.ts     |   58 +
 .../src/services/signal-options-worker.ts          |   70 +-
 .../api-server/src/services/sp500-constituents.ts  |    2 +-
 .../src/services/stock-aggregate-stream.test.ts    |  100 +-
 .../src/services/stock-aggregate-stream.ts         |  124 +-
 .../src/services/trade-monitor-worker.test.ts      |  149 +
 .../src/services/trade-monitor-worker.ts           |  370 +-
 .../api-server/src/services/volume-footprints.ts   |   14 +-
 .../src/services/watchlist-prewarm.test.ts         |   12 +-
 artifacts/api-server/src/ws/options-quotes.ts      |   45 +-
 artifacts/backtest-worker/src/index.ts             |    1 -
 artifacts/ibkr-bridge/src/tws-provider.test.ts     |    6 +
 artifacts/ibkr-bridge/src/work-scheduler.ts        |   12 +-
 .../docs/architecture/market-data-ingest-worker.md |   17 +-
 .../docs/architecture/modularization-tracker.md    |    2 +-
 artifacts/pyrus/e2e/algo-signal-row.spec.ts        |    4 +-
 .../pyrus/e2e/chart-hydration-startup.spec.ts      |    2 +-
 .../pyrus/e2e/diagnostics-chart-hydration.spec.ts  |    4 +-
 artifacts/pyrus/e2e/flow-layout.spec.ts            |   10 +-
 artifacts/pyrus/e2e/market-live-flow.spec.ts       |    6 +-
 artifacts/pyrus/e2e/market-premium-flow.spec.ts    |   18 +-
 artifacts/pyrus/e2e/market-responsive.spec.ts      |    8 +-
 artifacts/pyrus/e2e/memory-soak.spec.ts            |    2 +-
 artifacts/pyrus/e2e/platform-shell.spec.ts         |    6 +-
 artifacts/pyrus/e2e/render-policy.spec.ts          |    2 +-
 artifacts/pyrus/e2e/ticker-search.spec.ts          |    2 +-
 artifacts/pyrus/e2e/warmup-policy.spec.ts          |    2 +-
 artifacts/pyrus/package.json                       |    1 +
 artifacts/pyrus/scripts/runUnitTests.mjs           |    3 +
 .../pyrus/src/components/platform/BottomSheet.jsx  |    4 +-
 .../src/components/platform/DenseVirtualTable.jsx  |  136 +-
 .../platform/signal-language/SignalDots.jsx        |    7 +-
 .../platform/signal-language/thresholds.js         |    2 +-
 .../src/features/account/positionDisplayModel.js   |    2 +-
 .../features/account/positionDisplayModel.test.js  |    4 +-
 .../src/features/backtesting/BacktestingPanels.tsx |  201 +-
 .../pyrus/src/features/charting/ChartParityLab.tsx |   12 +-
 .../src/features/charting/ResearchChartFrame.tsx   |    6 +-
 .../src/features/charting/ResearchChartSurface.tsx |  648 ++-
 .../pyrus/src/features/charting/chartApiBars.js    |   24 +-
 .../src/features/charting/chartApiBars.test.js     |    8 +-
 .../src/features/charting/chartEvents.test.ts      |   22 +-
 .../features/charting/chartHydrationStats.test.ts  |    6 +-
 .../src/features/charting/flowChartEvents.test.ts  |    6 +-
 .../src/features/charting/marketSession.test.ts    |  162 +
 .../pyrus/src/features/charting/marketSession.ts   |  302 +-
 .../charting/useMassiveStockAggregateStream.ts     |    2 +-
 .../charting/useMassiveStreamedStockBars.test.ts   |   12 +-
 .../src/features/flow/ContractDetailInline.jsx     |    6 +-
 .../features/flow/FlowDistributionScannerPanel.jsx |    2 +-
 .../pyrus/src/features/flow/flowEventMapper.js     |    2 +-
 .../src/features/flow/flowEventMapper.test.js      |    2 +-
 .../pyrus/src/features/flow/flowPresentation.js    |    2 +-
 .../pyrus/src/features/gex/HeatmapColorLegend.jsx  |   38 +-
 .../pyrus/src/features/gex/gexDataWiring.test.js   |   43 +-
 artifacts/pyrus/src/features/gex/gexGlossary.js    |    2 +-
 artifacts/pyrus/src/features/gex/gexModel.js       |   19 +-
 artifacts/pyrus/src/features/gex/gexModel.test.js  |   10 +
 .../src/features/market/MarketActivityPanel.jsx    |    2 +-
 .../pyrus/src/features/market/MarketChartCell.jsx  |    1 +
 .../pyrus/src/features/market/MultiChartGrid.jsx   |    2 +-
 .../src/features/market/marketChartWiring.test.js  |    2 +-
 .../pyrus/src/features/platform/AppHeader.jsx      |    6 +-
 .../platform/HeaderBroadcastScrollerStack.jsx      |   31 +-
 .../src/features/platform/HeaderStatusCluster.jsx  |    3 +-
 .../features/platform/IbkrConnectionStatus.test.js |   14 +-
 .../src/features/platform/MobileMoreSheet.jsx      |    4 +-
 .../platform/PlatformAlgoMonitorSidebar.jsx        |    8 +-
 .../pyrus/src/features/platform/PlatformApp.jsx    |  376 +-
 .../src/features/platform/PlatformScreenRouter.jsx |   12 +-
 .../pyrus/src/features/platform/PlatformShell.jsx  |   53 +-
 .../src/features/platform/PlatformWatchlist.jsx    |    2 +-
 .../src/features/platform/appWorkScheduler.js      |   69 +-
 .../src/features/platform/appWorkScheduler.test.js |   38 +-
 .../src/features/platform/headerBroadcastModel.js  |    3 +-
 .../features/platform/headerBroadcastModel.test.js |   23 +-
 .../src/features/platform/ibkrPopoverModel.js      |   58 +-
 .../features/platform/marketFlowScannerConfig.js   |    6 +-
 .../platform/marketFlowScannerConfig.test.js       |    6 +-
 .../pyrus/src/features/platform/marketFlowStore.js |   41 +-
 .../src/features/platform/marketFlowStore.test.js  |   61 +-
 .../src/features/platform/memoryPressureModel.js   |   24 +-
 .../features/platform/memoryPressureModel.test.js  |   63 +-
 .../platform/memoryPressurePopoverModel.js         |   11 +-
 .../features/platform/platformRootSource.test.js   |  146 +-
 .../src/features/platform/runtimeControlModel.js   |  111 +-
 .../features/platform/runtimeControlModel.test.js  |   51 +
 .../pyrus/src/features/platform/screenRegistry.jsx |   42 +-
 .../src/features/platform/signalMatrixScheduler.js |  146 +-
 .../platform/signalMatrixScheduler.test.js         |  323 +-
 .../platform/tickerSearch/TickerSearch.jsx         |   23 +-
 .../src/features/platform/tradeFlowStore.test.js   |    4 +-
 .../src/features/platform/useLiveMarketFlow.js     |    6 +-
 .../features/platform/useMemoryPressureSignal.js   |    5 -
 .../pyrus/src/features/platform/watchlistModel.js  |   16 +-
 .../src/features/platform/watchlistModel.test.js   |   47 +-
 .../pyrus/src/features/research/lib/researchApi.js |    2 +-
 .../pyrus/src/features/signals/signalsRowModel.js  |  292 +-
 .../src/features/signals/signalsRowModel.test.js   |  186 +-
 .../pyrus/src/features/trade/TradeEquityPanel.jsx  |    6 +
 .../features/workers/analyticsWorkerApi.test.js    |    2 +-
 artifacts/pyrus/src/screens/AlgoScreen.jsx         |   32 +-
 artifacts/pyrus/src/screens/FlowScreen.jsx         |    4 +-
 artifacts/pyrus/src/screens/GexScreen.jsx          |  677 ++-
 artifacts/pyrus/src/screens/SettingsScreen.jsx     |   15 +-
 artifacts/pyrus/src/screens/SignalsScreen.jsx      | 1990 ++++++++-
 artifacts/pyrus/src/screens/TradeScreen.jsx        |   20 +-
 .../src/screens/account/PositionsPanel.test.js     |    2 +-
 .../pyrus/src/screens/algo/AlgoAuditPanel.test.js  |   79 +
 .../pyrus/src/screens/algo/AlgoDiagnosticsTab.jsx  |    4 +-
 artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx  |    6 +-
 .../pyrus/src/screens/algo/OperationsSignalRow.jsx |  343 +-
 .../src/screens/algo/OperationsSignalRow.test.js   |   48 +-
 .../src/screens/algo/OperationsSignalTable.jsx     |  134 +-
 artifacts/pyrus/src/screens/algo/algoAuditModel.js |  179 +
 artifacts/pyrus/src/screens/algo/algoHelpers.js    |   33 +-
 .../pyrus/src/screens/algo/algoHelpers.test.js     |   34 +
 crates/market-data-worker/src/compute/gex.rs       |  202 +-
 crates/market-data-worker/src/config.rs            |    8 +-
 crates/market-data-worker/src/ingest.rs            |   22 +-
 crates/market-data-worker/src/main.rs              |   14 +-
 crates/market-data-worker/src/providers/massive.rs |  612 ++-
 crates/market-data-worker/src/providers/mod.rs     |    1 -
 crates/market-data-worker/src/providers/polygon.rs |  604 ---
 docs/plans/awesome-quant-pyrus-improvements.md     |   48 +-
 lib/api-client-react/src/generated/api.schemas.ts  |  101 +-
 lib/api-client-react/src/generated/api.ts          |    6 +-
 lib/api-spec/openapi.yaml                          |  143 +-
 lib/api-zod/src/generated/api.ts                   |  109 +-
 .../src/generated/types/accountAllocationBucket.ts |    2 +-
 .../generated/types/accountAllocationResponse.ts   |    2 +-
 .../src/generated/types/accountCashActivity.ts     |    2 +-
 .../generated/types/accountCashActivityResponse.ts |    2 +-
 .../src/generated/types/accountCashEvent.ts        |    2 +-
 .../generated/types/accountClosedTradesResponse.ts |    2 +-
 lib/api-zod/src/generated/types/accountDividend.ts |    2 +-
 .../types/accountEquityHistoryResponse.ts          |    2 +-
 .../accountEquityHistoryResponseSourceScope.ts     |    2 +-
 ...ountEquityHistoryResponseTerminalPointSource.ts |    2 +-
 .../src/generated/types/accountEquityPoint.ts      |    2 +-
 .../generated/types/accountEquityPointSource.ts    |    2 +-
 .../src/generated/types/accountExposureSummary.ts  |    2 +-
 lib/api-zod/src/generated/types/accountFx.ts       |    2 +-
 lib/api-zod/src/generated/types/accountFxRates.ts  |    2 +-
 .../src/generated/types/accountHistoryRange.ts     |    2 +-
 lib/api-zod/src/generated/types/accountMetric.ts   |    2 +-
 .../src/generated/types/accountMetricSource.ts     |    2 +-
 lib/api-zod/src/generated/types/accountOrder.ts    |    2 +-
 .../src/generated/types/accountOrderSourceType.ts  |    2 +-
 .../src/generated/types/accountOrdersResponse.ts   |    2 +-
 .../generated/types/accountOrdersResponseDebug.ts  |    2 +-
 .../generated/types/accountOrdersResponseTab.ts    |    2 +-
 .../generated/types/accountPositionDateActivity.ts |    2 +-
 .../src/generated/types/accountPositionLot.ts      |    2 +-
 .../generated/types/accountPositionRiskOverlay.ts  |    5 +-
 .../src/generated/types/accountPositionRow.ts      |    2 +-
 .../types/accountPositionRowAttributionStatus.ts   |    2 +-
 .../types/accountPositionRowAutomationContext.ts   |    2 +-
 .../types/accountPositionRowSourceType.ts          |    2 +-
 .../types/accountPositionsAtDateResponse.ts        |    2 +-
 .../types/accountPositionsAtDateResponseStatus.ts  |    2 +-
 .../generated/types/accountPositionsResponse.ts    |    2 +-
 .../src/generated/types/accountRiskResponse.ts     |    2 +-
 .../src/generated/types/accountSummaryAccount.ts   |    2 +-
 .../src/generated/types/accountSummaryMetrics.ts   |    2 +-
 .../src/generated/types/accountSummaryResponse.ts  |    2 +-
 lib/api-zod/src/generated/types/accountTrade.ts    |    2 +-
 .../src/generated/types/accountTradeFilterState.ts |    2 +-
 .../src/generated/types/accountTradeMetadata.ts    |    2 +-
 .../generated/types/accountTradeOptionContract.ts  |    2 +-
 .../src/generated/types/accountTradeOptionRight.ts |    2 +-
 .../types/accountTradeSelectedContract.ts          |    2 +-
 .../src/generated/types/accountTradeSource.ts      |    2 +-
 .../src/generated/types/accountTradeSourceType.ts  |    2 +-
 .../src/generated/types/accountsResponse.ts        |    2 +-
 .../generated/types/algoCockpitAttentionItem.ts    |    2 +-
 .../types/algoCockpitAttentionItemSeverity.ts      |    2 +-
 .../src/generated/types/algoCockpitFleetSummary.ts |    2 +-
 .../generated/types/algoCockpitPipelineStage.ts    |    2 +-
 .../algoCockpitPipelineStageActiveScanPhase.ts     |    2 +-
 .../generated/types/algoCockpitPipelineStageId.ts  |    2 +-
 .../types/algoCockpitPipelineStageStatus.ts        |    2 +-
 .../src/generated/types/algoCockpitReadiness.ts    |    2 +-
 .../generated/types/algoCockpitSnapshotResponse.ts |    2 +-
 .../generated/types/algoCockpitSourceBacktest.ts   |    2 +-
 lib/api-zod/src/generated/types/algoDeployment.ts  |    2 +-
 .../src/generated/types/algoDeploymentsResponse.ts |    2 +-
 lib/api-zod/src/generated/types/assetClass.ts      |    2 +-
 .../src/generated/types/backtestChartBar.ts        |    2 +-
 .../src/generated/types/backtestChartBarRange.ts   |    2 +-
 .../src/generated/types/backtestChartMarker.ts     |    2 +-
 .../generated/types/backtestChartMarkerPosition.ts |    2 +-
 .../generated/types/backtestChartMarkerShape.ts    |    2 +-
 .../src/generated/types/backtestComparisonBadge.ts |    2 +-
 .../types/backtestComparisonBadgeFormat.ts         |    2 +-
 .../types/backtestComparisonBadgeWinner.ts         |    2 +-
 .../src/generated/types/backtestDatasetRef.ts      |    2 +-
 .../src/generated/types/backtestDirectionMode.ts   |    2 +-
 .../types/backtestDraftStrategiesResponse.ts       |    2 +-
 .../src/generated/types/backtestDraftStrategy.ts   |    2 +-
 .../generated/types/backtestDraftStrategyConfig.ts |    2 +-
 .../generated/types/backtestEquitySeriesPoint.ts   |    2 +-
 .../generated/types/backtestExecutionProfile.ts    |    2 +-
 .../src/generated/types/backtestIndicatorEvent.ts  |    2 +-
 .../generated/types/backtestIndicatorEventMeta.ts  |    2 +-
 .../types/backtestIndicatorMarkerPayload.ts        |    2 +-
 ...cktestIndicatorMarkerPayloadMarkersByTradeId.ts |    2 +-
 .../src/generated/types/backtestIndicatorWindow.ts |    2 +-
 .../types/backtestIndicatorWindowDirection.ts      |    2 +-
 .../generated/types/backtestIndicatorWindowMeta.ts |    2 +-
 .../src/generated/types/backtestIndicatorZone.ts   |    2 +-
 .../generated/types/backtestIndicatorZoneMeta.ts   |    2 +-
 .../src/generated/types/backtestJobStatus.ts       |    2 +-
 .../src/generated/types/backtestJobSummary.ts      |    2 +-
 .../src/generated/types/backtestJobsResponse.ts    |    2 +-
 lib/api-zod/src/generated/types/backtestMetrics.ts |    2 +-
 .../src/generated/types/backtestOptimizerMode.ts   |    2 +-
 .../generated/types/backtestParameterDefinition.ts |    2 +-
 .../types/backtestParameterDefinitionType.ts       |    2 +-
 lib/api-zod/src/generated/types/backtestPoint.ts   |    2 +-
 .../src/generated/types/backtestPortfolioRules.ts  |    2 +-
 .../src/generated/types/backtestRunChart.ts        |    2 +-
 .../types/backtestRunChartChartPriceContext.ts     |    2 +-
 .../backtestRunChartDefaultVisibleLogicalRange.ts  |    2 +-
 .../src/generated/types/backtestRunDetail.ts       |    2 +-
 .../src/generated/types/backtestRunSummary.ts      |    2 +-
 .../src/generated/types/backtestRunsResponse.ts    |    2 +-
 .../generated/types/backtestStrategiesResponse.ts  |    2 +-
 .../generated/types/backtestStrategyCatalogItem.ts |    2 +-
 ...backtestStrategyCatalogItemDefaultParameters.ts |    2 +-
 .../src/generated/types/backtestStrategyStatus.ts  |    2 +-
 .../src/generated/types/backtestStudiesResponse.ts |    2 +-
 .../src/generated/types/backtestStudyInput.ts      |    2 +-
 .../types/backtestStudyInputOptimizerConfig.ts     |    2 +-
 .../types/backtestStudyInputParameters.ts          |    2 +-
 .../generated/types/backtestStudyPreviewChart.ts   |    2 +-
 .../src/generated/types/backtestStudyRecord.ts     |    2 +-
 .../types/backtestStudyRecordOptimizerConfig.ts    |    2 +-
 .../types/backtestStudyRecordParameters.ts         |    2 +-
 .../src/generated/types/backtestSweepDetail.ts     |    2 +-
 .../src/generated/types/backtestSweepDimension.ts  |    2 +-
 .../generated/types/backtestTimeToTradeIdsEntry.ts |    2 +-
 lib/api-zod/src/generated/types/backtestTrade.ts   |    2 +-
 .../generated/types/backtestTradeDiagnostics.ts    |    2 +-
 .../types/backtestTradeExitConsequences.ts         |    2 +-
 .../generated/types/backtestTradeInstrumentType.ts |    2 +-
 .../generated/types/backtestTradeMarkerGroup.ts    |    2 +-
 .../generated/types/backtestTradeMarkerGroupDir.ts |    2 +-
 .../types/backtestTradeMarkerGroupKind.ts          |    2 +-
 .../generated/types/backtestTradeMarkerGroups.ts   |    2 +-
 .../generated/types/backtestTradeOptionContract.ts |    2 +-
 .../src/generated/types/backtestTradeOverlay.ts    |    2 +-
 .../types/backtestTradeOverlayChartPriceContext.ts |    2 +-
 .../src/generated/types/backtestTradeOverlayDir.ts |    2 +-
 .../generated/types/backtestTradePricingMode.ts    |    2 +-
 .../types/backtestTradeReasonTraceStep.ts          |    2 +-
 .../types/backtestTradeReasonTraceStepEmphasis.ts  |    2 +-
 .../types/backtestTradeReasonTraceStepKind.ts      |    2 +-
 .../generated/types/backtestTradeSelectionFocus.ts |    2 +-
 ...cktestTradeSelectionFocusVisibleLogicalRange.ts |    2 +-
 .../generated/types/backtestTradeThresholdPath.ts  |    2 +-
 .../types/backtestTradeThresholdSegment.ts         |    2 +-
 .../types/backtestTradeThresholdSegmentKind.ts     |    2 +-
 .../types/backtestTradeThresholdSegmentStyle.ts    |    2 +-
 lib/api-zod/src/generated/types/bar.ts             |    2 +-
 lib/api-zod/src/generated/types/barDataSource.ts   |    2 +-
 .../src/generated/types/barMarketDataMode.ts       |    2 +-
 lib/api-zod/src/generated/types/barTimeframe.ts    |    2 +-
 lib/api-zod/src/generated/types/barsHistoryPage.ts |    2 +-
 .../generated/types/barsHistoryPageCacheStatus.ts  |    2 +-
 .../types/barsHistoryPageHydrationStatus.ts        |    2 +-
 lib/api-zod/src/generated/types/barsResponse.ts    |    2 +-
 .../generated/types/barsResponseMarketDataMode.ts  |    2 +-
 .../generated/types/benchmarkFlowScannerBody.ts    |    2 +-
 .../benchmarkFlowScannerBodyStrikeCoverage.ts      |    2 +-
 lib/api-zod/src/generated/types/brokerAccount.ts   |    2 +-
 .../src/generated/types/brokerConnection.ts        |    2 +-
 .../generated/types/brokerConnectionProvider.ts    |    2 +-
 .../generated/types/brokerConnectionsResponse.ts   |    2 +-
 lib/api-zod/src/generated/types/brokerProvider.ts  |    2 +-
 .../generated/types/brokerTradingReadinessState.ts |    2 +-
 .../generated/types/cancelAccountOrderRequest.ts   |    2 +-
 .../src/generated/types/cancelOrderRequest.ts      |    2 +-
 .../src/generated/types/cancelOrderResponse.ts     |    2 +-
 .../src/generated/types/chartBarTimeframe.ts       |    2 +-
 .../src/generated/types/connectionStatus.ts        |    2 +-
 .../generated/types/createAlgoDeploymentRequest.ts |    2 +-
 .../generated/types/createBacktestRunRequest.ts    |    2 +-
 .../types/createBacktestRunRequestParameters.ts    |    2 +-
 .../generated/types/createBacktestSweepRequest.ts  |    2 +-
 .../createBacktestSweepRequestBaseParameters.ts    |    2 +-
 .../src/generated/types/createPineScriptRequest.ts |    2 +-
 .../types/createPineScriptRequestMetadata.ts       |    2 +-
 .../src/generated/types/createWatchlistRequest.ts  |    2 +-
 .../types/diagnosticClientEventRequest.ts          |    2 +-
 lib/api-zod/src/generated/types/diagnosticEvent.ts |    2 +-
 .../types/diagnosticEventDetailResponse.ts         |    2 +-
 .../types/diagnosticEventRecordResponse.ts         |    2 +-
 .../src/generated/types/diagnosticEventStatus.ts   |    2 +-
 .../generated/types/diagnosticEventsResponse.ts    |    2 +-
 .../generated/types/diagnosticExportResponse.ts    |    2 +-
 .../src/generated/types/diagnosticHistoryPoint.ts  |    2 +-
 .../generated/types/diagnosticHistoryResponse.ts   |    2 +-
 .../src/generated/types/diagnosticSeverity.ts      |    2 +-
 .../src/generated/types/diagnosticSnapshot.ts      |    2 +-
 .../src/generated/types/diagnosticStatus.ts        |    2 +-
 .../src/generated/types/diagnosticThreshold.ts     |    2 +-
 .../types/diagnosticThresholdsResponse.ts          |    2 +-
 .../types/diagnosticThresholdsUpdateRequest.ts     |    2 +-
 ...gnosticThresholdsUpdateRequestThresholdsItem.ts |    2 +-
 .../generated/types/diagnosticsLatestResponse.ts   |    2 +-
 .../generated/types/enableAlgoDeploymentParams.ts  |    2 +-
 .../generated/types/enableAlgoDeploymentView.ts    |    2 +-
 ...nsureDefaultSignalOptionsPaperDeploymentBody.ts |    2 +-
 lib/api-zod/src/generated/types/environmentMode.ts |    2 +-
 .../types/evaluateSignalMonitorMatrixRequest.ts    |    2 +-
 ...evaluateSignalMonitorMatrixRequestClientRole.ts |    2 +-
 ...luateSignalMonitorMatrixRequestRequestOrigin.ts |    2 +-
 .../types/evaluateSignalMonitorRequest.ts          |    2 +-
 .../types/evaluateSignalMonitorRequestMode.ts      |    2 +-
 lib/api-zod/src/generated/types/executionEvent.ts  |    2 +-
 .../src/generated/types/executionEventsResponse.ts |    2 +-
 .../src/generated/types/exportDiagnosticsParams.ts |    2 +-
 .../src/generated/types/flexHealthResponse.ts      |    2 +-
 .../src/generated/types/flexTestResponse.ts        |    2 +-
 .../src/generated/types/flowDataProvider.ts        |    4 +-
 lib/api-zod/src/generated/types/flowEvent.ts       |    2 +-
 lib/api-zod/src/generated/types/flowEventBasis.ts  |    2 +-
 .../src/generated/types/flowEventConfidence.ts     |    2 +-
 .../src/generated/types/flowEventMoneyness.ts      |    2 +-
 .../src/generated/types/flowEventSourceBasis.ts    |    2 +-
 .../src/generated/types/flowEventsResponse.ts      |    2 +-
 .../src/generated/types/flowEventsSource.ts        |    2 +-
 .../generated/types/flowEventsSourceIbkrStatus.ts  |    2 +-
 .../generated/types/flowEventsSourceProvider.ts    |    4 +-
 .../types/flowEventsSourceScannerCoverage.ts       |    2 +-
 ...flowEventsSourceScannerCoverageLastScannedAt.ts |    2 +-
 .../types/flowEventsSourceScannerCoverageMode.ts   |    2 +-
 .../types/flowEventsSourceScannerPhase.ts          |    2 +-
 .../types/flowEventsSourceScannerStrikeCoverage.ts |    2 +-
 .../src/generated/types/flowEventsSourceStatus.ts  |    2 +-
 .../types/flowEventsSourceUnderlyingSpotSource.ts  |    2 +-
 .../types/flowPremiumDistributionBucket.ts         |    2 +-
 .../flowPremiumDistributionBucketThresholds.ts     |    2 +-
 .../types/flowPremiumDistributionBuckets.ts        |    2 +-
 ...wPremiumDistributionClassificationConfidence.ts |    2 +-
 .../flowPremiumDistributionHydrationDiagnostics.ts |    2 +-
 ...ributionHydrationDiagnosticsQuoteProbeStatus.ts |    2 +-
 .../types/flowPremiumDistributionResponse.ts       |    2 +-
 .../types/flowPremiumDistributionResponseStatus.ts |    2 +-
 .../flowPremiumDistributionResponseTimeframe.ts    |    2 +-
 .../types/flowPremiumDistributionSource.ts         |    2 +-
 .../types/flowPremiumDistributionSourceCache.ts    |    2 +-
 .../flowPremiumDistributionSourceCoverageMode.ts   |    2 +-
 ...flowPremiumDistributionSourceHydrationStatus.ts |    2 +-
 .../types/flowPremiumDistributionSourceProvider.ts |    4 +-
 .../flowPremiumDistributionSourceQuoteAccess.ts    |    2 +-
 .../flowPremiumDistributionSourceSideBasis.ts      |    2 +-
 .../flowPremiumDistributionSourceTimeframe.ts      |    2 +-
 .../flowPremiumDistributionSourceTradeAccess.ts    |    2 +-
 .../types/flowPremiumDistributionWidget.ts         |    2 +-
 .../flowPremiumDistributionWidgetConfidence.ts     |    2 +-
 .../flowPremiumDistributionWidgetMarketCapTier.ts  |    2 +-
 .../flowPremiumDistributionWidgetQuoteAccess.ts    |    2 +-
 .../flowPremiumDistributionWidgetSideBasis.ts      |    2 +-
 .../types/flowPremiumDistributionWidgetSource.ts   |    4 +-
 .../flowPremiumDistributionWidgetTimeframe.ts      |    2 +-
 .../flowPremiumDistributionWidgetTradeAccess.ts    |    2 +-
 lib/api-zod/src/generated/types/flowSentiment.ts   |    2 +-
 .../src/generated/types/flowUniverseCoverage.ts    |    2 +-
 .../types/flowUniverseCoverageLastScannedAt.ts     |    2 +-
 .../generated/types/flowUniverseCoverageMode.ts    |    2 +-
 .../src/generated/types/flowUniverseResponse.ts    |    2 +-
 .../src/generated/types/flowUniverseSources.ts     |    2 +-
 lib/api-zod/src/generated/types/footprintCandle.ts |    2 +-
 .../src/generated/types/footprintDiagnostics.ts    |    2 +-
 .../footprintDiagnosticsClassificationMethod.ts    |    2 +-
 .../types/footprintDiagnosticsMinTickSource.ts     |    2 +-
 .../types/footprintDiagnosticsSourceProvider.ts    |    3 +-
 lib/api-zod/src/generated/types/footprintLevel.ts  |    2 +-
 .../src/generated/types/footprintPartialReason.ts  |    2 +-
 .../src/generated/types/footprintResponse.ts       |    2 +-
 .../generated/types/footprintSourcePreference.ts   |    2 +-
 .../src/generated/types/footprintTimeframe.ts      |    2 +-
 .../generated/types/getAccountAllocationParams.ts  |    2 +-
 .../types/getAccountCashActivityParams.ts          |    2 +-
 .../types/getAccountClosedTradesParams.ts          |    2 +-
 .../types/getAccountClosedTradesPnlSign.ts         |    2 +-
 .../types/getAccountEquityHistoryParams.ts         |    2 +-
 .../src/generated/types/getAccountOrdersParams.ts  |    2 +-
 .../src/generated/types/getAccountOrdersTab.ts     |    2 +-
 .../types/getAccountPositionsAtDateParams.ts       |    2 +-
 .../generated/types/getAccountPositionsParams.ts   |    2 +-
 .../src/generated/types/getAccountRiskParams.ts    |    2 +-
 .../src/generated/types/getAccountSummaryParams.ts |    2 +-
 .../generated/types/getBacktestRunChartParams.ts   |    2 +-
 lib/api-zod/src/generated/types/getBarsParams.ts   |    8 +-
 .../getFlowPremiumDistributionCoverageMode.ts      |    2 +-
 .../types/getFlowPremiumDistributionParams.ts      |    4 +-
 .../types/getFlowPremiumDistributionTimeframe.ts   |    2 +-
 .../src/generated/types/getFootprintsParams.ts     |    2 +-
 .../src/generated/types/getMarketDepth200.ts       |    2 +-
 .../src/generated/types/getMarketDepthParams.ts    |    2 +-
 lib/api-zod/src/generated/types/getNewsParams.ts   |    2 +-
 .../src/generated/types/getOptionChainParams.ts    |    2 +-
 .../generated/types/getOptionChartBarsParams.ts    |    2 +-
 .../generated/types/getOptionExpirationsParams.ts  |    2 +-
 .../src/generated/types/getQuoteSnapshotsParams.ts |    2 +-
 .../types/getResearchEarningsCalendarParams.ts     |    2 +-
 .../generated/types/getResearchFinancialsParams.ts |    2 +-
 .../types/getResearchFundamentalsParams.ts         |    2 +-
 .../generated/types/getResearchSecFilingsParams.ts |    2 +-
 .../generated/types/getResearchSnapshotsParams.ts  |    2 +-
 .../generated/types/getResearchTranscriptParams.ts |    2 +-
 .../types/getResearchTranscriptsParams.ts          |    2 +-
 .../types/getSignalMonitorProfileParams.ts         |    2 +-
 .../generated/types/getSignalMonitorStateParams.ts |    2 +-
 .../src/generated/types/getUniverseLogosParams.ts  |    2 +-
 .../src/generated/types/gexDashboardResponse.ts    |    2 +-
 .../types/gexDashboardResponseFlowContextStatus.ts |    2 +-
 .../types/gexFlowClassificationBasisCounts.ts      |    2 +-
 .../types/gexFlowClassificationConfidenceCounts.ts |    2 +-
 lib/api-zod/src/generated/types/gexFlowContext.ts  |    2 +-
 lib/api-zod/src/generated/types/gexOptionRow.ts    |    2 +-
 lib/api-zod/src/generated/types/gexOptionRowCp.ts  |    2 +-
 lib/api-zod/src/generated/types/gexProfile.ts      |    2 +-
 lib/api-zod/src/generated/types/gexSnapshot.ts     |    2 +-
 lib/api-zod/src/generated/types/gexSource.ts       |    4 +-
 .../src/generated/types/gexSourceFlowStatus.ts     |    2 +-
 .../src/generated/types/gexSourceProvider.ts       |    3 +-
 lib/api-zod/src/generated/types/gexSourceStatus.ts |    2 +-
 .../src/generated/types/gexTickerDetails.ts        |    2 +-
 lib/api-zod/src/generated/types/healthStatus.ts    |    2 +-
 .../src/generated/types/healthStatusStatus.ts      |    2 +-
 .../types/ibkrBridgeActivationCancelResponse.ts    |    2 +-
 .../types/ibkrBridgeActivationProgress.ts          |    2 +-
 .../types/ibkrBridgeActivationStatusResponse.ts    |    2 +-
 .../generated/types/ibkrBridgeAttachResponse.ts    |    2 +-
 .../generated/types/ibkrBridgeConnectionHealth.ts  |    2 +-
 .../ibkrBridgeConnectionHealthMarketDataMode.ts    |    2 +-
 .../types/ibkrBridgeConnectionHealthRole.ts        |    2 +-
 .../types/ibkrBridgeConnectionHealthStreamState.ts |    2 +-
 .../types/ibkrBridgeConnectionHealthTransport.ts   |    2 +-
 .../generated/types/ibkrBridgeConnectionsHealth.ts |    2 +-
 .../generated/types/ibkrBridgeCredentialHandoff.ts |    2 +-
 .../types/ibkrBridgeCredentialHandoffAlgorithm.ts  |    2 +-
 .../types/ibkrBridgeCredentialHandoffMode.ts       |    2 +-
 .../generated/types/ibkrBridgeDetachResponse.ts    |    2 +-
 .../src/generated/types/ibkrBridgeHealth.ts        |    2 +-
 .../types/ibkrBridgeHealthMarketDataMode.ts        |    2 +-
 .../generated/types/ibkrBridgeHealthStreamState.ts |    2 +-
 .../generated/types/ibkrBridgeHealthTransport.ts   |    2 +-
 .../generated/types/ibkrBridgeLauncherResponse.ts  |    2 +-
 .../ibkrBridgeLauncherResponseAutoLoginMode.ts     |    2 +-
 .../types/ibkrBridgeLoginEnvelopeClaimResponse.ts  |    2 +-
 ...ibkrBridgeLoginEnvelopeClaimResponseEnvelope.ts |    2 +-
 ...eLoginEnvelopeClaimResponseEnvelopeAlgorithm.ts |    2 +-
 .../types/ibkrBridgeLoginKeyReadResponse.ts        |    2 +-
 .../ibkrBridgeLoginKeyReadResponseAlgorithm.ts     |    2 +-
 .../src/generated/types/ibkrBridgeRemoteLaunch.ts  |    2 +-
 .../generated/types/ibkrBridgeRemoteLaunchMode.ts  |    2 +-
 .../types/ibkrBridgeRemoteLauncherResponse.ts      |    2 +-
 .../generated/types/ibkrBridgeRemoteShutdown.ts    |    2 +-
 .../types/ibkrBridgeRemoteShutdownAction.ts        |    2 +-
 .../types/ibkrBridgeRemoteShutdownMode.ts          |    2 +-
 .../types/ibkrBridgeRemoteShutdownResponse.ts      |    2 +-
 .../src/generated/types/ibkrRemoteDesktop.ts       |    2 +-
 .../types/ibkrRemoteDesktopHeartbeatResponse.ts    |    2 +-
 .../types/ibkrRemoteDesktopJobStatusResponse.ts    |    2 +-
 .../ibkrRemoteDesktopJobStatusResponseAction.ts    |    2 +-
 .../ibkrRemoteDesktopJobStatusResponseState.ts     |    2 +-
 .../types/ibkrRemoteDesktopLaunchClaimResponse.ts  |    2 +-
 .../ibkrRemoteDesktopLaunchClaimResponseAction.ts  |    2 +-
 .../types/ibkrRemoteDesktopRegisterResponse.ts     |    2 +-
 .../generated/types/ibkrRemoteDesktopsResponse.ts  |    2 +-
 lib/api-zod/src/generated/types/index.ts           |    9 +-
 lib/api-zod/src/generated/types/jsonObject.ts      |    2 +-
 .../src/generated/types/listAccountsParams.ts      |    2 +-
 .../types/listAggregateFlowEventsParams.ts         |    2 +-
 .../types/listAggregateFlowEventsScope.ts          |    2 +-
 .../generated/types/listAlgoDeploymentsParams.ts   |    2 +-
 .../src/generated/types/listBacktestRunsParams.ts  |    2 +-
 .../generated/types/listDiagnosticEventsParams.ts  |    2 +-
 .../generated/types/listDiagnosticHistoryParams.ts |    2 +-
 .../generated/types/listExecutionEventsParams.ts   |    2 +-
 .../src/generated/types/listExecutions200.ts       |    2 +-
 .../src/generated/types/listExecutionsParams.ts    |    2 +-
 .../src/generated/types/listFlowEventsParams.ts    |    6 +-
 .../src/generated/types/listFlowEventsScope.ts     |    2 +-
 .../src/generated/types/listOrdersParams.ts        |    2 +-
 .../src/generated/types/listPositionsParams.ts     |    2 +-
 .../types/listSignalMonitorEventsParams.ts         |    2 +-
 .../src/generated/types/marketDataFreshness.ts     |    2 +-
 .../src/generated/types/marketDataProvider.ts      |    3 +-
 lib/api-zod/src/generated/types/newsArticle.ts     |    2 +-
 lib/api-zod/src/generated/types/newsPublisher.ts   |    2 +-
 lib/api-zod/src/generated/types/newsResponse.ts    |    2 +-
 lib/api-zod/src/generated/types/okResponse.ts      |    2 +-
 .../src/generated/types/optionChainBatchRequest.ts |    2 +-
 .../generated/types/optionChainBatchResponse.ts    |    2 +-
 .../src/generated/types/optionChainBatchResult.ts  |    2 +-
 .../types/optionChainBatchResultStatus.ts          |    2 +-
 .../src/generated/types/optionChainQuote.ts        |    2 +-
 .../generated/types/optionChainQuoteHydration.ts   |    2 +-
 .../types/optionChainQuoteMarketDataMode.ts        |    2 +-
 .../src/generated/types/optionChainResponse.ts     |    2 +-
 .../generated/types/optionChainStrikeCoverage.ts   |    2 +-
 .../generated/types/optionChartBarsDataSource.ts   |    4 +-
 .../types/optionChartBarsResolutionSource.ts       |    2 +-
 .../src/generated/types/optionChartBarsResponse.ts |    2 +-
 lib/api-zod/src/generated/types/optionContract.ts  |    2 +-
 .../types/optionContractResolutionResponse.ts      |    2 +-
 .../types/optionContractResolutionStatus.ts        |    2 +-
 .../src/generated/types/optionExpirationSummary.ts |    2 +-
 .../generated/types/optionExpirationsResponse.ts   |    2 +-
 .../generated/types/optionOrderPositionEffect.ts   |    2 +-
 .../generated/types/optionOrderStrategyIntent.ts   |    2 +-
 .../generated/types/optionQuoteSnapshotsRequest.ts |    2 +-
 .../types/optionQuoteSnapshotsRequestIntent.ts     |    2 +-
 .../types/optionQuoteSnapshotsResponse.ts          |    2 +-
 lib/api-zod/src/generated/types/optionRight.ts     |    2 +-
 lib/api-zod/src/generated/types/order.ts           |    2 +-
 lib/api-zod/src/generated/types/orderPreview.ts    |    2 +-
 lib/api-zod/src/generated/types/orderSide.ts       |    2 +-
 lib/api-zod/src/generated/types/orderStatus.ts     |    2 +-
 lib/api-zod/src/generated/types/orderType.ts       |    2 +-
 lib/api-zod/src/generated/types/ordersResponse.ts  |    2 +-
 .../src/generated/types/ordersResponseDebug.ts     |    2 +-
 .../generated/types/pauseAlgoDeploymentParams.ts   |    2 +-
 .../src/generated/types/pauseAlgoDeploymentView.ts |    2 +-
 .../src/generated/types/pineScriptPaneType.ts      |    2 +-
 .../src/generated/types/pineScriptRecord.ts        |    2 +-
 .../generated/types/pineScriptRecordMetadata.ts    |    2 +-
 .../src/generated/types/pineScriptStatus.ts        |    2 +-
 .../src/generated/types/pineScriptsResponse.ts     |    2 +-
 .../src/generated/types/placeOrderRequest.ts       |    2 +-
 .../src/generated/types/placeOrderRequestSource.ts |    2 +-
 lib/api-zod/src/generated/types/position.ts        |    2 +-
 .../src/generated/types/positionOpenedAtSource.ts  |    2 +-
 lib/api-zod/src/generated/types/positionQuote.ts   |    2 +-
 .../src/generated/types/positionQuoteSource.ts     |    2 +-
 .../src/generated/types/positionsResponse.ts       |    2 +-
 .../generated/types/promoteBacktestRunRequest.ts   |    2 +-
 .../src/generated/types/proxyUniverseLogoParams.ts |    2 +-
 lib/api-zod/src/generated/types/quoteSnapshot.ts   |    2 +-
 .../src/generated/types/quoteSnapshotLatency.ts    |    2 +-
 .../generated/types/quoteSnapshotMarketDataMode.ts |    2 +-
 .../src/generated/types/quoteSnapshotsResponse.ts  |    2 +-
 lib/api-zod/src/generated/types/quoteSource.ts     |    3 +-
 lib/api-zod/src/generated/types/readinessState.ts  |    2 +-
 lib/api-zod/src/generated/types/readinessStatus.ts |    2 +-
 .../generated/types/readinessStatusAppReadiness.ts |    2 +-
 ...adinessStatusAppReadinessDiagnosticsSeverity.ts |    2 +-
 ...readinessStatusAppReadinessDiagnosticsStatus.ts |    2 +-
 .../types/readinessStatusBrokerTradingReadiness.ts |    2 +-
 .../readinessStatusBrokerTradingReadinessChecks.ts |    2 +-
 .../src/generated/types/readinessStatusLiveness.ts |    2 +-
 .../types/readinessStatusLivenessStatus.ts         |    2 +-
 .../types/readinessStatusPressureLevel.ts          |    2 +-
 .../types/recordIbkrBridgeActivationProgress200.ts |    2 +-
 .../types/reorderWatchlistItemsRequest.ts          |    2 +-
 .../src/generated/types/replaceOrderRequest.ts     |    2 +-
 lib/api-zod/src/generated/types/requestDebug.ts    |    2 +-
 .../src/generated/types/requestDebugCacheStatus.ts |    2 +-
 .../generated/types/researchAnnualEarningsPoint.ts |    2 +-
 .../generated/types/researchBalanceSheetPeriod.ts  |    2 +-
 .../src/generated/types/researchCalendarEntry.ts   |    2 +-
 .../generated/types/researchCalendarResponse.ts    |    2 +-
 .../src/generated/types/researchCashFlowPeriod.ts  |    2 +-
 lib/api-zod/src/generated/types/researchFiling.ts  |    2 +-
 .../src/generated/types/researchFilingsResponse.ts |    2 +-
 .../src/generated/types/researchFinancials.ts      |    2 +-
 .../generated/types/researchFinancialsResponse.ts  |    2 +-
 .../src/generated/types/researchFundamentals.ts    |    2 +-
 .../types/researchFundamentalsResponse.ts          |    2 +-
 .../types/researchIncomeStatementPeriod.ts         |    2 +-
 .../src/generated/types/researchProvider.ts        |    2 +-
 .../generated/types/researchQuarterlyEpsPoint.ts   |    2 +-
 .../src/generated/types/researchRatiosPeriod.ts    |    2 +-
 .../src/generated/types/researchSnapshot.ts        |    2 +-
 .../generated/types/researchSnapshotsResponse.ts   |    2 +-
 lib/api-zod/src/generated/types/researchStatus.ts  |    2 +-
 .../generated/types/researchTranscriptResponse.ts  |    2 +-
 .../generated/types/researchTranscriptsResponse.ts |    2 +-
 .../types/resolveBacktestOptionContract200.ts      |    2 +-
 .../types/resolveBacktestOptionContractBody.ts     |    2 +-
 .../resolveBacktestOptionContractBodyRight.ts      |    2 +-
 .../generated/types/resolveOptionContractParams.ts |    2 +-
 .../types/runSignalOptionsShadowBackfillBody.ts    |    2 +-
 .../src/generated/types/runtimeApiDiagnostics.ts   |    2 +-
 .../generated/types/runtimeDiagnosticsResponse.ts  |    2 +-
 .../src/generated/types/runtimeIbkrDiagnostics.ts  |    2 +-
 .../types/runtimeIbkrDiagnosticsMarketDataMode.ts  |    2 +-
 .../types/runtimeIbkrDiagnosticsStreamState.ts     |    2 +-
 .../types/runtimeIbkrDiagnosticsTransport.ts       |    2 +-
 .../generated/types/runtimeMemoryDiagnostics.ts    |    2 +-
 .../types/runtimeOrderCapabilityDiagnostics.ts     |    2 +-
 .../generated/types/searchUniverseTickersMode.ts   |    2 +-
 .../generated/types/searchUniverseTickersParams.ts |    4 +-
 .../src/generated/types/sessionIbkrRuntime.ts      |    2 +-
 lib/api-zod/src/generated/types/sessionInfo.ts     |    2 +-
 .../src/generated/types/sessionInfoConfigured.ts   |    4 +-
 .../generated/types/sessionMarketDataProviders.ts  |    2 +-
 .../types/sessionMarketDataProvidersResearch.ts    |    2 +-
 lib/api-zod/src/generated/types/sessionRuntime.ts  |    2 +-
 .../src/generated/types/signalMonitorDirection.ts  |    2 +-
 .../src/generated/types/signalMonitorEvent.ts      |    2 +-
 .../generated/types/signalMonitorEventsResponse.ts |    2 +-
 .../generated/types/signalMonitorMatrixResponse.ts |    2 +-
 .../signalMonitorMatrixResponseCacheStatus.ts      |    2 +-
 .../types/signalMonitorMatrixResponseCoverage.ts   |    2 +-
 ...gnalMonitorMatrixResponseCoverageCacheStatus.ts |    2 +-
 ...lMonitorMatrixResponseCoverageSourceStrategy.ts |    2 +-
 .../generated/types/signalMonitorMatrixState.ts    |    4 +-
 .../types/signalMonitorMatrixTimeframe.ts          |    4 +-
 .../src/generated/types/signalMonitorProfile.ts    |    2 +-
 .../generated/types/signalMonitorStateResponse.ts  |    3 +-
 .../types/signalMonitorStateResponseCacheStatus.ts |    2 +-
 .../types/signalMonitorStateResponseStateSource.ts |    2 +-
 .../generated/types/signalMonitorSymbolState.ts    |    2 +-
 .../generated/types/signalMonitorSymbolStatus.ts   |    2 +-
 .../src/generated/types/signalMonitorTimeframe.ts  |    2 +-
 .../types/signalMonitorUniverseSummary.ts          |    2 +-
 .../types/signalMonitorUniverseSummaryMode.ts      |    2 +-
 .../types/signalMonitorUniverseSummarySource.ts    |    2 +-
 .../types/signalOptionsAutomationState.ts          |    2 +-
 .../types/signalOptionsAutomationStateMode.ts      |    2 +-
 .../types/signalOptionsExecutionProfile.ts         |    2 +-
 .../types/signalOptionsExecutionProfileMode.ts     |    2 +-
 .../types/signalOptionsExecutionProfileVersion.ts  |    2 +-
 .../types/signalOptionsManualDeviationRequest.ts   |    2 +-
 .../signalOptionsManualDeviationRequestSource.ts   |    2 +-
 .../types/signalOptionsManualDeviationResponse.ts  |    2 +-
 .../types/signalOptionsPerformanceResponse.ts      |    2 +-
 lib/api-zod/src/generated/types/sseStream.ts       |    2 +-
 .../types/stockAggregateStreamSessionResponse.ts   |    2 +-
 .../generated/types/streamAccountPageOrderTab.ts   |    2 +-
 .../src/generated/types/streamAccountPageParams.ts |    2 +-
 .../generated/types/streamAccountPagePnlSign.ts    |    2 +-
 .../src/generated/types/streamAccountsParams.ts    |    2 +-
 .../src/generated/types/streamBarsParams.ts        |    2 +-
 .../src/generated/types/streamExecutionsParams.ts  |    2 +-
 .../src/generated/types/streamFootprintsParams.ts  |    2 +-
 .../src/generated/types/streamMarketDepthParams.ts |    2 +-
 .../generated/types/streamOptionChainsParams.ts    |    2 +-
 .../types/streamOptionQuoteSnapshotsParams.ts      |    2 +-
 .../src/generated/types/streamOrdersParams.ts      |    2 +-
 .../generated/types/streamQuoteSnapshotsParams.ts  |    2 +-
 .../generated/types/streamStockAggregatesParams.ts |    2 +-
 .../src/generated/types/submitIbkrOrdersRequest.ts |    2 +-
 .../generated/types/submitIbkrOrdersResponse.ts    |    2 +-
 lib/api-zod/src/generated/types/timeInForce.ts     |    2 +-
 .../src/generated/types/transcriptDateEntry.ts     |    2 +-
 lib/api-zod/src/generated/types/transcriptEntry.ts |    2 +-
 lib/api-zod/src/generated/types/universeMarket.ts  |    2 +-
 lib/api-zod/src/generated/types/universeTicker.ts  |    2 +-
 .../generated/types/universeTickerContractMeta.ts  |    2 +-
 .../src/generated/types/universeTickersResponse.ts |    2 +-
 .../updateAlgoDeploymentStrategySettingsRequest.ts |    2 +-
 ...oymentStrategySettingsRequestBosConfirmation.ts |    2 +-
 ...updateAlgoDeploymentStrategySettingsResponse.ts |    2 +-
 .../src/generated/types/updatePineScriptRequest.ts |    2 +-
 .../types/updatePineScriptRequestMetadata.ts       |    2 +-
 .../types/updateSignalMonitorProfileRequest.ts     |    2 +-
 .../updateSignalOptionsExecutionProfileResponse.ts |    2 +-
 .../types/updateStockAggregateStreamSymbolsBody.ts |    2 +-
 .../src/generated/types/updateWatchlistRequest.ts  |    2 +-
 lib/api-zod/src/generated/types/watchlist.ts       |    2 +-
 lib/api-zod/src/generated/types/watchlistItem.ts   |    2 +-
 .../src/generated/types/watchlistSymbolRequest.ts  |    2 +-
 .../src/generated/types/watchlistsResponse.ts      |    2 +-
 lib/backtest-core/src/index.ts                     |    2 +
 lib/backtest-core/src/signal-options.test.ts       |   45 +
 lib/backtest-core/src/signal-options.ts            |   88 +
 lib/db/migrations/20260529_market_data_ingest.sql  |   12 +-
 lib/db/src/index.ts                                |    4 +
 lib/db/src/pool-error-handler.test.ts              |   40 +
 lib/db/src/pool-error-handler.ts                   |   71 +
 lib/db/src/schema/enums.ts                         |    2 +-
 lib/db/src/schema/flow.ts                          |    4 +-
 lib/db/src/schema/instruments.ts                   |    4 +-
 lib/db/src/schema/market-data.ts                   |   11 +-
 lib/ibkr-contracts/src/client.ts                   |    4 +-
 lib/ibkr-contracts/src/runtime.ts                  |    2 +-
 pnpm-lock.yaml                                     |   12 +
 scripts/README.md                                  |   16 +-
 scripts/package.json                               |    4 +-
 scripts/src/hydrate-universe-catalog-ibkr.ts       |    2 +-
 scripts/src/market-data-schema-audit.ts            |    1 +
 scripts/src/shadow-options-management-review.ts    |    2 +-
 scripts/src/shadow-polygon-options-audit.ts        |  958 ----
 .../src/signal-options-exit-policy-sweep.test.ts   |  155 +
 scripts/src/signal-options-exit-policy-sweep.ts    |  212 +-
 scripts/src/sync-listed-universe.ts                |    2 +-
 scripts/src/sync-nasdaq-listed-universe.ts         |    2 +-
 scripts/src/sync-sp500-universe.ts                 |    2 +-
 scripts/src/sync-universe-catalog.ts               |   12 +-
 scripts/windows/pyrus-ibkr-helper.ps1              |   51 +-
 tsconfig.json                                      |    3 +
 780 files changed, 15847 insertions(+), 12491 deletions(-)
```

## Validations Detected In Transcript

- None detected in this session transcript.

## What Changed This Session

- Restored D-session scope from `SESSION_HANDOFF_2026-06-01_019e8366-b25f-7921-bbd5-2bfc17403296.md`.
- Patched `scripts/windows/pyrus-ibkr-helper.ps1` so `Wait-IBGatewayWindow` no longer falls back to typing into a generic/empty-title Gateway process after `AppActivate`; it now requires a confirmed credential window before returning control to autologin. Added source assertions in `artifacts/api-server/src/services/ibkr-bridge-runtime.test.ts`.
- Added signal-options candidate contract-selection diagnostics in `artifacts/api-server/src/services/signal-options-automation.ts`: after metadata contract resolution, before live quote hydration, it emits non-ledger `signal_options_candidate_created` without canonical `signalKey`, so cockpit can show selected contracts without suppressing future retries after a crash.
- Fixed the resulting fresh-start blocker: `esbuild` rejected duplicate `const stored` in `loadSignalOptionsMonitorState`; renamed the hard-pressure fallback value to `refreshedStored`.
- Fixed Massive provider UI normalization in `artifacts/pyrus/src/features/platform/runtimeControlModel.js` and `ibkrPopoverModel.js`: flat `providers.massive.status/baseUrl/lastSuccessAt` is honored, empty REST request data no longer renders as `request`, and freshness wins over repeated host text when no richer REST/WS detail exists.
- Stopped an unrelated stale `signal-options:exit-policy-sweep` process from the previous Greek/C workstream so it would not keep competing for DB/API resources during D diagnostics.
- Removed the Signals page-local matrix hydration cap in `artifacts/pyrus/src/features/signals/signalsMatrixHydration.js` and reordered `artifacts/pyrus/src/screens/SignalsScreen.jsx` hydration priority so visible/filtered rows are first but all missing interval states are requested. Real throttling remains in the global pressure-aware matrix scheduler/backend instead of hardcoded 12/3 page chunks.
- `2026-06-01 14:13:17 MDT`: Added non-enforcing Greek position-management diagnostics in `artifacts/api-server/src/services/signal-options-exit-policy.ts`. Position stop payloads now include `greekManagement` with Greek availability/freshness, enforcing status, tighten/loosen/hold/unavailable recommendation, reasons, delta improvement, gamma/theta, and theta burden. This lets live/shadow position marks show how Greeks would manage the runner without enabling Greek exits or changing stop prices.
- `2026-06-01 14:29:30 MDT`: Diagnosed live STA contract selection for `GLW` and `APH`. Direct option-expiration probes for `APH`, `GLW`, and `SPY` returned `503 ibkr_bridge_not_configured`; runtime diagnostics showed IBKR bridge URL/token not configured and the desktop helper still upgrade-required. Confirmed the STA entry resolver is rule-bounded: expirations first, one selected DTE-window expiration, then one standard strike-window chain scoped by right and configured strike slots before Greek/liquidity gates.
- `2026-06-01 14:29:30 MDT`: Fixed misleading contract-resolution classification in `artifacts/api-server/src/services/signal-options-automation.ts`: retryable expiration/chain debug reasons such as `options_upstream_failure` now classify as `option_expiration_backoff` / `option_chain_backoff`, not as a plain `no_expiration_in_dte_window` DTE miss. Also made the Greek position-management probe read the optional policy defensively so API typecheck passes with the current package type shape.
- `2026-06-01 14:29:30 MDT`: Fixed the STA table pulsing `Selecting` for terminal candidates in `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`. `Selecting` and the evaluating pulse now require explicit pending `candidate` status; blocked/skipped candidates with stripped or missing payload details no longer look stuck. Live state showed current `APH` was already terminal: `status:"skipped"`, `actionStatus:"blocked"`, `reason:"mtf_not_aligned"` for signal `2026-06-01T20:10:00Z`.
- `2026-06-01 14:37 MDT`: Applied the upstream-failure classification retroactively in the STA read model. Old persisted skip events with `reason:"no_expiration_in_dte_window"` plus `expirationsDebug.reason:"options_upstream_failure"` now reconstruct as `option_expiration_backoff` in candidates and timeline rows without mutating the database. Old `no_contract_for_strike_slot` events with retryable chain debug similarly read back as `option_chain_backoff`.

## Current Status

- Source/build validation is clean on touched packages.
- Normal Replit workflow recovered after the build fix. At `2026-06-01T20:12:12.160Z`, `pnpm --filter @workspace/pyrus run dev:replit`, API `node --enable-source-maps ./dist/index.mjs`, and Vite are running; `8080` returns `404` at `/` and `18747` returns `200`.
- Live API probes after restart responded: `/api/algo/deployments`, `/api/settings/ibkr-line-usage`, `/api/diagnostics/runtime`, `/api/diagnostics/latest`, and `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/cockpit?view=full`.
- Signal Options deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0` is enabled, last evaluated at `2026-06-01T20:10:49.642Z`, last signal at `2026-06-01T20:05:00.000Z`, with `lastError: null`.
- IBKR runtime is connected and strict-ready, but the paired Windows desktop helper is still stale: reported helper `2026-05-27.launch-sequence-v24`, expected helper `2026-06-01.launch-sequence-v25`, `desktopAgentUpgradeRequired: true`. The code fix exists in the API-served helper script, but live Gateway autologin is not yet proven against v25.
- Current line pressure is low but diagnostics are not healthy. Admission reports 3 active app lines out of 200 usable, scanner cap 197/200, signal-options active 1, shadow-account active 3. Bridge diagnostics separately reports 39 active quote subscriptions, 161 remaining, and scheduler pressure `stalled` across control, market-subscriptions, historical, and options-meta lanes.
- `/api/diagnostics/latest` remains `down`/`critical`: API latency/errors elevated (`p95LatencyMs` about 3429, p99 about 6306, dominant slow route `/accounts/shadow/positions` p95 about 18072, one `/api/positions` error), runtime still reports the historical `api-child-exit`, and browser/resource-pressure/isolation/orders are degraded. IBKR, market-data, chart-hydration, accounts, automation, and storage snapshots are OK.
- Cockpit responds. Snapshot at `2026-06-01T20:11:08Z`: readiness false due `market_session_quiet`, 13 candidates, 1 selected contract (`HOOD20260605C90`), but no `signal_options_candidate_created` marker was present in the payload. The marker patch is built, but live evidence remains unproven until a fresh contract-selection event takes that path.
- Signals page interval containers should populate in a broad active-screen pass after restart instead of trickling through small page-local hydration chunks.
- Greek position-management diagnostics are implemented and validated but non-enforcing; deployment exit settings were not changed.

## Next Recommended Steps

1. Upgrade or relaunch the paired Windows desktop helper so it reports `2026-06-01.launch-sequence-v25`, then retry Gateway launch/autologin diagnostics against the new helper.
2. Investigate bridge scheduler stalls and the admission-vs-bridge line-count mismatch. This is not a 200-line exhaustion problem; it is a runtime diagnostics/control-plane consistency problem.
3. Clear or reclassify the historical `api-child-exit` runtime diagnostic only after confirming the rebuilt backend stays healthy.
4. Verify live cockpit records `signal_options_candidate_created` during the next actual contract-selection path before any live-quote hydration stall.
5. Verify Signals page interval containers populate promptly and inspect `window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__` for request/coverage if they still lag.
6. Restart through the normal Replit app path before relying on the STA classification/UI pulse fixes in the live browser; API and Pyrus builds are updated, but the currently running app may still have old loaded bundles/process code.

## Latest Validation Addendum

- `node --import tsx --test src/features/signals/signalsMatrixHydration.test.js` from `artifacts/pyrus`: 4/4 pass.
- `node --import tsx --test src/features/platform/signalMatrixScheduler.test.js` from `artifacts/pyrus`: 24/24 pass.
- `node --import tsx --test src/features/platform/platformRootSource.test.js` from `artifacts/pyrus`: 57/57 pass.
- `pnpm --dir artifacts/pyrus run typecheck`: pass.
- `pnpm --dir artifacts/pyrus run build`: pass.
- Scoped `git diff --check` passed for Signals hydration/page files.
- `node --import tsx --test src/services/signal-options-exit-policy.test.ts` from `artifacts/api-server`: 3/3 pass.
- `node --import tsx --test src/screens/algo/OperationsSignalRow.test.js` from `artifacts/pyrus`: 9/9 pass.
- `node --import tsx --test src/services/signal-options-automation.test.ts` from `artifacts/api-server`: 115/115 pass.
- `pnpm --filter @workspace/api-server run typecheck`: pass.
- `pnpm --dir artifacts/api-server run typecheck`: pass.
- `pnpm --dir artifacts/api-server run build`: pass.

## Post-Restart STA Contract Replay Check

- After the user restarted the normal Replit app, API process `41021` served the rebuilt bundle; `/api/session` responded and Signal Options state for deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0` populated 16 signals/candidates and 3 active positions.
- Current STA candidate rows are terminal/blocked, not selecting:
  - `HOOD`: sell signal `2026-06-01T20:05:00Z`, blocked by `after_hours_option_exit_blocked`; row-selected/open contract is existing position `HOOD20260605C90` call, strike 90, expiration `2026-06-05`.
  - `SMCI`: buy signal `2026-06-01T20:05:00Z`, blocked by `same_direction_position_open`; existing/open contract is `SMCI20260605C445` call, strike 44.5, expiration `2026-06-05`.
  - `GLW`: buy signal `2026-06-01T20:05:00Z`, blocked by `market_session_quiet` after earlier resolver attempts failed at expiration lookup. Persisted debug shows `expirationsDebug.reason:"options_upstream_failure"`, so no exact selected contract was recorded. A direct bounded metadata-only chain for `2026-06-05` calls returned strikes 170 through 185; configured call slots `[2,1,0]` against spot `173.779105` target slot 2 => strike 172.5 first, but trade-ready selection still requires live bid/ask/Greeks.
  - `RTX`: buy signal `2026-06-01T20:20:00Z`, blocked by `market_session_quiet` after one `option_expiration_backoff`; no exact selected contract recorded. Direct bounded metadata-only chain for `2026-06-05` calls returned strikes 167.5 through 182.5; call slot 2 against spot `173.855153` targets strike 172.5 first.
  - `ROK`: buy signal `2026-06-01T19:55:00Z`, blocked by `market_session_quiet`; one event had a real `returnedCount:11` expiration result but no expiration in the 1-7 DTE window, so no contract should have been selected under current DTE rules.
  - `APH`: sell signal `2026-06-01T20:10:00Z`, blocked by `mtf_not_aligned`; no selector run for the current signal. Direct `2026-06-05` put chain returned zero contracts, so no exact hypothetical can be computed from current IBKR metadata.
- Direct `/api/options/expirations` probes for GLW/APH/RTX/HOOD/SMCI/ROK/UUP still returned zero expirations with `options_upstream_failure`; direct `/api/options/chains` by explicit expiration can still return bounded metadata for some symbols, but after-hours metadata has bid/ask `0`, which fails STA liquidity because `requireBidAsk` requires positive bid and ask.
