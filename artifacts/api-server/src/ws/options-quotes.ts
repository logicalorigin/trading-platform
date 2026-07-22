import { STATUS_CODES, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { logger } from "../lib/logger";
import { HttpError } from "../lib/errors";
import { isTrustedLoopbackProxyPeer } from "../lib/trusted-proxy";
import { requireUser } from "../routes/auth";
import {
  readOptionQuoteDemandSnapshotPayload,
  subscribeOptionQuoteSnapshots,
} from "../services/bridge-streams";
import type { MarketDataIntent } from "../services/market-data-admission";

const OPTION_QUOTES_WS_PATH = "/api/ws/options/quotes";
const MAX_SUBSCRIPTIONS_PER_CONNECTION = 1_024;
const MAX_CONNECTIONS_PER_USER = 4;
const MAX_MESSAGE_BYTES = 128 * 1_024;
const SUBSCRIBE_MESSAGE_BURST = 10;
const SUBSCRIBE_TOKEN_REFILL_MS = 1_000;
const OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS = Math.max(
  0,
  Number.parseInt(
    process.env["OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS"] ?? "0",
    10,
  ) || 0,
);
const EFFECTIVE_MAX_SUBSCRIPTIONS =
  OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS > 0
    ? Math.min(
        MAX_SUBSCRIPTIONS_PER_CONNECTION,
        OPTION_QUOTES_WS_EMERGENCY_MAX_SUBSCRIPTIONS,
      )
    : MAX_SUBSCRIPTIONS_PER_CONNECTION;
const HEARTBEAT_INTERVAL_MS = 15_000;
const QUOTE_FLUSH_INTERVAL_MS = 100;
const DEGRADED_BUFFERED_AMOUNT_BYTES = 1_000_000;
const CLOSE_BUFFERED_AMOUNT_BYTES = 5_000_000;
const DEGRADED_QUOTE_BATCH_SIZE = 100;
let nextOptionQuoteConnectionId = 1;
const optionQuoteConnectionsByUserId = new Map<string, number>();

type Unsubscribe = () => void;

type SubscribeMessage = {
  type?: unknown;
  underlying?: unknown;
  providerContractIds?: unknown;
  owner?: unknown;
  intent?: unknown;
  requiresGreeks?: unknown;
};

type OptionQuotePayload = {
  quotes?: unknown[];
  underlying?: string | null;
};

type OptionQuoteQueueState = {
  quotePriorityByProviderContractId: Map<string, number>;
  pendingQuotesByProviderContractId: Map<string, unknown>;
};

type SubscribeTokenBucket = {
  available: number;
  refilledAt: number;
};

function createSubscribeTokenBucket(now = Date.now()): SubscribeTokenBucket {
  return { available: SUBSCRIBE_MESSAGE_BURST, refilledAt: now };
}

function consumeSubscribeToken(
  bucket: SubscribeTokenBucket,
  now = Date.now(),
): boolean {
  const elapsed = Math.max(0, now - bucket.refilledAt);
  bucket.available = Math.min(
    SUBSCRIBE_MESSAGE_BURST,
    bucket.available + elapsed / SUBSCRIBE_TOKEN_REFILL_MS,
  );
  bucket.refilledAt = now;
  if (bucket.available < 1) return false;
  bucket.available -= 1;
  return true;
}

function createOptionQuoteQueueState(): OptionQuoteQueueState {
  return {
    quotePriorityByProviderContractId: new Map<string, number>(),
    pendingQuotesByProviderContractId: new Map<string, unknown>(),
  };
}

function clearOptionQuoteQueueState(state: OptionQuoteQueueState): void {
  state.quotePriorityByProviderContractId.clear();
  state.pendingQuotesByProviderContractId.clear();
}

function resetOptionQuoteQueueSubscription(
  state: OptionQuoteQueueState,
  providerContractIds: string[],
): void {
  clearOptionQuoteQueueState(state);
  normalizeProviderContractIds(providerContractIds).forEach((providerContractId, index) => {
    state.quotePriorityByProviderContractId.set(providerContractId, index);
  });
}

function readQuoteProviderContractId(quote: unknown): string {
  return quote && typeof quote === "object" && "providerContractId" in quote
    ? normalizeProviderContractId(
        (quote as { providerContractId?: unknown }).providerContractId,
      )
    : "";
}

function enqueueCurrentOptionQuotes(
  state: OptionQuoteQueueState,
  payload: OptionQuotePayload,
): void {
  (payload.quotes || []).forEach((quote) => {
    const providerContractId = readQuoteProviderContractId(quote);
    if (
      !providerContractId ||
      !state.quotePriorityByProviderContractId.has(providerContractId)
    ) {
      return;
    }
    state.pendingQuotesByProviderContractId.set(providerContractId, quote);
  });
}

function normalizeOpraOptionTicker(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }
  const ticker = normalized.startsWith("O:") ? normalized : `O:${normalized}`;
  return /^O:[A-Z0-9.-]+\d{6}[CP]\d{8}$/.test(ticker) ? ticker : "";
}

