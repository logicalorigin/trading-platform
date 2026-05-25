# Pyrus Platform — Marketing Product Description

This document is the source for the Pyrus marketing website. It is split into two parts:

1. **Feature inventory + value props** — structured, feature-by-feature reference you can pull from when writing any section of the site (hero, features grid, comparison tables, FAQ, etc.).
2. **Long-form product description** — a single ~2,000-word narrative you can excerpt and adapt freely.

Positioning choices that shape this document:
- **Audience:** broad — serious retail through pros / RIAs. Tone: confident, technical-but-readable, peer-to-peer.
- **Scope:** every shipped surface (Market, Flow, Trade, Account, GEX, Research, Algo, Backtest, Signal Monitor, Shadow Account, Diagnostics, Settings) is treated as production.
- **Broker stance:** Interactive Brokers is the current integration; copy uses "starting with Interactive Brokers" framing to keep future brokers in play.

---

# PART 1 — Feature Inventory + Value Props

## Brand & Identity

| Field | Value |
|---|---|
| Product name | **Pyrus Platform** (often just **Pyrus**) |
| Company | **Logical Origins** |
| Contact | info@logicalorigins.com |
| Product type | Professional-grade trading terminal + algorithmic execution platform |
| Delivery | Web app (React + Vite), with a lightweight Windows helper that bridges to Interactive Brokers' TWS / IB Gateway |
| Brand palette | Warm coral / cream system with light + dark modes and user-selectable accents (coral, amber, green, aurora) |
| Typography | IBM Plex Sans |
| Personality | Calm, instrument-like, "Bloomberg-lite for the modern trader" — dense when you want it, quiet when you don't |

## One-liners (pick one)

- "An algorithmic trading terminal for traders who've outgrown their broker's UI."
- "Real-time options flow, portfolio Greeks, and signal-driven automation in one workspace."
- "The professional terminal Interactive Brokers should have shipped."
- "From idea to backtest to live deployment — without leaving the chart."
- "Pyrus: see the flow, model the risk, run the algo."

## Target users

| Persona | What they want from Pyrus |
|---|---|
| Active retail options trader | Real-time options flow, Greeks-aware chains, fast execution, GEX/squeeze context, premium-distribution scanners |
| Algo-curious retail trader | Codeless signal monitors, paper-traded automation via shadow accounts, full backtesting before going live |
| Quant / systematic trader | Pine Script indicators, backtest sweeps and studies, deployment cockpit with execution telemetry, shadow vs. live divergence tracking |
| Professional / prop / RIA | Portfolio-wide Greeks and risk, IBKR governance (lanes, admission, bridge governor), execution audit trail, account allocation analytics |

## Feature inventory

### 1. Market — multi-symbol charting & macro context
**One-liner:** A TradingView-style chart grid wired to live broker data with macro overlays.
**Description:** Multi-symbol chart grid with multiple timeframes, drawing tools, news, earnings calendar, sector/macro indicators (VIX, yield curves, breadth), and live signal-monitor recommendations overlaid on price.
**User benefit:** Trade from the same surface where you do market context — no more flipping between tabs.

### 2. Flow — real-time options flow & unusual activity
**One-liner:** Smart-money positioning in real time, with premium distribution visualization.
**Description:** Streaming options flow scanner with Webull-style vertical premium bars, trade-size bucket mapping, alert thresholds, news/sentiment correlation, and a historical flow-event store for backtesting unusual activity.
**User benefit:** Surface unusual activity before the move, and rewind to study how prior flow played out.

### 3. Trade — execution & live position management
**One-liner:** Greeks-aware option chains and direct broker execution from the chart.
**Description:** Real-time option chains with delta/gamma/theta/vega, multi-leg ticket, replace/cancel/preview support, live P&L tracker, and chart integration for entry/exit reasoning.
**User benefit:** Skip the broker UI. Build, price, and route multi-leg orders without losing your chart context.

### 4. Account — portfolio analytics
**One-liner:** A real-time, Greeks-aware view of your portfolio.
**Description:** Account summary, positions, equity curve, allocation breakdown, cash activity, order history, closed-trade ledger, and account-health metrics — all SSE-streamed live.
**User benefit:** See your exposure the way a risk desk does, not the way a retail broker shows it.

### 5. GEX — gamma exposure & dealer positioning
**One-liner:** See where dealers are pinned.
**Description:** Gamma exposure heatmap by expiry and strike, squeeze detection with narrative explanations, open-interest concentration analysis, and price-level gamma profiles.
**User benefit:** Read the market's hidden structure — pinning levels, squeeze risk, dealer reflexivity.

