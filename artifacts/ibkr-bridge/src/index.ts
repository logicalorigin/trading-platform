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
        .prewarmQuoteSubscriptions(prewarmSymbols, "bridge-startup")
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

  // Disconnect from TWS first. provider.shutdown() is synchronous and fast,
  // so the Gateway releases our API client slot immediately. Previously this
  // was gated behind server.close(), whose callback waits for every open
  // connection to drain -- but the API server holds long-lived SSE streams
  // (quotes/options/bars) that never end on their own, so the callback never
  // fired and shutdown always fell through to the hard-exit timeout below,
  // killing the socket WITHOUT a clean disconnect and leaving a zombie client
  // that slows the next launch.
  const providerShutdown = ibkrBridgeService.shutdown().catch((shutdownError) => {
    logger.warn({ err: shutdownError }, "IBKR bridge provider shutdown failed");
  });

  // Stop accepting new connections and force-close the lingering SSE /
  // keep-alive sockets so the HTTP server tears down promptly instead of
  // waiting on streams that never close.
  server.close((error) => {
    if (error) {
      logger.warn({ err: error }, "IBKR bridge HTTP server shutdown failed");
    }
  });
  server.closeAllConnections?.();

  void providerShutdown.finally(() => {
    // Brief grace so the TWS disconnect flushes to the Gateway before exit.
    setTimeout(() => process.exit(0), 300).unref();
  });

  setTimeout(() => {
    logger.warn({ signal }, "IBKR bridge shutdown timed out");
    process.exit(1);
  }, 2_000).unref();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
