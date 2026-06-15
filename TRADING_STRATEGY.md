# Trading Strategy

**Multi-timeframe market-structure breakout, expressed through short-dated options.**

We detect institutional-style market structure breaks, confirm them across multiple
timeframes, and express the move with 1–3 DTE options for leverage.

## Signal

- **Engine:** Pyrus Signals (price-action market structure).
- **Structure events:** Break of Structure (BOS) and Change of Character (ChOCh),
  detected from swing pivots around an 80-bar WMA basis line.
- **Volatility frame:** 14-period ATR (smoothed) with 2× bands.
- **Confirmation filters:** ADX ≥ 20 (trend strength), shadow-volatility score,
  optional volume-breakout and full-close confirmation on the break.

## Signal Source (consolidated)

The **signal matrix is the sole source of signal state** — the signal-options worker no
longer runs background scans to discover candidates. Per-symbol, per-timeframe signal
direction lives in the matrix (`signal_monitor_symbol_states`) and is the canonical input
to the entry gate. The backend is the single author of signal semantics and
**actionability**; the frontend no longer infers freshness or rewrites state.

## Multi-Timeframe (MTF) Entry Gate

The hard gate on every entry.

- Resolves signal direction from the **real per-timeframe matrix state** across configured
  frames — default **1m, 2m, 5m, 15m, 1h** — looked up point-in-time (`now` for live,
  signal-time for backfill).
- A signal fires only if **≥ requiredCount (default 2)** frames currently match its direction.
- A frame showing the **opposite** direction counts as opposition and can block the trade,
  even if stale.
- The STA (Signal-To-Action) table mirrors this exact gate (`resolveConfiguredMtfAlignment`)
  so the UI never disagrees with its own timeframe bubbles.

Additional entry checks:
- **Action freshness:** a signal is action-eligible only within **1 bar** of the signal
  (`SIGNAL_MONITOR_MAX_ACTIONABLE_BARS_SINCE_SIGNAL = 1`); older or stale → blocked.
- **Bearish regime gate** for puts (ADX ≥ 25, relaxed to 22 with 2+ bearish frames; no puts
  when MTF is fully bullish).
- **Inverse-ETF put blocklist** (SQQQ, SH, PSQ, SDS, SPXU, …).
- **Liquidity:** bid-ask spread ≤ 35% of mid, live/recent quote, min bid $0.01.

## Instruments & Strike Selection

- **Underlyings:** liquid large-cap universe.
- **Options:** 1–3 DTE (1 DTE target, 0 DTE off); calls on buy signals, puts on sell signals.
- **Strike selection (Greek selector, enabled in tuned):** scores up to 24 candidate strikes
  toward a **~0.45 delta target**, blending breakeven fit, gamma/theta ratio, IV value, and
  liquidity. Requires live Greeks; falls back to fixed slots (call slot 3, put slot 2) when
  Greeks are unavailable. Greeks rank strikes — they do **not** gate entries.

## Exit Rules

- **Hard stop:** −40%, enforced from option-quote ticks via the position tick-manager.
  Fallback marks ≤ 60s old may drive stop exits; older marks (up to ~3 min) record P&L only.
- **Trailing stop:** arms at +40% gain, gives back 25% of peak; tightens to 30% giveback
  at 5× and 15% at 10×.
- **Signal flip:** close on an opposite MTF signal.
- **Early invalidation (tuned):** exit a position held **8 bars** in a loss, or once loss
  hits **−25%**, without waiting for the trailing stop to arm
  (`earlyExitBars: 8`, `earlyExitLossPct: 25`).
- **Wire-Greek trail (tuned):** trailing-stop "rungs" set by profit milestone (35% → wire3,
  65% → wire2, 100% → wire1, 200% → trendline), then nudged by live Greeks —
  tightened on delta decay (≤ −0.1), heavy theta burden (≥ 8% of mark), or spread widening
  (> 1.5× entry); loosened on improving delta (≥ +0.05) with strong gamma (≥ 0.05).
  Requires Greeks fresh within **15s**.
- **Overnight exit** (off by default in the base profile).

## Risk Controls (default profile)

- Max premium per entry: **$500**
- Max contracts per trade: **3**
- Max open symbols: **5**
- Max daily loss: **$1,000**
- Auto-halt on gateway downtime, resource pressure, or contract-resolution backoff.

## Tuned Profile Variant

A `tuned` profile patch overrides the base defaults for a more aggressive posture:

| Parameter            | Default | Tuned |
|----------------------|---------|-------|
| Max premium / entry  | $500    | $1,500 |
| Max open symbols     | 5       | 10 |
| Hard stop            | −40%    | −30% (tighter) |
| Trail activation     | +40%    | +35% |
| Min locked gain      | 10%     | 15% |
| Progressive trail    | off     | on |
| Wire-Greek trail     | off     | on (greek max age 15s) |
| Overnight exit       | off     | on |

---
*Source: `lib/backtest-core/src/signal-options.ts`,
`artifacts/api-server/src/services/signal-monitor.ts` (matrix + `getSignalDirectionsForSymbolAsOf`),
`artifacts/api-server/src/services/signal-monitor-actionability.ts`,
`artifacts/api-server/src/services/signal-options-automation.ts`.
Reflects consolidation commits through c07603f (2026-06-14).*