### 6. Research — Photonics Observatory
**One-liner:** Thematic research that flows straight into a trade ticket.
**Description:** Theme-based stock universes (AI, Defense, Photonics, etc.), earnings calendar, SEC filings, financial fundamentals, earnings-call transcripts, supply-chain notes, and a one-click "jump to trade" path.
**User benefit:** Connect a thesis to a position without losing the trail.

### 7. Signal Monitor — pattern-matching engine
**One-liner:** Codeless technical signals, evaluable on any symbol, any timeframe.
**Description:** Build and reuse signal profiles (support/resistance breaks, volume breakouts, candlestick patterns) across 1m–1d timeframes; evaluate one symbol or a full matrix; persistent event history; pluggable into automation.
**User benefit:** Stop watching charts. Let the chart watch itself.

### 8. Algo — strategy deployment & live cockpit
**One-liner:** Run options strategies that fire when your signals do.
**Description:** Deploy multi-leg option strategies (spreads, straddles, collars, etc.) triggered by signal-monitor events; switch between paper and live; track execution events, diagnostics, deviations, and shadow-vs-live divergence in real time.
**User benefit:** Move from "I should have taken that trade" to "the system already did."

### 9. Backtest — historical strategy validation
**One-liner:** Test, sweep, optimize, promote.
**Description:** Draft strategies, run them across historical date ranges and universes, launch parameter sweeps and studies, compare results, and promote winners to live deployments.
**User benefit:** Validate edge before you bet on it.

### 10. Shadow Account — paper trading with realism
**One-liner:** A second account that trades alongside yours, in simulation.
**Description:** Virtual account mirroring real balances and positions, with realistic fills, commissions, and replay of past market data. Run automation in shadow mode before flipping to live.
**User benefit:** Prove the strategy first. Risk capital second.

### 11. Diagnostics — system health
**One-liner:** Know what your data is doing.
**Description:** Chart-data hydration stats, broker stream freshness/lag, memory pressure, and market-data subscription status — for the trader who wants to trust their tape.
**User benefit:** When something feels off, know whether it's the market or your feed.

### 12. Settings — workspace customization
**One-liner:** Make it feel like yours.
**Description:** Light/dark themes, accent palettes (coral, amber, green, aurora), UI density, scale, sidebar behavior, IBKR bridge config.
**User benefit:** A terminal that adapts to your eyes, your screen, and your habits.

## Platform capabilities (cross-cutting)

These don't sell as standalone screens but matter for trust and differentiation:

### Bridge Governor
Per-category concurrency limits, failure thresholds, and exponential backoff on the IBKR connection. **Marketing angle:** "Your broker connection doesn't fall over when you load it up."

### Lane Policy
Named data lanes (equity quotes, option quotes, flow scanner, option-chain metadata, historical bars, account control, orders control) with per-lane capacity and source priority. **Marketing angle:** "Options flow scanning never starves your account monitor of real-time data."

### Market-Data Admission
Cost-aware allocator that routes IBKR's expensive real-time lines to the highest-intent requests (execution > account monitor > visible chart > automation > watchlist), with automatic fallback to Polygon delayed data when lines are exhausted. **Marketing angle:** "Real-time data where it matters, delayed where it doesn't, never an outage in between."

### Pine Script support
Custom indicators in the language traders already know, reusable across every chart surface. **Marketing angle:** "Bring your TradingView indicators with you."

### Streaming everywhere
Server-sent events power live quotes, account snapshots, order updates, executions, options chains, flow, and the algo cockpit. **Marketing angle:** "If it changes, you see it change."

### Graceful degradation
IBKR primary → Polygon delayed → cache, transparently. **Marketing angle:** "We assume your data will fail. You shouldn't have to."

### Database-backed state
PostgreSQL stores deployments, executions, flow history, signal profiles, backtest runs. **Marketing angle:** "Your history is yours. Forever."

## Integrations

| Partner | Role |
|---|---|
| **Interactive Brokers** | Live orders, positions, executions, account data, real-time quotes, option chains (via TWS / IB Gateway through a local bridge helper) |
| **Polygon.io** | Secondary market data: real-time + delayed quotes, bars, options chains, flow events, news, ticker universe |
| **Financial Modeling Prep** | Research: financials, fundamentals, SEC filings, earnings-call transcripts |

Copy hint for the website: *"Starting with Interactive Brokers — additional brokers on the roadmap."*

## What's genuinely different about Pyrus

Most retail-facing terminals stop at "fast quotes and a chart." Most algo platforms stop at "backtest engine + cloud runner." Pyrus is the rare product that combines:

- A **broker-native execution surface** (the Trade screen, not a third-party API wrapper)
- A **streaming flow + GEX layer** for reading market microstructure
- A **signal monitor + algo cockpit + shadow account + backtester** that share the same data, the same execution path, and the same audit trail
- A **broker governance layer** (Bridge Governor, Lanes, Admission) usually only built by trading firms in-house

