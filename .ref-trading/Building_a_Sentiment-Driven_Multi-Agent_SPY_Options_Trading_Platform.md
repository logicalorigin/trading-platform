# Building a sentiment-driven multi-agent SPY options trading platform

**The most viable architecture for an automated SPY intraday options trading platform combines FinBERT for sub-20ms headline scoring, options flow data from Unusual Whales as the primary "smart money" signal, and a multi-agent system orchestrated through either LangGraph or NautilusTrader's Controller pattern.** No major open-source project currently combines LLM multi-agent coordination with options trading — this is an unserved niche. The academic consensus is clear: sentiment alone underperforms, but sentiment combined with technical indicators and regime detection consistently beats pure technical strategies by **15–50%** in annualized returns across multiple backtests.

---

## Real-time sentiment APIs and what they actually provide

The sentiment data landscape divides sharply into retail-accessible APIs (under $200/month) and institutional-grade feeds ($10K+/year). For SPY options specifically, **options flow sentiment outperforms text-based news sentiment** because informed positioning in the options market precedes price moves.

### Tier 1: Essential for SPY options (retail-accessible)

**Unusual Whales** ($35–48/month) is the single most valuable data source for SPY options traders. Its Market Tide endpoint (`/api/market/market-tide`) provides real-time net call/put premium flow — a direct bull/bear sentiment gauge from actual institutional positioning. Flow Alerts surface unusual activity filtered by premium size, OTM strikes, and volume-to-open-interest ratios. Dark pool data adds another layer. Bearer token auth, JSON REST API, and an MCP server for Claude integration are all available. The 30-minute opening filter reduces noise.

**Alpha Vantage** ($49.99/month for 75 req/min) offers the most accessible ML-powered news sentiment via `NEWS_SENTIMENT` endpoint. Each article receives a numeric sentiment score (-0.35 to +0.35) and relevance score per ticker. The free tier allows prototyping at 25 requests/day. An official MCP server enables direct AI agent integration.

**Finnhub** (free tier: 60 req/min) provides the most generous free access. Built-in news sentiment with buzz/bullish/bearish scores, social sentiment from Reddit/StockTwits/Twitter, and WebSocket support for real-time data. The `/api/v1/news-sentiment` and `/api/v1/social-sentiment` endpoints cover both traditional and social media sentiment.

### Tier 2: Valuable additions

| Provider | Cost | Key Feature | Best For |
|----------|------|-------------|----------|
| **Benzinga Pro** | Enterprise (contact sales) | WIM ("Why Is It Moving") — single-sentence catalyst explanations | Catalyst detection for 0DTE |
| **Stocktwits** | Free developer tier | Self-labeled bullish/bearish messages; **more informative than Twitter** per academic validation | Retail sentiment overlay |
| **Financial Modeling Prep** | ~$29/month | Aggregated Reddit/StockTwits/Twitter/Yahoo sentiment (hourly) | Budget social sentiment |
| **EODHD** | ~$20/month | News + AI sentiment scores with word-weight analysis | Cost-effective alternative |

### Tier 3: Institutional grade

**RavenPack** shows the strongest academic validation: its Sentiment Index has **79% correlation with the S&P 500** (2000–2011), rising to ~90% during bear markets. A weekly sentiment trading strategy yielded **17.5% annualized return with an information ratio of 0.81** out-of-sample. Pricing starts at $10K+/year. **Refinitiv/LSEG** News Analytics provides similar capabilities at similar price points. Bloomberg Terminal ($24K/year) integrates BloombergGPT-powered sentiment internally.

**Recommended retail stack**: Unusual Whales ($48) + Alpha Vantage ($50) + Finnhub (free) = **~$100/month** total. This provides options flow sentiment, news headline sentiment, and social sentiment — the three layers needed for comprehensive SPY coverage.

---

## FinBERT dominates for real-time inference, but the model landscape is deeper than expected

For intraday options trading, **inference speed is the critical constraint**. FinBERT processes headlines in 5–15ms on GPU versus 200–1000ms for LLM-based alternatives. This section maps the full model landscape and their practical tradeoffs.

**FinBERT (ProsusAI/finbert)** remains the production standard. Built on BERT-base (110M parameters), pre-trained on Reuters TRC2 financial corpus, and fine-tuned on Financial PhraseBank. It outputs softmax probabilities over three classes (positive/negative/neutral) at **~87% accuracy**. With ONNX + TensorRT optimization, inference drops to **sub-2ms per headline** — fast enough for streaming sentiment analysis. Usage is trivial:

