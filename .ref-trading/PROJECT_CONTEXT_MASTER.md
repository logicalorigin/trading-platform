# SPY Options Multi-Agent Trading Platform — Master Context

## Project Overview
Building an automated intraday SPY options trading platform that combines:
- Smart Money Concepts (SMC) technical indicators
- HMM regime detection
- Sentiment analysis (FinBERT + options flow)
- Multi-agent orchestration (LangGraph + NautilusTrader)
- Real-time execution via broker API

---

## Phase 1: Strategy Research & Initial Backtest (Complete)

### Trading Approach
Two complementary strategies for SPY intraday options:
1. **Trend Following**: EMA crossovers + SMC structure confirmation + momentum
2. **Mean Reversion**: Liquidity sweeps + VWAP deviation + RSI extremes

### Indicators Implemented
- **SMC**: BOS/CHoCH (market structure), order blocks, fair value gaps, liquidity sweeps
- **LuxAlgo/Ray Algo style**: VWAP with σ bands, RSI(14), EMA crossovers (9/21/50)
- **HMM Regime Detection**: 3-state model (bullish trend, bearish trend, mean-reverting)

### Initial Backtest Results (60 days, Dec 2025 - Feb 2026)
- **Period**: Dec 2, 2025 – Feb 27, 2026 on SPY 5-min bars
- **Starting capital**: $25,000
- **Result**: -20.79% return (128 trades, 42.2% WR)
- **Critical finding**: Structure break exits destroyed performance (57 trades, 28.1% WR, -$4,729)
- **What worked**: Take profit exits (13 trades, 100% WR, +$6,089, avg $468/trade)
- **Key issues**: (1) SMC structure too sensitive on 5min, (2) HMM detected 0 choppy regimes, (3) mean reversion filters too strict (only 25 trades)

### Files
- Historical prototype files for this phase were removed from the working tree during archival cleanup.
- Use git history if the original backtest script or dashboard needs to be recovered.

---

## Phase 2: Strategy Optimization Sweep (Complete)

### Sweep Parameters Tested
- **Strategies**: momentum_breakout, sweep_reversal, vwap_reversion, structure_trend
- **Exit configs**: tight (25% SL / 35% TP), wide (40% SL / 60% TP), scalp (20% SL / 25% TP)
- **DTE**: 1, 3, 5
- **Strike offsets**: 0 (ATM), 1 (1 OTM), -1 (1 ITM)
- **Regime filters**: none, bull_only, not_bear
- **Time filters**: none, morning_only

### Top 5 Configurations (by composite score)
| Rank | Strategy | Exits | DTE | Regime | Trades | WR | PF | Return | MaxDD | Score |
|------|----------|-------|-----|--------|--------|------|------|--------|-------|-------|
| 1 | momentum_breakout | wide | 5 | not_bear | 37 | 59.5% | 1.94 | 10.72% | 2.72% | 87.1 |
| 2 | sweep_reversal | tight | 3 | none | 31 | 67.7% | 1.54 | 10.14% | 5.0% | 81.5 |
| 3 | sweep_reversal | tight | 3 | not_bear | 27 | 66.7% | 1.51 | 9.03% | 4.52% | 80.4 |
| 4 | momentum_breakout | scalp | 5 | not_bear | 42 | 54.8% | 1.50 | 15.12% | 8.19% | 78.0 |
| 5 | momentum_breakout | scalp | 3 | not_bear | 42 | 52.4% | 1.46 | 17.63% | 10.38% | 77.6 |