You can move from "I noticed unusual flow" → "let me chart it" → "let me build a signal for that pattern" → "let me backtest it" → "let me shadow-trade it" → "let me deploy it" without leaving the app or re-keying anything.

---

# PART 2 — Long-Form Product Description

## Pyrus: The trading terminal you'd build for yourself

There are two kinds of trading software in the world.

The first kind is your broker's UI. It works. It places orders. It shows you a balance. And on a good day it makes you wonder why nothing about it has changed since 2014.

The second kind is the patchwork: a charting tool open in one tab, a flow scanner in another, an options analytics site in a third, a spreadsheet for backtesting, a Discord for signals, a separate broker for execution. By the time you've assembled a workflow that actually matches the way you think, you've stitched together five subscriptions, three browser tabs, and the patience of a saint.

**Pyrus is what happens when you decide both of those are unacceptable.**

It's a professional-grade trading terminal — single workspace, single source of truth — that ties together everything an active trader needs: real-time market data, options flow, Greeks-aware chains, portfolio risk, gamma exposure, thematic research, codeless signal building, full backtesting, shadow-traded paper accounts, and live algorithmic execution. Starting with Interactive Brokers as the broker. Built for traders who already know what they're doing and want a tool that respects that.

## See the market the way the market sees itself

Most retail platforms show you price. Pyrus shows you the structure underneath price.

The **Flow** screen streams options activity in real time, with a premium-distribution visualization that makes unusual size obvious at a glance. Filter by alert thresholds. Correlate with news. Then jump back through the historical flow-event store to study how prior unusual activity actually played out — not from memory, from data.

The **GEX** screen renders gamma exposure as a heatmap by expiry and strike. Dealer positioning. Squeeze detection. Open-interest concentration. Price-level gamma profiles. The kind of read that institutional desks build internally — surfaced for any symbol, on demand.

The **Market** screen is a multi-symbol charting grid with macro overlays — VIX, yield curves, sector breadth — and live signal-monitor recommendations rendered directly on the chart. Drawing tools, multiple timeframes, news, earnings, and your own Pine Script indicators included.

You don't tab between tools. You don't lose context. The chart, the flow, the Greeks, the news, and the order ticket are one workspace.

## Execute without leaving the workspace

The **Trade** screen is a broker-native execution surface, not a third-party API wrapper. Real-time option chains with delta, gamma, theta, and vega. Multi-leg tickets. Preview, replace, cancel. Live P&L tied to the chart you're staring at.

Behind it: an Interactive Brokers integration designed by people who've watched IBKR connections die under load and decided that wasn't acceptable. The **Bridge Governor** enforces per-category concurrency, failure thresholds, and exponential backoff so heavy use never takes the connection down. The **Lane Policy** divides IBKR data subscriptions into named lanes — quotes, options, flow scanner, account control, orders — each with its own capacity and source priority, so spinning up an options flow scan doesn't starve your account monitor. The **Market-Data Admission** policy treats real-time lines as the scarce resource they are, routing them to the highest-intent requests (execution first, then account monitoring, then your visible chart, then automation, then watchlists) with automatic fallback to delayed data when lines are exhausted.

This is the infrastructure trading firms build for themselves. It's running underneath your trade ticket.

## Understand your portfolio the way a risk desk does

The **Account** screen shows you the things your broker won't.

A real-time equity curve. Allocation breakdown by sector and instrument. Cash activity and funding history. Closed-trade ledger. Order history with full execution audit. Account-health metrics. And — because it matters — your portfolio's net Greeks: delta, gamma, theta, vega, aggregated across every position you hold.

You'll see your concentration risk, your net directional exposure, your theta burn, your gamma profile. Not as a snapshot. Streamed live.

## From idea to live algo without leaving the app

This is where Pyrus separates itself from a "nice terminal."

**Signal Monitor** lets you build technical signals without writing code: support/resistance breaks, volume breakouts, candlestick patterns, across timeframes from one minute to one day. Evaluate them against a single symbol or a matrix of symbols and timeframes. Save profiles. Reuse them. See event history for every signal that's fired.

**Algo** turns those signals into automated multi-leg option strategies — spreads, straddles, collars, anything you can express. Deploy them in paper mode first. Watch the cockpit stream execution events, diagnostics, and deviations in real time. Track divergence between your shadow runs and live runs. When you trust it, flip the switch.

**Backtest** lets you validate strategies before deploying them. Draft a strategy, run it across historical date ranges and universes, launch parameter sweeps and studies, compare runs side by side, and promote winners directly into the deployment cockpit. No exporting. No re-keying. The same definition that backtested is the same definition that goes live.