```python
from transformers import pipeline
nlp = pipeline("sentiment-analysis", model="ProsusAI/finbert")
result = nlp("SPY rallies on strong jobs report")  # {'label': 'positive', 'score': 0.97}
```

**FinGPT** (18.7K GitHub stars) provides a powerful open-source alternative when deeper analysis is needed. The v3 series uses LoRA fine-tuning on Llama2-7B/13B, costing under $300 per fine-tune versus BloombergGPT's estimated $2.67M. FinGPT has outperformed BloombergGPT on public sentiment benchmarks. However, the 7B model runs at 200–500ms per sentence — **10–100x slower than FinBERT** — making it suitable only for batch or delayed analysis.

**BloombergGPT** (50B parameters) is not publicly available and has been surpassed by open models on public benchmarks. Its significance is historical — it demonstrated that finance-specific pre-training works, but FinGPT and FinBERT now serve the same purpose accessibly.

| Model | HuggingFace Path | GPU Latency | Accuracy | Best Use |
|-------|-----------------|-------------|----------|----------|
| **FinBERT** | `ProsusAI/finbert` | ~5–15ms | ~87% | ⭐ Real-time headline scoring |
| **FinancialBERT** | `ahmedrachid/FinancialBERT-Sentiment-Analysis` | ~5–15ms | ~88% | Alternative to FinBERT |
| **Modern-FinBERT-large** | `beethogedeon/Modern-FinBERT-large` | ~15–30ms | Improved | Longer text analysis |
| **FinGPT v3 (7B)** | `FinGPT/fingpt-sentiment_llama2-7b_lora` | ~200–500ms | ~85–90% | Batch deeper analysis |
| **FinGPT v3 (13B)** | `FinGPT/fingpt-sentiment_llama2-13b_lora` | ~500–1000ms | ~90%+ | Highest accuracy, offline |
| **GPT-4/Claude (zero-shot)** | API | ~500–2000ms | ~80–85% | Flexible reasoning, expensive |

**The optimal two-tier strategy**: Use FinBERT for real-time headline scoring (the "fast path") and FinGPT or Claude for deeper article analysis on a 1–5 minute delayed basis (the "deep path"). This mirrors how human trading desks operate — quick initial reaction followed by deeper analysis.

---

## Multi-agent architecture: how TradingAgents and NautilusTrader define the space

Two architectural paradigms dominate multi-agent trading systems, and they serve different layers of the stack. **LLM-based agent frameworks** (LangGraph, CrewAI) handle reasoning and analysis. **Event-driven execution platforms** (NautilusTrader) handle order management and market interaction. The production answer combines both.

### The TradingAgents paradigm: trading firm simulation

**TradingAgents** (UCLA/MIT, arXiv:2412.20138) is the most influential multi-agent trading architecture, modeling a real trading firm with seven specialized roles:

1. **Fundamentals Analyst** — evaluates balance sheets, cash flow, earnings
2. **Sentiment Analyst** — scores social media and public sentiment
3. **News Analyst** — monitors global news and macro indicators
4. **Technical Analyst** — applies MACD, RSI, and pattern detection
5. **Bull/Bear Researchers** — engage in structured debate, balancing upside vs. risk
6. **Trader Agent** — synthesizes debate output into position decisions
7. **Risk Manager + Fund Manager** — three-perspective risk assessment, final execution approval

The key innovation is **structured debate**: Bull and Bear researchers argue opposing positions, forcing the system to explicitly confront both upside and downside scenarios before any trade. Communication uses a MetaGPT-inspired structured protocol rather than pure natural language, avoiding "telephone game" information degradation.

TradingAgents uses differentiated LLM selection — quick-thinking models (GPT-4o-mini) for data retrieval and summarization, deep-thinking models (o1-preview) for reasoning-intensive decisions. This is built entirely on LangGraph.

### NautilusTrader's native multi-agent architecture

NautilusTrader provides a fundamentally different but complementary pattern using its **Controller, Actor, and Strategy** classes. The Controller class is the orchestration primitive — it can dynamically create, start, stop, and remove Actors and Strategies based on market conditions. Three messaging patterns enable coordination:

- **Direct MessageBus Pub/Sub** — lowest-level, topic-based messaging
- **Actor-based custom Data** — structured trading data (regime state, sentiment scores) published and subscribed as typed objects
- **Signal Pub/Sub** — lightweight notifications (risk threshold breaches, regime changes)

The recommended multi-agent pattern with NautilusTrader:

