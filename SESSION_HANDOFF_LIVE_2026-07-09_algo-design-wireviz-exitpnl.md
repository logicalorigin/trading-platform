# LIVE — Algo design polish → Wire viz → Shadow exit-P&L bug fix

Session ID: bfae1974-1f85-49cd-b473-6e8589b16522 (Claude Code)
Saved: 2026-07-09 ~18:05 MT
CWD: /home/runner/workspace
Branch: main. **Nothing committed. Nothing deployed (running API is the old dist bundle; Vite web hot-reloads frontend).**

## Workstreams (all in the working tree, uncommitted)

### 1. Algo control-panel design polish vs DESIGN.md — DONE, verified
Files: screens/algo/{HaltStrip,AlgoDiagnosticsTab,OperationsStatusOrb,AlgoSettingsRegion,AlgoSaveBar,AlgoRightRail,OvernightControlPanel,AlgoDeploymentTabs,AlgoTimeframeControlBand,CreateDeploymentModal,AlgoLivePage}.jsx + src/index.css (ra-touch-target-y).
Themes: state pills (halt/group/mode/run-dot), semantic palette fixes (pending→amber, retire off-palette cyan where misused, kept cyan for in-progress per user), a11y (aria-invalid, focus, focus-trap, 44px), capacity band restored + hierarchy reorder, save-bar error state, empty-state recovery copy.
Verified: pyrus typecheck+build clean; algo tests 165/167 (2 pre-existing MTF fails only); 0 console errors on boot.

### 2. Wire-trail rung-map row editor + polish — DONE
AlgoSettingsRegion.jsx: WireRungMapEditor (structured activation%+W3/W2/W1/TL SegmentedControl rows, sorts on blur) replaces the un-typeable text field + preview. algoHelpers.js: status BREAK/FLIP escalation + rungSummary '--' when off. AlgoRightRail tone map break/flip.

### 3. Wire visualization (A-lite chart / B widget / C strip) — DONE, verified
- Backend telemetry: signal-options-exit-policy.ts emits wireLevels{trendLine,wire1,wire2,wire3}+distanceToBreakPct (reuses wireValueForRung); passthrough Record → lastWireTrail (no schema change). Tests: signal-options-exit-policy-wire.test.ts (7/7 pass).
- FE model: resolvePositionWireTrailState surfaces ladder+distance.
- Blockers cleared: algoAccountPositions.js threads lastWireTrail; PositionsPanel.jsx hasExpandablePositionDetails expands wire positions.
- Surfaces: C=WireTrailStatusBand active-wire strip (AlgoRightRail.jsx); B+A-lite=WireTrailDetail.jsx (new) in PositionsPanel drilldown (ladder widget + price rail).
- NOTE: wire data only populates when env PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE=1 (currently OFF) AND there are open positions. Surfaces degrade to clean empty states otherwise.

### 4. Mobile header scrolling lanes — DONE (subagent), typecheck ok
HeaderBroadcastScrollerStack.jsx: reverted a Jul-5 isPhone ternary that swapped the 3 scrolling lanes for a static chip strip on mobile. All 3 (SIGNALS/FLOW/ALGO) marquee on mobile again.

### 5. Headless auth for screenshots (tooling, do not commit)
Minted a real admin session via createAuthSession (user info@logicalorigins.com; 3 users, no riley@ in DB). storageState at scratchpad/pyrus-storage-state.json. Playwright needs context.addCookies (storageState file didn't apply). Temp mint script was created in api-server/src and REMOVED.

### 6. P&L confirmation
Real accounts day P&L = $0 (shadow mode places no real orders). Shadow LEDGER (/api/accounts/shadow/positions totals): NLV $137.5K, cash $114K, unrealized +$2,541 (18 open), day ≈ +$2,008. Big open winners RH +131%, BROS +49%, TSLL +77%. **The DB signal_options_shadow_exit.payload.pnl field is ERRANT — do not sum it.**

### 7. IN PROGRESS — shadow exit-fill degenerate-spread bug fix (pending user review before deploy)
Root cause (high conf): shadow exit fills near the bid `mid-(mid-bid)*0.9` (signal-options-automation.ts:14170 live + :14261 fallback) with NO spread guard; on a degenerate quote (BRKR: bid 2.05/ask 5.80/mid 3.925, ~96% spread) it books a phantom loss (2.24 → pnl -564) even though the trade trailed out in profit. That payload.pnl feeds computeSignalOptionsDailyRealizedPnl (:8457) → daily-loss HALT → can FALSE-TRIP. UI realized ~0 uses a separate round-trip path (correct).
Fix applied (uncommitted): new exported helper `signalOptionsShadowSellFillPrice(mid,bid,fallback)` + `SIGNAL_OPTIONS_DEGENERATE_SELL_GAP_FRACTION=0.4` after signalOptionsRealizedPnl (~:8456); when (mid-bid)/mid > 40% → return mid; else unchanged near-bid. Used at both fill sites. Test: signal-options-shadow-sell-fill.test.ts (6/6 pass). api-server typecheck clean.
Product decision taken (user: "not sure, minor, broker dictates real fills"): fall back to MID on degenerate spread; threshold 40% (tunable const).
NOT done: OPTIONAL floor-at-stop-price change (high risk, needs sign-off) NOT applied. Not deployed (SIGUSR2 reload). Present diff for review.

## Next steps
1. Present the exit-fill fix diff for user review; on OK, deploy via SIGUSR2 reload of the pid2-owned supervisor and confirm daily-loss halt no longer false-trips.
2. (Optional) offer to enable PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE to see wire viz populated (needs open positions).
3. Decide commit strategy for the design + wire-viz + fix (nothing committed yet).

## Validation snapshot
pyrus typecheck ✓, pyrus build ✓, api-server typecheck ✓, backend wire test 7/7 ✓, fill test 6/6 ✓, algo suite 165/167 (2 pre-existing MTF), boot 0 console errors.
