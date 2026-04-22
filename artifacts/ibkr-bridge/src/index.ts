import app from "./app";
import { logger } from "./logger";
import { ibkrBridgeService } from "./service";

const port = Number(process.env["PORT"] ?? "5002");

const DEFAULT_PREWARM_SYMBOLS = [
  "SPY",
  "QQQ",
  "IWM",
  "VIXY",
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "META",
  "TSLA",
  "GOOGL",
  "AMD",
];

const parsePrewarmSymbols = (): string[] => {
  const raw = process.env["IBKR_BRIDGE_PREWARM_SYMBOLS"];
  if (raw === undefined) return DEFAULT_PREWARM_SYMBOLS;
  return raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
};

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "IBKR bridge listening");

  // Pre-warm IBKR market-data subscriptions in the background so the
  // first user-facing snapshot request finds populated cache entries
  // instead of paying the cold-start cost (contract resolution + WS
  // subscribe + first-tick latency = ~1-3s per batch).
  const prewarmSymbols = parsePrewarmSymbols();
  if (prewarmSymbols.length > 0) {
    setTimeout(() => {
      void ibkrBridgeService
        .prewarmQuoteSubscriptions(prewarmSymbols)
        .catch((error) => {
          logger.warn({ err: error }, "IBKR bridge prewarm scheduling failed");
        });
    }, 1_000);
  }
});