```
Controller (meta-agent / orchestrator)
├── SentimentActor → subscribes to news feed, publishes SentimentData
├── RegimeDetectionActor → subscribes to bars, publishes RegimeData
├── RiskMonitorActor → subscribes to portfolio events, publishes risk signals
├── AlphaStrategy → subscribes to SentimentData + RegimeData, manages orders
└── ExecutionAlgorithm → TWAP/VWAP specialized execution
```

**Actors** handle non-order-generating tasks (sentiment scoring, regime detection, risk monitoring). **Strategies** inherit from Actor and add order management capabilities. The **Controller** dynamically activates/deactivates strategies based on regime detection or risk signals. Everything communicates through NautilusTrader's MessageBus with nanosecond-precision event handling, and the **same code runs identically in backtest and live** — a critical advantage over LLM-framework-only approaches.

### The hybrid architecture: LLM reasoning + execution engine

The production-grade architecture bridges both worlds:

```python
# LLM Analysis Layer (runs on longer time horizons: minutes to hours)
# CrewAI/LangGraph for sentiment analysis, fundamental analysis, regime detection
# Produces structured signals as custom NautilusTrader Data objects

@customdataclass
class LLMSignal(Data):
    ticker: str
    direction: str       # "bullish", "bearish", "neutral"
    confidence: float    # 0.0 to 1.0
    reasoning: str       # LLM-generated explanation

# NautilusTrader Execution Layer (runs at tick-level: microseconds)
# Strategies subscribe to LLMSignal data, handle order management,
# risk checks, and execution with nanosecond precision
```

This separation ensures LLM latency (~seconds) never interferes with execution latency (~microseconds), while preserving LLM interpretability for higher-level decisions.

---

## Agent frameworks compared: LangGraph leads, but each has a role

### LangGraph: the clear winner for trading agents

LangGraph powers the two most important open-source trading projects — **ai-hedge-fund** (46K stars) and **TradingAgents** (3–5K stars). Its graph-based state management provides full visibility at every node, time-travel replay for debugging, and conditional branching for complex decision flows. The architecture maps naturally to trading workflows:

```python
graph = StateGraph(TradingState)
graph.add_node("sentiment", sentiment_agent)
graph.add_node("technicals", technicals_agent)
graph.add_node("risk_manager", risk_agent)
graph.add_node("portfolio_manager", portfolio_agent)
graph.add_conditional_edges("risk_manager", should_trade,
    {"trade": "portfolio_manager", "skip": END})
```

**Downside**: steep learning curve and verbose boilerplate. But for trading, where debuggability and state inspection are critical, this tradeoff is worth it.

### CrewAI: fastest prototyping

CrewAI's role-based team metaphor makes it the fastest to prototype. **AITradingCrew** demonstrates a three-phase approach: Market Environment Analysis → Per-Stock Analysis → Trading Recommendations, using agents for market overview, technical analysis, fundamental analysis, and trading advice. YAML-driven configuration reduces boilerplate. However, **FenixAI migrated from CrewAI to LangGraph** for better robustness in production, suggesting CrewAI's ceiling for complex trading systems.

### AutoGen: strong for code execution

Microsoft's AutoGen excels at code execution in Docker containers, making it ideal for agents that need to run quantitative analyses. **FinRobot** (6.3K stars) uses AutoGen for its multi-agent workflows combining market forecasting, document analysis, and trading strategy agents. **AutoTrader-AgentEdge** implements walk-forward validation with momentum strategies using AutoGen's event-driven messaging. Note: Microsoft has announced the "Microsoft Agent Framework" as AutoGen's successor.

| Feature | LangGraph | CrewAI | AutoGen |
|---------|-----------|--------|---------|
| **Trading maturity** | ⭐ Excellent | Good | Good |
| **Debugging** | Best (state inspection, time-travel) | Limited depth | Long conversation traces |
| **State management** | Full at every node | Built-in, moderate | Manual |
| **Production readiness** | Excellent | Good | Good |
| **Learning curve** | High | Low | Medium |
| **Best for** | Complex multi-agent trading | Rapid prototyping | Code execution heavy workflows |

---

## The open-source landscape: key repositories and a critical gap

### Flagship projects (>5,000 stars)

**virattt/ai-hedge-fund** (~46K stars) is the most popular AI trading project on GitHub. It uses LangGraph to orchestrate agents modeled after famous investors (Buffett, Ackman, Burry, Cathie Wood) plus dedicated sentiment, technical, risk, and portfolio management agents. Supports both cloud LLMs and local models via Ollama. Focused on equities, not options.

