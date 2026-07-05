# Memory

- Massive market data ingestion is websocket-only. We get market data through websockets. Do not use Massive HTTP snapshot calls as live price ingestion, fallback, or masking for a silent websocket.
- The concurrent options data ingestion migration from IBKR to Massive is separate from the stock price streaming issue, and the stock UI issue predates that migration.