function normalizeProviderContractId(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (
    !text ||
    text.length > 128 ||
    !/^[A-Za-z0-9:._-]+$/.test(text)
  ) {
    return "";
  }
  return normalizeOpraOptionTicker(text) || text;
}

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

    const providerContractId = normalizeProviderContractId(entry);
    if (!providerContractId || seen.has(providerContractId)) {
      return;
    }

    seen.add(providerContractId);
    normalized.push(providerContractId);
  });

  return normalized;
}

function buildOptionQuoteCoverageStatus(
  payload: {
    quotes: Array<{
      providerContractId?: string | null;
      freshness?: string | null;
    }>;
    debug?: {
      returnedCount?: number | null;
      missingProviderContractIds?: string[];
    };
  },
) {
  return {
    returnedCount: payload.debug?.returnedCount ?? payload.quotes.length,
    missingProviderContractIds: normalizeProviderContractIds(
      payload.debug?.missingProviderContractIds,
    ),
    staleProviderContractIds: normalizeProviderContractIds(
      payload.quotes
        .filter(
          (quote) =>
            String(quote.freshness ?? "").trim().toLowerCase() === "stale",
        )
        .map((quote) => quote.providerContractId),
    ),
  };
}

function normalizeUnderlying(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z0-9.^_-]{1,32}$/.test(normalized) ? normalized : null;
}

function normalizeOwner(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : undefined;
}

function optionQuoteDemandOwnerForConnection(
  owner: string | undefined,
  connectionId: number,
): string {
  const suffix = `:ws-${connectionId}`;
  const base = owner || "option-quotes";
  return `${base.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
}

function normalizeIntent(value: unknown): MarketDataIntent {
  return value === "execution-live" ||
    value === "account-monitor-live" ||
    value === "visible-live" ||
    value === "automation-live" ||
    value === "flow-scanner-live" ||
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

function isOptionsQuoteUpgrade(request: IncomingMessage): boolean | null {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    return url.pathname === OPTION_QUOTES_WS_PATH;
  } catch {
    return null;
  }
}

function hasSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== "string" || !host) return false;
  try {
    const parsed = new URL(origin);
    const rawForwardedHost = isTrustedLoopbackProxyPeer(
      request.socket.remoteAddress,
    )
      ? request.headers["x-forwarded-host"]
      : undefined;
    const forwardedHost = (
      Array.isArray(rawForwardedHost) ? rawForwardedHost[0] : rawForwardedHost
    )
      ?.split(",", 1)[0]
      ?.trim();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      [host, forwardedHost].some(
        (candidate) => candidate?.toLowerCase() === parsed.host.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
}

function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Error"}\r\n` +
      "Connection: close\r\nContent-Length: 0\r\n\r\n",
  );
}