**AI4Finance-Foundation/FinGPT** (~18.7K stars) provides the most comprehensive open-source financial LLM ecosystem. Data pipelines for real-time financial news/tweets, LoRA fine-tuning on Llama2 bases, RAG integration, and RLHF support. The FinGPT v3 sentiment models are directly usable for sentiment scoring.

**AI4Finance-Foundation/FinRL** (~14K stars) is the definitive deep reinforcement learning framework for trading. Supports DQN, DDPG, PPO, SAC, A2C, TD3 across NASDAQ-100, DJIA, and S&P 500 environments. Multi-agent RL for liquidation analysis. Excellent for learning dynamic signal weights.

**AI4Finance-Foundation/FinRobot** (~6.3K stars) bridges FinGPT and AutoGen into an AI agent platform with Financial Chain-of-Thought prompting, market forecasting agents, and SEC filing analysis.

### Most relevant to multi-agent + sentiment

**TauricResearch/TradingAgents** (~3–5K stars, rapidly growing) is the most architecturally relevant project. Seven specialized agent roles with structured debate, multi-provider LLM support, and data integration from yfinance, Alpha Vantage, Finnhub, and Google News. Built on LangGraph. Academic paper at arXiv:2412.20138.

**ProsusAI/finBERT** (~1.7K stars) provides the foundational sentiment model used across the ecosystem. The HuggingFace model (`ProsusAI/finbert`) is the de facto standard for financial sentiment classification.

### The critical gap

**No major open-source project combines multi-agent LLM systems with options trading or SPY specifically.** All flagship projects focus on equities. Similarly, **no project integrates NautilusTrader with sentiment analysis**. The closest options-related finds are small projects using VADER sentiment with iron condor strategies, and course materials on put/call ratio analysis. This gap represents a significant opportunity — the user's planned system would be genuinely novel in the open-source space.

---

## Pipeline architecture: from news arrival to trade execution

### The five-layer data pipeline

The canonical architecture follows a medallion pattern adapted for real-time trading:

**Layer 1 — Ingestion**: WebSocket connections for price data and options flow (10–50ms latency). REST polling on 15–60 second intervals for news headlines (sentiment alpha decays slowly enough). Async event loop with `asyncio` + `uvloop` feeding into Kafka topics for durability.

**Layer 2 — Sentiment scoring**: FinBERT via ONNX Runtime + TensorRT on GPU achieves **sub-2ms per headline**. Apply temporal decay weighting: `weighted_score = score × exp(-λ × age_minutes)` with typical half-life of 30–120 minutes. For streaming: each headline scored immediately. For micro-batch: accumulate 5–30 seconds, batch-score for better GPU utilization.

**Layer 3 — Signal generation**: Convert scored sentiment into directional signals using thresholds with hysteresis. Combine with technical signals (RSI, MACD, Bollinger, SMC patterns), options flow signals (net premium, unusual activity, put/call ratio), and volume signals (VWAP deviation, OBV).

**Layer 4 — Regime adjustment**: Hidden Markov Models on rolling returns/volatility/VIX features detect market state (trending bull, trending bear, high volatility, range-bound). Regime modifies signal weights dynamically — sentiment weight increases in trends, decreases in high-volatility chop. Options flow weight increases in bear markets and vol spikes.

**Layer 5 — Execution**: Pre-trade risk checks (max position size, correlation limits, Greeks exposure). Strike and expiration selection based on signal conviction and regime. Broker API execution via Interactive Brokers TWS API or Alpaca. Post-trade logging to TimescaleDB for performance analytics.

### Dual message bus: Redis + Kafka

The pragmatic inter-agent communication architecture uses both:

- **Redis Streams** for latency-critical inter-agent communication (sub-millisecond). Broadcasting real-time prices, sharing current signal scores, regime state, and position data. Ephemeral by nature.
- **Apache Kafka** for durable event logging. Every news item, sentiment score, signal, and trade is persisted. Full replay capability enables backtesting from the same event stream used in live trading. Essential for debugging and compliance.

### GPU inference serving for production

Export FinBERT to ONNX, optimize with TensorRT (FP16 quantization), and deploy on NVIDIA Triton Inference Server with dynamic batching. Expected performance: **~1–2ms per headline at batch=1, ~0.5ms/headline at batch=32** on A100. This makes streaming sentiment analysis entirely practical for intraday trading.

---

## How to weight sentiment versus technical signals

