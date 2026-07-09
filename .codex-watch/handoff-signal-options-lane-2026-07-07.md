# Hand-off to the signal-options lane (owner of signal-options-automation.ts / signal-options-worker.ts WIP)

## HEADS-UP: two edits landed IN YOUR FILES (2026-07-07 ~15:35 MDT, user-directed)
1. `signal-options-automation.ts` `buildSignalOptionsShadowIndex` (~7884): the open-position link-rescue set now also includes positions CLOSED within 24h (`linkRescuePositions`, cutoff `closedLinkRescueCutoffMs`). Root cause: the 2,500-event window ages out entry events within hours on busy days, severing row→position links for closed trades (full trace: `.codex-watch/sta-position-link-trace-2026-07-07.md`). Trace's option #2 (join by durable candidate id) remains yours if you want the stronger fix.
2. `signal-options-automation.test.ts` (~1275): the "unconfigured count defaults to unanimity" half of the MTF gate test was updated to the new product ruling — unset requiredCount resolves to 2 (confirmation default), never unanimity. The resolver change enforcing this is in `lib/backtest-core/src/signal-options.ts` (~806): stored panel values are honored verbatim (incl. `enabled:false`); only unset values fall back. Note the resolver previously ALSO ignored the panel's enabled toggle — that is now honored, and the old "forces always-on" resolver test in backtest-core was updated accordingly.
Both edits are surgical and marked with comments; 41/41 suite green after. If they collide with your in-flight work, the diff hunks are cleanly separable.

From: claude-lead pressure/STA investigation (session dbf9de08), 2026-07-07 ~14:00 MDT.
Evidence: `.codex-watch/sta-pending-trace-2026-07-07.md`, `.codex-watch/db-census-2026-07-07.md` (S13), `.codex-watch/sta-blocking-audit-2026-07-07.md`. These items live in YOUR dirty WIP files — we did not edit them.

## 1. Entry-scan starvation floor (product bug, verified today)
`skipEntryWork = isApiResourcePressureHardBlock(pressure)` (signal-options-worker.ts:740) skipped ALL entry work ~17:28-18:52Z while DB pool was pinned (hardResourceLevel high). Verified: 84-min blackout of candidate/entry execution_events while 724 position marks flowed; entries resumed exactly in the two pool dips. Under chronic saturation the transient degrade becomes an indefinite entry freeze — no floor guarantees a periodic entry pass. Recommended (pick one):
- Force one throttled entry pass after N consecutive skipped ticks (e.g. N=10), OR
- leaky-bucket the gate (1-in-N entry scans proceed under hard block), OR
- small dedicated pool budget for entry work.
Recovery today is automatic once pool waiters <6 for 2 samples (hysteresis resource-pressure.ts:109; resume cursor signal-options-automation.ts:19462-19473) — the floor is resilience, not the urgent fix (upstream demand cuts are landing separately).

## 2. Honest degrade labeling (UX)
While entries are skipped, STA rows read "action candidate pending" / "Candidate missing · Xm" / "shadow link pending" — three labels for one condition (no candidate built because entry work is skipped). Surface the real reason (e.g. "entries paused: resource pressure") on the cockpit/state payload when skipEntryWork was applied, instead of the empty-candidate fallbacks.

## 3. Census S13 (DB cost inside your files)
- Seen-set computed twice per scan (signal-options-automation.ts:19243 AND :19602 — two ~10k-row reads); compute once per scan.
- Batch the per-event signal_options_seen_signals upserts (:8656-8674, :2352-2433) into multi-row statements.
- `activeLongScanCount` can pin: reset is deferred; move to `.finally` (signal-options-worker.ts:596-606) so a hung scan promise self-heals (threshold consumers diagnostics.ts:2060/2194-2199; `already_running` block automation.ts:155/:18974).

## 4. Pinned candidate reasons under pressure (display audit §2)
`mergeSignalOptionsCandidate` (:6309-6316) lets durable status/reason win over a fresh shell's null — correct for continuity, but under pressure-deferred scans it pins stale reasons for the whole pressure window. Consider stamping reasons with authoredAt and letting a clean scan cycle clear them explicitly.

## 5. mtf_not_aligned is errant — root cause TRACED (2026-07-07 ~14:15 MDT)
The gate does NOT read stored freshness (hypothesis refuted; 3e6e000b is unrelated). Verified chain:
- `evaluateSignalOptionsEntryGate` emits mtf_not_aligned at signal-options-automation.ts:5374-5381 when `mtfMatches < requiredMtfCount`.
- Frames come from `getSignalDirectionsForSymbolAsOf` (signal-monitor.ts:14219): latest `signal_monitor_events.direction` per configured timeframe at-or-before candidate signalAt. Default profile requires ALL FIVE (1m/2m/5m/15m/1h; requiredCount=5 via lib/backtest-core/src/signal-options.ts:232-236).
- BUG 1: `selectSignalOptionsMtfFramesFromMatrix` (:5257-5275) hard-codes `missingTimeframes: []`, so a symbol with NO event row on a timeframe scores 0 = "misaligned" instead of routing to `mtf_unavailable`. Unknown is reported as misaligned — that's the lie the user is seeing.
- BUG 2 (source divergence): `signal_monitor_events` is sparse (distinct symbols: 1m 2931, 2m 1187, 5m 1191, 15m 1609, 1h 1153) while the STA display renders standing trend from near-universal `signal_monitor_symbol_states` (15m 3383, 1h 3113). Display says aligned; gate can't see the trend because no crossover EVENT was ever anchored for that cell.
Recommended (your files): (a) route absent frames to missingTimeframes → mtf_unavailable (honest label + distinct gate semantics); (b) consider sourcing frames from symbol_states current_signal_direction (the standing trend the display uses) or falling back to it when the event row is absent; (c) surface requiredCount in the control panel — 5-of-5 with sparse sources is a de-facto entry freeze. Product decision needed on required set/count.
Partial mitigation from our side: the event-anchor backfill (breadth repair) inserts 754 rows (408 latest_direction_mismatch + 346 missing_event_anchor, dry-run 2026-07-07) into exactly the table this gate reads — helps but does NOT close the ~1,800-symbol gap on higher TFs.

## 6. Fix C tally gate (pre-existing, from agent-chat 17:15Z)
Tally mode=on remains gated on the shadow comparator being like-for-like (in-memory recent-skips buffer starts empty each restart vs durable store) — seed the buffer from the store at boot or expose lastDriftSample; multiple manual restarts today make the current comparator drift expected-and-benign.