**Shadow Account** runs alongside everything. A virtual account that mirrors your real balances and positions, executes trades in simulation with realistic fills and commissions, and even replays historical market data when you want to stress-test logic against past conditions. Run an automation in shadow for a week. Compare it to your live account. Decide based on data, not gut.

The same data feeds the chart, the flow scanner, the signal monitor, the backtester, the shadow account, and the live deployment. The same execution path runs through all of them. Your strategy never has to be re-implemented when you move from idea to capital.

## Research the way analysts do

The **Research** workspace — internally codenamed Photonics Observatory — is built around thematic stock universes. AI. Defense. Photonics. Whatever you care about. Each universe pulls in earnings calendars, SEC filings, financial fundamentals, earnings-call transcripts, peer comparisons, supply-chain notes, and competitive-edge analysis. One click takes you from a research note into a trade ticket with the symbol pre-loaded.

This isn't a news widget. It's a place to actually think about a thesis.

## Built for trust

Trading platforms fail in three ways: the broker drops the connection, the data source flakes, or the platform itself silently shows you stale information. Pyrus assumes all three will happen.

The **Diagnostics** screen surfaces what your data is doing: chart hydration stats, broker stream freshness and lag, memory pressure, market-data subscription state. When something feels off, you can see whether it's the market or your feed.

Fallback logic is built in everywhere. IBKR is primary; Polygon serves as the delayed/cached fallback; both are observable. If real-time lines are exhausted, Pyrus demotes to delayed data automatically rather than leaving you with a frozen quote.

Your history — deployments, executions, flow events, signal profiles, backtests — is stored in your own PostgreSQL database. Your strategies and their performance belong to you.

## A terminal that feels like a terminal

Pyrus isn't a SaaS dashboard pretending to be a trading app. It looks and behaves like an instrument. Light and dark modes. A warm coral / cream palette with selectable accents — coral, amber, green, aurora. IBM Plex Sans. UI density and scale controls. Sidebar that collapses out of your way. Active screens stay resident in memory so you never wait for them to reload.

You'll spend twelve hours a day staring at this. It's designed to be looked at for twelve hours.

## Who Pyrus is for

- Serious **retail options traders** who already use Interactive Brokers and want a real terminal — flow, Greeks, GEX, fast execution — instead of TWS.
- **Algo-curious traders** moving from discretionary to systematic, who want codeless signals, paper-traded shadow accounts, and a full backtest engine without writing Python.
- **Systematic and quant traders** who want a deployment cockpit, parameter sweeps, divergence tracking, and Pine Script support without renting a cloud.
- **Professionals, prop traders, and RIAs** who need real risk visibility, audit trails, and a broker integration that doesn't fall over.

## Where it's going

Pyrus's roadmap pushes in three directions: additional broker integrations beyond Interactive Brokers, deeper macro and microstructure overlays on the chart, and richer automation patterns including multi-strategy portfolios and risk-aware position sizing.

For now: one workspace, one broker, every tool an active options trader actually needs.

---

# Appendix — Useful references for the marketing site

## Existing brand language (verbatim, from `replit.md`)

> "Pyrus Platform. React + Vite trading terminal with the platform shell, runtime providers, charting, market, flow, trade, account, research, algo, backtest, diagnostics, and settings code split under `src/features`, `src/screens`, and `src/components/platform`."

## Asset suggestions for the site

- Hero: screenshot of the Market screen with a chart, signal overlay, and a flow event panel visible
- Section "See the flow": Flow screen with premium distribution bars
- Section "Read the structure": GEX heatmap screenshot
- Section "Trade from the chart": Trade screen with multi-leg ticket open
- Section "Know your portfolio": Account screen with equity curve and Greeks
- Section "From idea to algo": three-up of Signal Monitor → Backtest → Algo cockpit
- Footer: small Logical Origins logo, IBKR partner badge

## Recommended site structure (if it helps)

1. **Hero** — one-liner + screenshot + "Get early access" CTA
2. **The problem** — three-tab story: your broker's UI vs. the patchwork vs. Pyrus
3. **Feature grid** — Market / Flow / Trade / Account / GEX / Research / Algo / Backtest
4. **Deep-dive section** — "From idea to live algo" (the chain: signal → backtest → shadow → deploy)
5. **Trust section** — Bridge Governor, Lane Policy, Admission, Diagnostics (positioned as "the infrastructure under your trades")
6. **Integrations** — IBKR primary, Polygon, FMP; "more brokers coming"
7. **Who it's for** — four personas with one-line fits
8. **FAQ** — broker requirements, paper trading, data costs, Pine Script support, self-hosted vs. hosted
9. **Footer CTA** — sign up / waitlist / contact info@logicalorigins.com