The academic and practitioner consensus supports **regime-dependent dynamic weighting** as the highest-impact improvement over static weights.

### Start with regime-dependent weights (V2)

```python
REGIME_WEIGHTS = {
    "trending_bull":   {"sentiment": 0.35, "technical": 0.20, "options_flow": 0.25, "volume": 0.20},
    "trending_bear":   {"sentiment": 0.25, "technical": 0.25, "options_flow": 0.30, "volume": 0.20},
    "high_volatility": {"sentiment": 0.15, "technical": 0.30, "options_flow": 0.35, "volume": 0.20},
    "range_bound":     {"sentiment": 0.20, "technical": 0.35, "options_flow": 0.25, "volume": 0.20},
}
```

The key insight: **sentiment leads in trending markets** (where narrative drives price), **options flow leads in volatile markets** (where informed hedging activity is most visible), and **technicals lead in range-bound markets** (where mean reversion dominates). Use soft blending by multiplying each regime's weights by its HMM probability.

### Position sizing with fractional Kelly

A **hybrid Kelly-VIX approach** is optimal for options: compute Kelly percentage from win rate and average win/loss, apply quarter-Kelly fraction for safety, then scale by signal confidence and VIX percentile rank (higher VIX → smaller positions, capped at 5% per trade). Quarter Kelly captures **~75% of optimal growth with ~50% less drawdown** versus full Kelly.

### Progression path for signal combination

- **V1**: Static weighted scoring with heuristic weights — ship fast, gather data
- **V2**: Regime-dependent weights with HMM regime detection (biggest single improvement)
- **V3**: Black-Litterman Bayesian combination where each signal generates "views" with calibrated confidence
- **V4**: Reinforcement learning meta-layer (PPO or SAC) that dynamically adjusts weights based on state features including VIX, time of day, and recent signal performance

---

## What the academic research actually shows about sentiment trading

The research literature is nuanced. **Sentiment has real but modest predictive power for short-term returns**, and the edge is highly context-dependent.

The strongest findings: **Economy-wide sentiment predicts better than stock-specific sentiment** — directly relevant for SPY. **Intraday sentiment impact is stronger than overnight** — favorable for intraday options. **Negative sentiment is more predictive than positive** — weight bearish signals more heavily. **Implied sentiment (VIX, options-derived) captures ~45–50% of return variation** while text-based sentiment shows weaker standalone predictive power. **Sentiment at extremes works as a contrarian indicator** — AAII survey and CNN Fear & Greed extremes historically precede reversals.

Key backtest results across the literature: a regression-based sentiment model achieved **50.63% total return over 28 months** on Dow Jones 30 stocks, outperforming buy-and-hold. A GPT-2/FinBERT hybrid with MACD and ARIMA delivered **5.77% return over 4 months** on S&P 500 (though assuming zero transaction costs). Sentiment-aware LSTM strategies generated **51.8% higher annualized returns** than sentiment-excluded strategies. RavenPack's Sentiment Index produced **17.5% annualized with IR of 0.81** out-of-sample.

**Critical caveats for SPY specifically**: As the most liquid and most covered instrument, sentiment edge is likely smaller than for individual stocks. Transaction costs erode sentiment alpha significantly — be selective. Many studies assume zero costs and use short test periods. The efficient market hypothesis holds more strongly at short horizons for well-covered instruments.

---

## Conclusion: a novel system in uncharted territory

The planned platform would be **genuinely novel in the open-source space** — no existing project combines multi-agent LLM coordination with options trading on SPY. The recommended architecture uses NautilusTrader as the execution backbone (backtest-live parity, nanosecond precision, native multi-agent support via Controller/Actor/Strategy), LangGraph for LLM-based reasoning agents that produce structured signals, and a dual Redis/Kafka message bus bridging the two layers. FinBERT handles the real-time hot path while FinGPT or Claude provides deeper analysis on delay. Unusual Whales options flow data is the single most valuable sentiment source for SPY options, outweighing text-based sentiment.

The most counterintuitive finding: **implied sentiment from VIX and options market structure captures more predictive variance than any text-based NLP model**. The smartest design would treat options flow and volatility surface signals as primary, with news sentiment as confirmatory. Start with regime-dependent weighted scoring (V2 above), iterate to Bayesian combination, and only then layer on RL-based weight optimization. The AI4Finance ecosystem (FinRL + FinGPT + FinRobot) provides the most comprehensive open-source foundation to build from, while TradingAgents offers the most directly applicable multi-agent architecture to adapt for options.