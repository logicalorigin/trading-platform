# RayAlgo Settings Catalog

## Purpose

This document is the repo-local source of truth for the RayAlgo settings audit requested on 2026-03-19.

It combines:

- Replit App Storage screenshots:
  - `RA settings 1.png`
  - `RA settings 2.png`
  - `RA settings 3.png`
  - `RA settings 4.png`
  - `RA settings 5.png`
  - `RA settings 6.png`
  - `ray algo reference.png`
- Public RayAlgo documentation from `rayalgo.com/docs`
- The current local implementation in:
  - `src/research/engine/runtime.js`
  - `server/services/rayalgoCore.js`
  - current research chart controls and overlays

This is a catalog and parity audit. It is not the implementation spec for full RayAlgo parity.

## Working Defaults For Our App

These are the defaults we will use for our research surface unless explicitly changed later:

- Candles on load: `5m`
- Arrow signals on load: `5m`
- Shading on load: `5m`
- Signal timeframe selector minimum: `1m`
- Shading timeframe selector minimum: `1m`

Important distinction:

- `signalTf` and `shadingTf` are chart-layer controls in our app.
- `MTF 1 / MTF 2 / MTF 3` in RayAlgo are higher-timeframe confirmation filters shown in the info panel.
- They are not the same thing.

## Public Docs Inventory

Primary docs archive:

- `https://rayalgo.com/docs/`

Relevant pages used in this audit:

- `https://rayalgo.com/docs/market-structure-settings/`
- `https://rayalgo.com/docs/trend-reversal-signal-settings/`
- `https://rayalgo.com/docs/support-resistance-zones-settings/`
- `https://rayalgo.com/docs/band-settings/`
- `https://rayalgo.com/docs/tp-sl-settings/`
- `https://rayalgo.com/docs/info-panel-settings/`
- `https://rayalgo.com/docs/the-confirmation-dashboard/`
- `https://rayalgo.com/docs/appearance-alerts-settings/`
- `https://rayalgo.com/docs/order-blocks-with-volume/`
- `https://rayalgo.com/docs/dynamic-continuation-signals/`
- `https://rayalgo.com/docs/how-to-set-up-custom-alerts-in-tradingview/`

## High-Level RayAlgo Model From Docs

RayAlgo publicly documents five distinct layers:

1. Market structure:
   - BOS
   - CHoCH
   - swing labels
2. Main reversal logic:
   - BUY / SELL trend-change signals
3. Continuation logic:
   - small pullback arrows inside an established trend
4. Context and filtering:
   - dynamic trend bands
   - order blocks
   - support/resistance zones
   - dashboard metrics
   - MTF confirmation blocks
   - volatility and session context
5. Alert timing and presentation:
   - wait-for-bar-close behavior
   - bull/bear colors
   - background tint
   - dashboard visibility

Public-doc implications that matter for our app:

- The main BUY / SELL signals are not the same thing as continuation arrows.
- The trend reversal marker is a CHoCH confirmation marker, not the main action signal.
- The dashboard is a filtering layer, not a standalone signal generator.
- MTF controls belong to the confirmation layer.
- Continuation arrows are documented as trend-band pullback events.

## Screenshot-Derived Settings

### RA settings 1

Category: market structure, trend reversal visuals, order block colors

- `Time Horizon = 6`
- `BOS/CHOCH Line Style = Solid`
- `Show BOS = on`
- `Show CHoCH = on`
- `Show Swing Labels = on`
- `Show Trend Reversal Signals = on`
- `Line Color = yellow`
- `Text Color = white`
- `Signal Line Length (Bars) = 30`
- `Show Order Blocks = on`
- `Bullish OB Color = teal`
- `Bearish OB Color = pink`

### RA settings 2

Category: order block count, support/resistance zones

- `Max Active OBs = 5`
- `Show Support/Resistance Zones = on`
- `Pivot Strength = 15`
- `Minimum Zone Distance (%) = 0.05`
- `Zone Thickness (ATR Mult) = 0.5`
- `Max Number of Zones = 7`
- `Zone Extension (Bars) = 100`
- `Resistance Color = pink`
- `Support Color = teal`

### RA settings 3

Category: main trend and visual bands