### Key Optimization Insights
- **Momentum breakout dominates**: 11 of top 30, avg score 75.5
- **Sweep reversal is complementary**: 4 of top 30, avg score 76.7 — higher WR but fewer trades
- **ATM strikes (offset=0) universally best** — OTM bleeds too much theta
- **5DTE with wide exits = best risk-adjusted** (lowest DD at 2.72%)
- **"not_bear" regime filter consistently improves results** — don't fight the trend
- **Call side massively outperforms puts** (73.7% vs 44.4% WR in #1 config)

### Files
- Historical prototype files for this phase were removed from the working tree during archival cleanup.
- Use git history if the original sweep engine or optimizer dashboard needs to be recovered.

---

## Phase 3: Sentiment & Multi-Agent Research (Complete)

### Sentiment Data Stack (Recommended ~$100/month)
| Provider | Cost | Signal Type | Key Endpoint |
|----------|------|-------------|--------------|
| **Unusual Whales** | $48/mo | Options flow (primary) | `/api/market/market-tide` |
| **Alpha Vantage** | $50/mo | News sentiment | `NEWS_SENTIMENT` |
| **Finnhub** | Free | Social sentiment | `/api/v1/news-sentiment` |

### NLP Models for Sentiment
- **FinBERT** (ProsusAI/finbert): 5-15ms GPU latency, ~87% accuracy — real-time hot path
- **FinGPT v3**: 200-500ms, ~90% accuracy — deeper batch analysis
- **Two-tier architecture**: FinBERT for instant scoring, Claude/FinGPT for delayed deep analysis

### Multi-Agent Architecture (Hybrid LangGraph + NautilusTrader)

```
┌─────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                    │
│              NautilusTrader Controller                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Sentiment   │  │   Regime     │  │    Risk       │  │
│  │   Actor      │  │  Detection   │  │   Monitor     │  │
│  │  (FinBERT +  │  │   Actor      │  │    Actor      │  │
│  │  UW Flow)    │  │  (HMM +      │  │  (Portfolio   │  │
│  │             │  │   SMC)       │  │   Greeks)     │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬────────┘  │
│         │                │                  │            │
│         ▼                ▼                  ▼            │
│  ┌──────────────────────────────────────────────────┐   │
│  │              MessageBus (signals)                 │   │
│  └──────────────────────────────────────────────────┘   │
│         │                │                  │            │
│         ▼                ▼                  ▼            │
│  ┌─────────────┐  ┌──────────────┐                      │
│  │  Momentum   │  │   Sweep      │                      │
│  │  Breakout   │  │  Reversal    │                      │
│  │  Strategy   │  │  Strategy    │                      │
│  └─────────────┘  └──────────────┘                      │
│                                                          │
├─────────────────────────────────────────────────────────┤
│              LLM Analysis Layer (async)                   │
│    LangGraph: Bull/Bear debate → structured signals      │
│    Claude/FinGPT: Deep article analysis (1-5min delay)   │
└─────────────────────────────────────────────────────────┘
```

### Regime-Dependent Signal Weights
```python
REGIME_WEIGHTS = {
    "trending_bull":   {"sentiment": 0.35, "technical": 0.20, "options_flow": 0.25, "volume": 0.20},
    "trending_bear":   {"sentiment": 0.25, "technical": 0.25, "options_flow": 0.30, "volume": 0.20},
    "high_volatility": {"sentiment": 0.15, "technical": 0.30, "options_flow": 0.35, "volume": 0.20},
    "range_bound":     {"sentiment": 0.20, "technical": 0.35, "options_flow": 0.25, "volume": 0.20},
}
```

### Key Academic Findings
- Sentiment + technicals beats pure technicals by 15-50% annualized
- Economy-wide sentiment predicts better than stock-specific (good for SPY)
- Intraday sentiment impact > overnight (good for our timeframe)
- Negative sentiment more predictive than positive → weight bearish signals more
- VIX/options-derived implied sentiment captures ~45-50% of return variation
- RavenPack Sentiment Index: 17.5% annualized, IR 0.81 out-of-sample

### Key GitHub Repos
- **virattt/ai-hedge-fund** (46K★): LangGraph multi-agent, famous investor agents
- **TauricResearch/TradingAgents** (3-5K★): 7-role trading firm simulation, structured debate
- **AI4Finance-Foundation/FinGPT** (18.7K★): Financial LLM ecosystem
- **AI4Finance-Foundation/FinRL** (14K★): Deep RL for trading
- **ProsusAI/finBERT** (1.7K★): The standard sentiment model
- **CRITICAL GAP**: No project combines multi-agent LLM + options trading

### Research Reports
- `Building_an_Automated_Options_Trading_Platform_with_NautilusTrader.md` — In project files
- `Building_a_Sentiment-Driven_Multi-Agent_SPY_Options_Trading_Platform.md` — In project files

---

## Phase 4: Executable Strategy (NEXT)

### Priority Improvements to Implement
1. **Fix structure break exits** — Require 2+ consecutive bars OR higher timeframe confirmation
2. **Add sentiment layer** — FinBERT headline scoring + Unusual Whales flow data
3. **Improve HMM** — Tune to detect 4 states including choppy/high-vol
4. **Combine top strategies** — Run momentum_breakout + sweep_reversal simultaneously
5. **Fractional Kelly sizing** — Quarter-Kelly with VIX scaling
6. **Asymmetric call/put treatment** — Larger positions on calls during bullish regimes

### Winning Configuration to Build From
**Primary**: Momentum Breakout — 5DTE ATM, wide exits (40%SL/60%TP), not_bear regime filter
**Secondary**: Sweep Reversal — 3DTE ATM, tight exits (25%SL/35%TP), no regime filter
**Sentiment overlay**: FinBERT scores + UW flow → composite confidence → position sizing

### Technical Stack
- **Execution**: NautilusTrader (Rust core, Python bindings)
- **Data**: Polygon.io ($398/mo real-time) or Databento (native NT adapter)
- **Broker**: Interactive Brokers TWS API or E-Trade
- **Sentiment**: FinBERT (ONNX) + Unusual Whales API + Finnhub
- **Agent Framework**: LangGraph for reasoning, NT Controller for orchestration
- **Frontend**: TradingView Advanced Charts + React (AG Grid, react-mosaic)
- **Infrastructure**: VPS (Hetzner ~$10/mo) + Redis + Docker

---

## User Profile
- Advanced options trader with substantial capital
- Background in crypto trading (Kalshi/Binance), HMM regime detection
- Currently trading SPY options intraday (trend following + mean reversion)
- Building toward full automation with agentic capabilities
- Technical stack: NautilusTrader, E-Trade API, Polygon.io, TradingView
