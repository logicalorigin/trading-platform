# LIVE — Algo design polish → Wire viz → Shadow exit-P&L bug fix

Session ID: bfae1974-1f85-49cd-b473-6e8589b16522 (Claude Code)
Saved: 2026-07-09 ~18:05 MT
CWD: /home/runner/workspace
Branch: main.

## RESUME UPDATE 2026-07-09 18:30 MT (session 1c42fc67-7df2-40ae-80bb-2d57a4bda433)

State changed since the save above — the two bold claims below are STALE:

- **COMMITTED**: all 7 workstreams were swept into Replit Agent checkpoint commit `c3c5eaab`
  ("Saved progress at the end of the loop", 18:19 MT) together with unrelated work from other
  sessions (ibkr-session-host lib, market-data, shadow-account cache, workorder docs). Working
  tree is now clean except handoff markdown. main is ahead of origin/main by ~79 commits.
- **EXIT-FILL FIX IS LIVE (deployed unreviewed, by accident of timing)**: the ~18:17 MT microVM
  rotation made pid2 respawn the workflow, which rebuilt from source → the running API
  (pid 337, dist built 18:17) contains `signalOptionsShadowSellFillPrice` (verified by grep of
  `artifacts/api-server/dist/index.mjs`, 8 matches). healthz 200. User review of the diff is now
  retroactive; revert = remove helper usage at the two fill sites + SIGUSR2 reload.
- Re-validated at resume: `pnpm exec tsx --test` on signal-options-shadow-sell-fill.test.ts +
  signal-options-exit-policy-wire.test.ts → 13/13 pass.
- `PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE` still NOT set on the live process (wire viz surfaces
  render empty states).
- The bfae transcript jsonl did not survive the VM rotation; this note + the canonical handoff
  are the durable record.

### Halt verification (resume work, 18:45 MT — observed from DB)
- Deployment `7e2e4e6f` ("Pyrus Signals Options Shadow"): riskCaps.maxDailyLoss=$1,000, but
  **riskHaltControls.dailyLossHaltEnabled=false since at least 2026-07-06** (15 profile_updated
  events checked). Zero `daily_loss_halt_active` candidate skips today → **no false-trip occurred;
  the risk was latent because the halt is off.**
- Today's exit ledger (NY day 07-09, deduped per position, 17 finals): booked sum **−$7,168** vs
  mark-based **−$4,844** → ~**$2.3K phantom loss** from below-mark fills. Worst: BRKR booked −564,
  mark-based **+110** (sign flip); ASTN filled 90% below mark, MULL 60%, BRKR/KTOS ~40%.
- With the fix live, degenerate-spread exits (mid→bid gap >40% of mid) now fill at mid. Historical
  payload.pnl rows remain errant (data correction = user decision).
- Re-enabling dailyLossHaltEnabled is now viable but is a product decision; enabling before NY
  midnight would trip immediately off today's corrupted ledger (−7,168 ≪ −1,000).
- Authenticated screenshots not re-taken: old storageState died with the VM; users-table read was
  denied by permission classifier; /auth/launch needs the parent site's private JWT key. Re-mint
  (previously user-authorized via createAuthSession) only on user go-ahead.

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

## RESUME UPDATE 2 — 2026-07-09 ~21:45 MT (session 065e4142, finishing aborted 1c42fc67)

Session 1c42fc67 green-lit 4 items at 18:48 MT then self-aborted at 19:10 MT mid-task-3.
Status of the four as finished by session 065e4142:

1. **Daily-loss halt UI config — DONE (by 1c42fc67's subagent).** The toggle already existed
   end-to-end in committed code (algoHelpers.js `dailyLossHaltEnabled` settings entry, save path
   forwards riskHaltControls, API PATCH accepts it, enforcement at signal-options-automation.ts
   ~:5070). Subagent added one regression test: saveAllAlgoAdjustments.test.mjs (uncommitted,
   verified 8/8 pass via `node --import tsx --test`).
2. **Floor-at-stop — DONE, committed + live.** Adopted by a tandem session as commit `50ce4824`
   (helper arg stopFloorPrice, floor only for runner_trail_stop/hard_stop via stop.stopPrice;
   11/11 fill tests, 243/243 signal-options suites). Live in the serving API (dist 21:36 MT).
3. **Historical payload.pnl correction — DONE, committed ~21:55 MT (user-authorized in-session).**
   79 of 119 shadow-exit rows since 2026-05-22 corrected: payload.exitPrice/pnl recomputed under
   the committed model (+pnlCorrection audit marker with previous values, summary suffix fixed,
   postExitOutcome exit-relative fields recomputed). Originals in backup table
   `execution_events_backup_pnl_corr_20260709` (79 rows). Twice adversarially reviewed pre-run
   (one real defect fixed: non-object postExitOutcome merge; boundary check on live data: 0
   half-cent ties / 0 gap==0.4 rows). Verified post-commit: 0 rows left to update, 0 model
   mismatches, scope pnl sum −29,488 → **+1,217.00** (matches the aborted session's replay
   prediction exactly); BRKR −564 → +548 at 5.02 stop floor. Today's NY-day in-scope sum
   −9,005 → −3,993 (still breaches maxDailyLoss $1,000 — real losses, not phantoms).
   NOTE: 115/119 of these exits are ALSO mirrored as filled shadow_orders at the errant prices
   (clientOrderId shadow-auto-exit-<eventId>) — shadow-account ledger correction is a separate,
   un-scoped decision.
   UPDATE ~23:55 MT: DONE — mirror correction executed (Riley-authorized, 2x adversarial review):
   70 fills/70 orders/68 positions/261k snapshots; account realized → 138,439.79, cash →
   143,908.46, fold==row exact; SIGUSR2 reloaded. Also: the 6-row collision with 8d954547's
   Riley-ordered phantom surgery adjudicated by Riley — surgery's audited-mid values stand on
   today's 6 rows (floor-at-stop stays the forward model). See COORDINATION ADDENDUM 12.
4. **Wire-trail flag — DONE, live.** PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE=1 appended to
   .pyrus-runtime/dev-env.local (the supervisor's per-spawn env override file). The 21:36 MT
   workflow respawn picked it up: serving API child (pid 400132, owns 8080) has the flag; a stale
   pre-churn orphan API (244453) was terminated after losing the port. Web+API 200 on the public
   preview. Gate + fill tests 16/16. Wire surfaces populate on next held-position evaluation
   during market hours (18 open positions).

## Next steps (revised at resume, 18:30 MT)
1. Retroactive review of the exit-fill fix diff (already live — see RESUME UPDATE); confirm keep vs revert, and confirm daily-loss halt no longer false-trips on degenerate quotes.
2. Decide the OPTIONAL floor-at-stop-price change (still NOT applied; needs sign-off). [DONE — commit 50ce4824, see RESUME UPDATE 2]
3. (Optional) enable PYRUS_SIGNAL_OPTIONS_WIRE_TRAIL_LIVE to see wire viz populated (needs open positions). [DONE — see RESUME UPDATE 2]
4. Push strategy: work is inside checkpoint c3c5eaab mixed with other sessions' work; main ahead ~79 of origin/main.
5. [NEW] Run the payload.pnl correction transaction once the user authorizes it (see RESUME UPDATE 2 item 3).

## Validation snapshot
pyrus typecheck ✓, pyrus build ✓, api-server typecheck ✓, backend wire test 7/7 ✓, fill test 6/6 ✓, algo suite 165/167 (2 pre-existing MTF), boot 0 console errors.
