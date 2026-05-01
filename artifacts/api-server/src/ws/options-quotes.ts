import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { logger } from "../lib/logger";
import {
  fetchOptionQuoteSnapshotPayload,
  subscribeOptionQuoteSnapshots,
} from "../services/bridge-streams";
import type { MarketDataIntent } from "../services/market-data-admission";

const OPTION_QUOTES_WS_PATH = "/api/ws/options/quotes";
const OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS = Math.max(
  0,
  Number.parseInt(
    process.env["OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS"] ?? "0",
    10,
  ) || 0,
);
const HEARTBEAT_INTERVAL_MS = 15_000;
const QUOTE_FLUSH_INTERVAL_MS = 100;
const DEGRADED_BUFFERED_AMOUNT_BYTES = 1_000_000;
const CLOSE_BUFFERED_AMOUNT_BYTES = 5_000_000;
const DEGRADED_QUOTE_BATCH_SIZE = 100;

type Unsubscribe = () => void;

type SubscribeMessage = {
  type?: unknown;
  underlying?: unknown;
  providerContractIds?: unknown;
  owner?: unknown;
  intent?: unknown;
  requiresGreeks?: unknown;
};

function normalizeProviderContractIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }

    const providerContractId = entry.trim();
    if (!providerContractId || seen.has(providerContractId)) {
      return;
    }

    seen.add(providerContractId);
    normalized.push(providerContractId);
  });

  return normalized;
}