async function authorizeUpgrade(request: IncomingMessage): Promise<string> {
  const session = await requireUser(request);
  if (!hasSameOrigin(request)) {
    throw new HttpError(403, "WebSocket origin is not allowed.", {
      code: "option_quotes_websocket_origin_denied",
    });
  }
  return session.user.id;
}

function reserveUserConnection(appUserId: string): void {
  const active = optionQuoteConnectionsByUserId.get(appUserId) ?? 0;
  if (active >= MAX_CONNECTIONS_PER_USER) {
    throw new HttpError(429, "Too many option quote connections.", {
      code: "option_quotes_websocket_connection_limit",
    });
  }
  optionQuoteConnectionsByUserId.set(appUserId, active + 1);
}

function releaseUserConnection(appUserId: string): void {
  const active = optionQuoteConnectionsByUserId.get(appUserId) ?? 0;
  if (active <= 1) {
    optionQuoteConnectionsByUserId.delete(appUserId);
  } else {
    optionQuoteConnectionsByUserId.set(appUserId, active - 1);
  }
}

export const __optionQuoteWsInternalsForTests = {
  buildOptionQuoteCoverageStatus,
  maxConnectionsPerUser: MAX_CONNECTIONS_PER_USER,
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxSubscriptionsPerConnection: EFFECTIVE_MAX_SUBSCRIPTIONS,
  subscribeMessageBurst: SUBSCRIBE_MESSAGE_BURST,
  createOptionQuoteQueueState,
  enqueueCurrentOptionQuotes,
  optionQuoteDemandOwnerForConnection,
  resetOptionQuoteQueueSubscription,
  getPendingProviderContractIds(state: OptionQuoteQueueState): string[] {
    return Array.from(state.pendingQuotesByProviderContractId.keys());
  },
};