- `Basis Length = 80`
- `ATR Length = 14`
- `ATR Smoothing = 21`
- `Volatility Multiplier = 2`
- `Show Wireframe Bands = on`
- `Wireframe Spread = 0.5`
- `Show Volatility Shadow = on`
- `Length = 20`
- `StdDev = 2`
- `Shadow Color = gray`

### RA settings 4

Category: sessions, TP/SL, info panel

- Sessions master list present:
  - London
  - New York
  - Tokyo
  - Sydney
- `Show TP/SL Levels = on`
- `TP 1 Risk/Reward = 0.5`
- `TP 2 Risk/Reward = 1`
- `TP 3 Risk/Reward = 1.7`
- `Show Info Panel = on`
- `Panel Position = bottom`
- `Panel Size = Tiny`
- `ADX Length = 14`

### RA settings 5

Category: info panel, appearance, alerts, filters

- `Volume MA Length = 20`
- `MTF 1 = 1 hour`
- `MTF 2 = 4 hours`
- `MTF 3 = 1 day`
- `Bull Color = cyan/blue`
- `Bear Color = pink`
- `Show Trend Background = on`
- `Wait for Bar Close (Signal Alerts) = on`
- `Enable Signal Filters = on`
- `Filtered Candle Color = gray`

### RA settings 6

Category: filter gating

- `Require MTF 1 Alignment = off`
- `Require MTF 2 Alignment = off`
- `Require MTF 3 Alignment = off`
- `Require ADX >= Min = off`
- `ADX Min = 20`
- `Require Volatility Score Range = off`
- `Vol Score Min = 2`
- `Vol Score Max = 10`
- `Restrict to Selected Sessions = off`
- Session filter choices present:
  - London
  - New York
  - Tokyo
  - Sydney

## Public Docs Crosswalk

### Market Structure Settings

Docs:

- Market Structure Settings

Documented behavior:

- `Time-Horizon` controls swing sensitivity.
- Lower values increase sensitivity and signal frequency.
- Higher values suppress smaller structure changes.
- Docs recommend default `10`.
- `BOS Confirmation` can be `Candle Close` or `Wicks`.
- `BOS/CHoCH Line Style`, `Show CHoCH`, and `Show Swing Labels` are presentation controls.

Screenshot alignment:

- Screenshot default is `Time Horizon = 6`, not the doc-recommended `10`.
- Screenshot shows line style and structure toggles but does not show an explicit BOS-confirmation dropdown.

### Trend Reversal Signal Settings

Docs:

- Trend Reversal Signal Settings

Documented behavior:

- Trend reversal markers are the dotted line and `Trend Reversal` text shown when a CHoCH is confirmed.
- This is a confirmation marker, not the main BUY / SELL signal.

Screenshot alignment:

- The screenshot includes `Show Trend Reversal Signals`, line color, text color, and signal-line length.

### Support / Resistance Zones Settings

Docs:

- Support & Resistance Zones Settings

Documented behavior:

- `Pivot Strength` controls how significant pivots must be.
- `Minimum Zone Distance (%)` prevents clutter from near-duplicate zones.
- `Zone Thickness (ATR Mult)` makes zone thickness volatility-aware.
- `Max Number of Zones` and `Zone Extension (Bars)` manage persistence and clutter.

Screenshot alignment:

- All of these settings are visible in `RA settings 2`.

### Band Settings

Docs:

- Band Settings
- Dynamic Pullback Signals

Documented behavior:

- The trend bands are the core trend-following component.
- `Basis Length`, `ATR Length`, `ATR Smoothing`, and `Volatility Multiplier` control band behavior.
- Continuation arrows are documented as pullback entries generated when price touches or pierces the dynamic band in the direction of the confirmed trend.

Screenshot alignment:

- `RA settings 3` includes the band inputs.
- `ray algo reference.png` visually shows the band complex and continuation arrows together.

### Order Blocks

Docs:

- Order Blocks with Volume

Documented behavior:

- OBs remain active zones until mitigation.
- They extend to the right and update over time.
- `Max Active OBs` limits clutter.
- Higher-volume OBs are stronger zones.

Screenshot alignment:

- The screenshots expose colors and `Max Active OBs`.
- The screenshots do not show a separate volume-threshold input.

### TP/SL

Docs:

- TP/SL Settings

Documented behavior:

- TP/SL is an optional visual system.
- There are three configurable take-profit RR levels.
- SL is anchored to the relevant structural pivot from the trend change.

Screenshot alignment:

- `RA settings 4` shows the three TP RR fields and the master toggle.

### Info Panel / Confirmation Dashboard

Docs:

- Info Panel Settings
- The Confirmation Dashboard

Documented behavior:

- `ADX Length` drives strength classification.
- `Volume MA Length` provides a baseline used for the volatility context.
- `MTF 1 / 2 / 3` define dashboard confirmation timeframes.
- The docs classify dashboard fields as trend, strength, trend age, volatility, session, and MTF blocks.
- The dashboard is a confirmation/filtering layer, not a standalone signal generator.

Screenshot alignment:

- `RA settings 4-6` match the dashboard and filter surface closely.

### Appearance / Alerts

Docs:

- Appearance & Alerts Settings
- How to Set Up Custom Alerts in TradingView

Documented behavior:

- Bull and bear colors are global theme colors across the indicator.
- `Show Trend Background` is a background tint that reflects trend direction.
- `Wait for Bar Close` is the recommended non-repainting alert mode.
- Trend change, continuation arrows, BOS, and swing-point events are all alertable.

Screenshot alignment:

- `RA settings 5` and `RA settings 6` show these appearance and filter controls.

## Mapping Settings To Our Future App Concepts

### A. Primary signal generation

These should eventually influence when main RayAlgo buy/sell signals are emitted:

- `Time Horizon`
- `BOS Confirmation`
- trend-band core settings
- any structural rule that defines reversal confirmation

### B. Continuation arrows

These should eventually influence pullback-arrow generation:

- band settings
- current trend state
- band-touch / pierce behavior
- `Wait for Bar Close`
- optional filters if enabled

### C. Regime / shading

These should eventually influence the background trend/regime layer:

- main trend state derived from structure + trend bands
- `Show Trend Background`
- selected shading timeframe

### D. Confirmation / filter layer

These should eventually act as opt-in gates rather than standalone signals:

- `MTF 1 / 2 / 3`
- `Require MTF n Alignment`
- `ADX Length`
- `Require ADX >= Min`
- `Volume MA Length`
- `Require Volatility Score Range`
- `Vol Score Min`
- `Vol Score Max`
- `Restrict to Selected Sessions`
- session list

### E. Visual-only overlays

These are important for parity, but not for signal generation:

- line style
- color fields
- text color
- panel position
- panel size
- wireframe bands
- volatility shadow
- filtered candle color
- support/resistance colors

### F. Risk / management visuals

These should not change signal generation:

- TP 1/2/3 RR
- TP/SL visibility
- info panel visibility

## Current Repo Gap Audit

### Current research/runtime behavior that roughly matches RayAlgo

The repo currently models some RayAlgo-like concepts:

- EMA crossover and trend bias
- BOS / CHoCH-like structure events
- sweep detection
- order blocks
- fair value gaps
- regime labeling
- composite conviction

Files:

- `src/research/engine/runtime.js`
- `server/services/rayalgoCore.js`

### Important mismatches and contradictions

#### 1. Time horizon is not a user setting

- Research runtime uses fixed structural windows:
  - swing lookback around `10`
  - recent-candle windows for OB/FVG detection
- Server-side local RayAlgo generation uses `DEFAULT_STRUCTURE_LOOKBACK = 5`
- This means the repo already has two different structural sensitivities.

Impact:

- We cannot claim RayAlgo parity until there is one canonical structural-sensitivity model.

#### 2. BOS confirmation is inconsistent

- Research runtime structure breaks are effectively close-based in several places.
- Server-side local RayAlgo generation uses raw highs/lows in `detectStructure`, which is closer to wick-based confirmation.
- RayAlgo docs explicitly expose a `Candle Close` vs `Wicks` choice.

Impact:

- This is a real logic mismatch, not just a missing UI setting.

#### 3. Continuation arrows are not modeled the RayAlgo way

- RayAlgo docs define continuation arrows as pullbacks into the dynamic trend bands.
- Our current research arrows come from the generalized signal overlay tape, not from explicit band-touch logic.

Impact:

- Current arrows are not yet parity arrows.