function normalizeUnderlying(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function normalizeOwner(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : undefined;
}

function normalizeIntent(value: unknown): MarketDataIntent {
  return value === "execution-live" ||
    value === "visible-live" ||
    value === "automation-live" ||
    value === "flow-scanner-live" ||
    value === "convenience-live" ||
    value === "delayed-ok" ||
    value === "historical"
    ? value
    : "visible-live";
}

function normalizeRequiresGreeks(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

function parseMessage(raw: RawData): SubscribeMessage | null {
  try {
    return JSON.parse(raw.toString()) as SubscribeMessage;
  } catch {
    return null;
  }
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Option quote stream failed.";
}

function isOptionsQuoteUpgrade(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  return url.pathname === OPTION_QUOTES_WS_PATH;
}

export function attachOptionQuoteWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    if (!isOptionsQuoteUpgrade(request)) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket) => {
    let unsubscribe: Unsubscribe = () => {};
    let currentSubscriptionKey = "";
    let currentProviderContractIds: string[] = [];
    let degraded = false;
    let highBufferedAmountCount = 0;
    let flushTimer: NodeJS.Timeout | null = null;
    const quotePriorityByProviderContractId = new Map<string, number>();
    const pendingQuotesByProviderContractId = new Map<string, unknown>();

    const sendStatus = (payload: Record<string, unknown> = {}) => {
      sendJson(socket, {
        type: "status",
        requestedCount: currentProviderContractIds.length,
        acceptedCount: currentProviderContractIds.length,
        rejectedCount: 0,
        degraded,
        bufferedAmount: socket.bufferedAmount,
        ...payload,
      });
    };
    const scheduleFlush = () => {
      if (flushTimer || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      flushTimer = setTimeout(flushQuotes, QUOTE_FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    };
    const flushQuotes = () => {
      flushTimer = null;
      if (socket.readyState !== WebSocket.OPEN || pendingQuotesByProviderContractId.size === 0) {
        return;
      }

      if (socket.bufferedAmount >= CLOSE_BUFFERED_AMOUNT_BYTES) {
        highBufferedAmountCount += 1;
        sendStatus({ reason: "buffered_amount_high" });
        if (highBufferedAmountCount >= 3) {
          socket.close(1013, "Option quote client is not draining fast enough.");
          return;
        }
        scheduleFlush();
        return;
      }

      highBufferedAmountCount = 0;
      const nextDegraded = socket.bufferedAmount >= DEGRADED_BUFFERED_AMOUNT_BYTES;
      if (nextDegraded !== degraded) {
        degraded = nextDegraded;
        sendStatus({ reason: degraded ? "buffered_amount_degraded" : "buffered_amount_recovered" });
      }

      const entries = Array.from(pendingQuotesByProviderContractId.entries())
        .sort((left, right) => {
          const leftPriority = quotePriorityByProviderContractId.get(left[0]) ?? Number.MAX_SAFE_INTEGER;
          const rightPriority = quotePriorityByProviderContractId.get(right[0]) ?? Number.MAX_SAFE_INTEGER;
          return leftPriority - rightPriority;
        });
      const sendCount = degraded
        ? Math.min(DEGRADED_QUOTE_BATCH_SIZE, entries.length)
        : entries.length;
      const quotes = entries.slice(0, sendCount).map((entry) => entry[1]);
      entries.slice(0, sendCount).forEach(([providerContractId]) => {
        pendingQuotesByProviderContractId.delete(providerContractId);
      });

      sendJson(socket, {
        type: "quotes",
        quotes,
      });

      if (pendingQuotesByProviderContractId.size > 0) {
        scheduleFlush();
      }
    };
    const enqueueQuotes = (payload: { quotes?: unknown[]; underlying?: string | null }) => {
      (payload.quotes || []).forEach((quote) => {
        const providerContractId =
          quote && typeof quote === "object" && "providerContractId" in quote
            ? String((quote as { providerContractId?: unknown }).providerContractId || "").trim()
            : "";
        if (!providerContractId) {
          return;
        }
        pendingQuotesByProviderContractId.set(providerContractId, quote);
      });
      scheduleFlush();
    };
    const heartbeatTimer = setInterval(() => {
      sendJson(socket, {
        type: "heartbeat",
        at: new Date().toISOString(),
        bufferedAmount: socket.bufferedAmount,
        degraded,
      });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();

    const cleanup = () => {
      clearInterval(heartbeatTimer);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      unsubscribe();
      unsubscribe = () => {};
      pendingQuotesByProviderContractId.clear();
    };

    socket.on("message", (raw) => {
      const message = parseMessage(raw);
      if (message?.type !== "subscribe") {
        sendJson(socket, {
          type: "error",
          error: "Expected subscribe message.",
        });
        return;
      }

      const requestedProviderContractIds = normalizeProviderContractIds(
        message.providerContractIds,
      );
      if (requestedProviderContractIds.length === 0) {
        sendJson(socket, {
          type: "error",
          error: "At least one providerContractId is required.",
        });
        return;
      }
      if (
        OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS > 0 &&
        requestedProviderContractIds.length > OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS
      ) {
        sendJson(socket, {
          type: "error",
          error: `Option quote subscription requested ${requestedProviderContractIds.length} contracts, above the configured emergency ceiling of ${OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS}.`,
        });
        return;
      }

      const providerContractIds = requestedProviderContractIds;
      const rejectedCount = 0;
      const underlying = normalizeUnderlying(message.underlying);
      const owner = normalizeOwner(message.owner);
      const intent = normalizeIntent(message.intent);
      const requiresGreeks = normalizeRequiresGreeks(message.requiresGreeks);
      const subscriptionKey = JSON.stringify({
        underlying,
        providerContractIds,
        owner,
        intent,
        requiresGreeks,
      });
      if (subscriptionKey === currentSubscriptionKey) {
        sendJson(socket, {
          type: "ready",
          underlying,
          providerContractIds,
          requestedCount: requestedProviderContractIds.length,
          acceptedCount: providerContractIds.length,
          rejectedCount,
        });
        return;
      }

      unsubscribe();
      unsubscribe = () => {};
      currentSubscriptionKey = subscriptionKey;
      currentProviderContractIds = providerContractIds;
      quotePriorityByProviderContractId.clear();
      providerContractIds.forEach((providerContractId, index) => {
        quotePriorityByProviderContractId.set(providerContractId, index);
      });

      try {
        unsubscribe = subscribeOptionQuoteSnapshots(
          {
            underlying,
            providerContractIds,
            owner,
            intent,
            requiresGreeks,
          },
          (payload) => {
            enqueueQuotes(payload);
          },
        );
      } catch (error) {
        logger.warn({ err: error }, "Option quote WebSocket subscription failed");
        sendJson(socket, {
          type: "error",
          error: errorMessage(error),
        });
        socket.close(1011, "Option quote subscription failed.");
        currentSubscriptionKey = "";
        return;
      }

      sendJson(socket, {
        type: "ready",
        underlying,
        providerContractIds,
        requestedCount: requestedProviderContractIds.length,
        acceptedCount: providerContractIds.length,
        rejectedCount,
      });
      sendStatus();

      fetchOptionQuoteSnapshotPayload({
        underlying,
        providerContractIds,
        owner,
        intent,
        requiresGreeks,
      })
        .then((payload) => {
          sendStatus({
            providerMode: payload.debug?.providerMode ?? null,
            liveMarketDataAvailable:
              payload.debug?.liveMarketDataAvailable ?? null,
            acceptedCount:
              payload.debug?.acceptedCount ?? currentProviderContractIds.length,
            rejectedCount: payload.debug?.rejectedCount ?? 0,
            returnedCount: payload.debug?.returnedCount ?? payload.quotes.length,
            missingProviderContractIds:
              payload.debug?.missingProviderContractIds ?? [],
          });
          if (payload.quotes.length) {
            enqueueQuotes(payload);
          }
        })
        .catch((error) => {
          logger.warn({ err: error }, "Initial option quote WebSocket snapshot failed");
          sendJson(socket, {
            type: "error",
            error: errorMessage(error),
          });
        });
    });

    socket.on("close", cleanup);
    socket.on("error", (error) => {
      logger.warn({ err: error }, "Option quote WebSocket connection failed");
      cleanup();
    });
  });
}