export function attachOptionQuoteWebSocket(server: Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
  });
  const userIdBySocket = new WeakMap<WebSocket, string>();

  server.on("upgrade", (request, socket, head) => {
    const isOptionQuoteUpgrade = isOptionsQuoteUpgrade(request);
    if (isOptionQuoteUpgrade === null) {
      rejectUpgrade(socket, 400);
      return;
    }
    if (!isOptionQuoteUpgrade) {
      return;
    }
    void authorizeUpgrade(request)
      .then((appUserId) => {
        if (socket.destroyed) return;
        reserveUserConnection(appUserId);
        try {
          wss.handleUpgrade(request, socket, head, (ws) => {
            userIdBySocket.set(ws, appUserId);
            wss.emit("connection", ws, request);
          });
        } catch (error) {
          releaseUserConnection(appUserId);
          throw error;
        }
      })
      .catch((error) => {
        rejectUpgrade(socket, error instanceof HttpError ? error.statusCode : 500);
      });
  });

  wss.on("connection", (socket) => {
    const appUserId = userIdBySocket.get(socket);
    if (!appUserId) {
      socket.close(1011, "Option quote connection identity is unavailable.");
      return;
    }
    const connectionId = nextOptionQuoteConnectionId++;
    let unsubscribe: Unsubscribe = () => {};
    let currentSubscriptionKey = "";
    let currentProviderContractIds: string[] = [];
    let currentUnderlying: string | null = null;
    let currentOwner: string | undefined;
    let currentRequiresGreeks = true;
    let degraded = false;
    let highBufferedAmountCount = 0;
    let flushTimer: NodeJS.Timeout | null = null;
    const quoteQueueState = createOptionQuoteQueueState();
    const subscribeTokenBucket = createSubscribeTokenBucket();
    let connectionReleased = false;

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
      if (
        socket.readyState !== WebSocket.OPEN ||
        quoteQueueState.pendingQuotesByProviderContractId.size === 0
      ) {
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

      const entries = Array.from(
        quoteQueueState.pendingQuotesByProviderContractId.entries(),
      )
        .sort((left, right) => {
          const leftPriority =
            quoteQueueState.quotePriorityByProviderContractId.get(left[0]) ??
            Number.MAX_SAFE_INTEGER;
          const rightPriority =
            quoteQueueState.quotePriorityByProviderContractId.get(right[0]) ??
            Number.MAX_SAFE_INTEGER;
          return leftPriority - rightPriority;
        });
      const sendCount = degraded
        ? Math.min(DEGRADED_QUOTE_BATCH_SIZE, entries.length)
        : entries.length;
      const quotes = entries.slice(0, sendCount).map((entry) => entry[1]);
      entries.slice(0, sendCount).forEach(([providerContractId]) => {
        quoteQueueState.pendingQuotesByProviderContractId.delete(providerContractId);
      });

      sendJson(socket, {
        type: "quotes",
        quotes,
      });

      if (quoteQueueState.pendingQuotesByProviderContractId.size > 0) {
        scheduleFlush();
      }
    };
    const enqueueQuotes = (payload: OptionQuotePayload) => {
      enqueueCurrentOptionQuotes(quoteQueueState, payload);
      scheduleFlush();
    };
    const heartbeatTimer = setInterval(() => {
      const coverage = currentProviderContractIds.length
        ? buildOptionQuoteCoverageStatus(
            readOptionQuoteDemandSnapshotPayload({
              underlying: currentUnderlying,
              providerContractIds: currentProviderContractIds,
              owner: currentOwner,
              requiresGreeks: currentRequiresGreeks,
            }),
          )
        : {
            returnedCount: 0,
            missingProviderContractIds: [],
            staleProviderContractIds: [],
          };
      sendJson(socket, {
        type: "heartbeat",
        at: new Date().toISOString(),
        bufferedAmount: socket.bufferedAmount,
        degraded,
        ...coverage,
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
      clearOptionQuoteQueueState(quoteQueueState);
      if (!connectionReleased) {
        connectionReleased = true;
        releaseUserConnection(appUserId);
      }
    };

    socket.on("message", (raw) => {
      if (!consumeSubscribeToken(subscribeTokenBucket)) {
        sendJson(socket, {
          type: "error",
          error: "Option quote subscription rate exceeded.",
        });
        socket.close(1008, "Option quote subscription rate exceeded.");
        return;
      }
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
        requestedProviderContractIds.length > EFFECTIVE_MAX_SUBSCRIPTIONS
      ) {
        sendJson(socket, {
          type: "error",
          error: `Option quote subscription requested ${requestedProviderContractIds.length} contracts, above the ceiling of ${EFFECTIVE_MAX_SUBSCRIPTIONS}.`,
        });
        return;
      }

      const providerContractIds = requestedProviderContractIds;
      const rejectedCount = 0;
      const underlying = normalizeUnderlying(message.underlying);
      const owner = optionQuoteDemandOwnerForConnection(
        normalizeOwner(message.owner),
        connectionId,
      );
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
      currentUnderlying = underlying;
      currentOwner = owner;
      currentRequiresGreeks = requiresGreeks;
      resetOptionQuoteQueueSubscription(quoteQueueState, providerContractIds);

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

      const initialPayload = readOptionQuoteDemandSnapshotPayload({
        underlying,
        providerContractIds,
        owner,
        requiresGreeks,
      });
      sendStatus({
        providerMode: initialPayload.debug?.providerMode ?? null,
        liveMarketDataAvailable:
          initialPayload.debug?.liveMarketDataAvailable ?? null,
        acceptedCount:
          initialPayload.debug?.acceptedCount ?? currentProviderContractIds.length,
        rejectedCount: initialPayload.debug?.rejectedCount ?? 0,
        ...buildOptionQuoteCoverageStatus(initialPayload),
      });
      if (initialPayload.quotes.length) {
        enqueueQuotes(initialPayload);
      }
    });

    socket.on("close", cleanup);
    socket.on("error", (error) => {
      logger.warn({ err: error }, "Option quote WebSocket connection failed");
      cleanup();
    });
  });
}
