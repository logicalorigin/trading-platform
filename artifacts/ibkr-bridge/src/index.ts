import app from "./app";
import { logger } from "./logger";
import { ibkrBridgeService } from "./service";

const port = Number(process.env["PORT"] ?? "3002");

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

const server = app.listen(port, (err) => {
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

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "IBKR bridge shutting down");
  server.close((error) => {
    if (error) {
      logger.warn({ err: error }, "IBKR bridge HTTP server shutdown failed");
    }
    void ibkrBridgeService
      .shutdown()
      .catch((shutdownError) => {
        logger.warn(
          { err: shutdownError },
          "IBKR bridge provider shutdown failed",
        );
      })
      .finally(() => {
        process.exit(error ? 1 : 0);
      });
  });
  setTimeout(() => {
    logger.warn({ signal }, "IBKR bridge shutdown timed out");
    process.exit(1);
  }, 5_000).unref();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