#### 4. Shading is not RayAlgo trend background yet

- Our current shading is a chart regime layer derived from signal windows.
- RayAlgo docs describe `Show Trend Background` as a tint of the active trend direction.

Impact:

- Our shading concept is directionally useful, but it is not yet the same artifact.

#### 5. Dashboard and filter controls are mostly missing

Missing as first-class settings:

- `ADX Length`
- `Volume MA Length`
- MTF inputs
- MTF alignment requirements
- ADX threshold gate
- volatility score gates
- named session restriction

Impact:

- The current repo has almost none of RayAlgo’s documented confirmation layer.

#### 6. Support / resistance zones are missing

- The screenshots and docs expose a full S/R subsystem.
- The research runtime does not currently model RayAlgo S/R zones as a dedicated feature.

#### 7. OB behavior is incomplete

- We do detect and display OB-like zones.
- We do not model the documented volume-strength meaning as a configurable layer.
- We do not expose `Max Active OBs` as a user setting.

## Status Matrix

Legend:

- `implemented`: recognizable and close to RayAlgo intent
- `approx`: partially present, but not parity
- `missing`: absent as first-class behavior or setting
- `visual-only`: present later only if we choose display parity

| Setting family | Status | Notes |
| --- | --- | --- |
| Time Horizon | missing | hardcoded sensitivity exists, not configurable |
| BOS Confirmation | approx | repo behavior differs between research and server |
| BOS / CHoCH events | approx | events exist, but confirmation model is not parity-safe |
| Swing labels | approx | some structure labeling exists, but not as a RayAlgo setting |
| Trend reversal marker | missing | exact dotted-line confirmation marker not implemented |
| Order blocks | approx | OB-like detection exists, but not full documented behavior |
| Max Active OBs | missing | not exposed |
| Support / resistance zones | missing | no dedicated subsystem |
| Dynamic trend bands | missing | no explicit RayAlgo band model |
| Continuation arrows | missing | current arrows are not band-touch continuation arrows |
| Wireframe bands | missing | visual-only, absent |
| Volatility shadow | missing | visual-only, absent |
| TP/SL levels | missing | no RayAlgo TP/SL visual system |
| Info panel | missing | no RayAlgo dashboard |
| ADX / Volume MA | missing | not a first-class RayAlgo layer |
| MTF dashboard blocks | missing | not implemented |
| MTF alignment filters | missing | not implemented |
| Volatility score filter | missing | not implemented |
| Session restriction | approx | repo has session blocks, not RayAlgo named sessions |
| Wait for Bar Close | approx | signals are effectively close-driven in places, but no explicit toggle |
| Trend background | approx | regime shading exists, but not RayAlgo background semantics |
| Bull / Bear colors | approx | local chart colors exist, but not unified RayAlgo theme controls |

## Future Interface Targets

When we move from catalog to implementation, the future settings model should separate:

- chart display
  - `candleTf`
  - `signalTf`
  - `shadingTf`
- core structural logic
  - `timeHorizon`
  - `bosConfirmation`
- trend-band logic
  - `basisLength`
  - `atrLength`
  - `atrSmoothing`
  - `volatilityMultiplier`
- context filters
  - `adxLength`
  - `volumeMaLength`
  - `mtf1`
  - `mtf2`
  - `mtf3`
  - `requireMtf1`
  - `requireMtf2`
  - `requireMtf3`
  - `requireAdx`
  - `adxMin`
  - `requireVolScoreRange`
  - `volScoreMin`
  - `volScoreMax`
  - `restrictToSelectedSessions`
  - `sessions`
- visual parity
  - line styles
  - trend background
  - wireframe bands
  - volatility shadow
  - colors
  - dashboard placement
- risk visuals
  - `showTpSl`
  - `tp1Rr`
  - `tp2Rr`
  - `tp3Rr`

## Acceptance For This Catalog Phase

This catalog phase is complete when:

- every visible screenshot control is accounted for
- every public RayAlgo doc page used here is mapped to a setting family
- our current defaults are explicitly recorded as `5m / 5m / 5m`
- the minimum selector capability for signal and shading is explicitly recorded as `1m`
- the current repo mismatches are explicit enough that the next implementation phase can proceed without rediscovery
