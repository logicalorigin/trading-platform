import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { HttpError } from "../../lib/errors";
import { withSearchParams, type QueryValue } from "../../lib/http";
import { logger } from "../../lib/logger";
import { normalizeSymbol } from "../../lib/values";
import {
  getIbkrBridgeRuntimeConfig,
  type IbkrBridgeRuntimeConfig,
  type RuntimeMode,
} from "../../lib/runtime";
import type {
  BrokerBarSnapshot,
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerMarketDepthSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  CancelOrderSnapshot,
  HistoryBarTimeframe,
  HistoryDataSource,
  IbkrNewsArticle,
  IbkrUniverseTicker,
  OptionChainContract,
  OrderPreviewSnapshot,
  PlaceOrderInput,
  QuoteSnapshot,
  ReplaceOrderSnapshot,
  SessionStatusSnapshot,
} from "./client";

type BridgeHealthSnapshot = {
  bridgeRuntimeBuild?: string | null;
  configured: boolean;
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
  selectedAccountId: string | null;
  accounts: string[];
  lastTickleAt: Date | null;
  lastError: string | null;
  lastRecoveryAttemptAt: Date | null;
  lastRecoveryError: string | null;
  updatedAt: Date;
  transport: "tws";
  connectionTarget: string | null;
  sessionMode: RuntimeMode | null;
  clientId: number | null;
  marketDataMode:
    | "live"
    | "frozen"
    | "delayed"
    | "delayed_frozen"
    | "unknown"
    | null;
  liveMarketDataAvailable: boolean | null;
  healthFresh?: boolean;
  healthAgeMs?: number | null;
  stale?: boolean;
  bridgeReachable?: boolean;
  socketConnected?: boolean;
  brokerServerConnected?: boolean;
  serverConnectivity?: "unknown" | "connected" | "disconnected";
  lastServerConnectivityAt?: Date | null;
  lastServerConnectivityError?: string | null;
  accountsLoaded?: boolean;
  configuredLiveMarketDataMode?: boolean;
  streamFresh?: boolean;
  lastStreamEventAgeMs?: number | null;
  strictReady?: boolean;
  strictReason?: string | null;
  diagnostics?: {
    scheduler?: unknown;
    pressure?: string;
    subscriptions?: unknown;
    lastReconnectReason?: string | null;
  };
  connections: {
    tws: BridgeConnectionHealthSnapshot;
  };
};

export type BridgeLaneDiagnosticsSnapshot = {
  scheduler?: unknown;
  schedulerConfig?: unknown;
  limits?: unknown;
  subscriptions?: unknown;
  pressure?: string;
  updatedAt?: Date | string;
};

export type BridgeLaneSettingsRequest = {
  scheduler?: Record<string, Record<string, number | null | undefined>>;
  limits?: Record<string, number | null | undefined>;
};

type BridgeConnectionHealthSnapshot = {
  transport: "tws";
  role: "market_data";
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  competing: boolean;
  target: string | null;
  mode: RuntimeMode | null;
  clientId: number | null;
  selectedAccountId: string | null;
  accounts: string[];
  lastPingMs: number | null;
  lastPingAt: Date | null;
  lastTickleAt: Date | null;
  lastError: string | null;
  marketDataMode:
    | "live"
    | "frozen"
    | "delayed"
    | "delayed_frozen"
    | "unknown"
    | null;
  liveMarketDataAvailable: boolean | null;
  healthFresh?: boolean;
  healthAgeMs?: number | null;
  stale?: boolean;
  bridgeReachable?: boolean;
  socketConnected?: boolean;
  brokerServerConnected?: boolean;
  serverConnectivity?: "unknown" | "connected" | "disconnected";
  lastServerConnectivityAt?: Date | null;
  lastServerConnectivityError?: string | null;
  accountsLoaded?: boolean;
  configuredLiveMarketDataMode?: boolean;
  streamFresh?: boolean;
  lastStreamEventAgeMs?: number | null;
  strictReady?: boolean;
  strictReason?: string | null;
};

export type BridgeOrdersMetadata = {
  degraded?: boolean;
  reason?: string;
  stale?: boolean;
  detail?: string;
  timeoutMs?: number;
};

export type BridgeOrdersResult = BridgeOrdersMetadata & {
  orders: BrokerOrderSnapshot[];
};

type QuoteStreamPayload = {
  quotes?: Array<
    Omit<QuoteSnapshot, "updatedAt"> & { updatedAt: string | Date }
  >;
};

type OptionQuoteStreamPayload = QuoteStreamPayload;

type BarStreamPayload = {
  bar?:
    | (Omit<BrokerBarSnapshot, "timestamp" | "dataUpdatedAt"> & {
        timestamp: string | Date;
        dataUpdatedAt?: string | Date | null;
      })
    | null;
};

type StreamStatusPayload = {
  state?: string;
  reason?: string;
  message?: string;
  requestedCount?: number;
  admittedCount?: number;
  rejectedCount?: number;
  retryDelayMs?: number;
  lastEventAgeMs?: number | null;
  backoffRemainingMs?: number | null;
};

export type QuoteStreamSignal = {
  type: "open" | "ready" | "status" | "heartbeat";
  at: Date;
  status?: StreamStatusPayload | null;
};

type OptionExpirationsPayload = {
  expirations: Array<Date | string | { expirationDate: Date | string }>;
};

type SseMessage = {
  event: string;
  data: string;
};

const bridgeHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 16,
  maxFreeSockets: 8,
});
const bridgeHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
  maxFreeSockets: 8,
});

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function hydrateOptionContract<
  T extends { expirationDate: unknown } | null | undefined,
>(contract: T): T {
  if (!contract) return contract;
  return { ...contract, expirationDate: toDate(contract.expirationDate) } as T;
}

function hydrateAccount(raw: BrokerAccountSnapshot): BrokerAccountSnapshot {
  return { ...raw, updatedAt: toDate(raw.updatedAt) };
}

function hydratePosition(raw: BrokerPositionSnapshot): BrokerPositionSnapshot {
  return { ...raw, optionContract: hydrateOptionContract(raw.optionContract) };
}

function hydrateOrder(raw: BrokerOrderSnapshot): BrokerOrderSnapshot {
  return {
    ...raw,
    placedAt: toDate(raw.placedAt),
    updatedAt: toDate(raw.updatedAt),
    optionContract: hydrateOptionContract(raw.optionContract),
  };
}

function hydrateExecution(
  raw: BrokerExecutionSnapshot,
): BrokerExecutionSnapshot {
  return { ...raw, executedAt: toDate(raw.executedAt) };
}

function hydrateMarketDepth(
  raw: BrokerMarketDepthSnapshot | null,
): BrokerMarketDepthSnapshot | null {
  if (!raw) return raw;
  return { ...raw, updatedAt: toDate(raw.updatedAt) };
}

function hydrateOptionChainContract(
  raw: OptionChainContract,
): OptionChainContract {
  return {
    ...raw,
    updatedAt: toDate(raw.updatedAt),
    quoteUpdatedAt: raw.quoteUpdatedAt ? toDate(raw.quoteUpdatedAt) : null,
    dataUpdatedAt: raw.dataUpdatedAt ? toDate(raw.dataUpdatedAt) : null,
    contract: {
      ...raw.contract,
      expirationDate: toDate(raw.contract.expirationDate),
    },
  };
}

function hydrateSession(
  raw: SessionStatusSnapshot | null,
): SessionStatusSnapshot | null {
  if (!raw) return raw;
  return { ...raw, updatedAt: toDate(raw.updatedAt) };
}

function hydrateHealth(raw: BridgeHealthSnapshot): BridgeHealthSnapshot {
  const twsConnection = raw.connections?.tws ?? {
    transport: "tws" as const,
    role: "market_data" as const,
    configured: raw.configured,
    reachable: raw.connected,
    authenticated: raw.authenticated,
    competing: raw.competing,
    target: raw.connectionTarget,
    mode: raw.sessionMode,
    clientId: raw.clientId,
    selectedAccountId: raw.selectedAccountId,
    accounts: raw.accounts,
    lastPingMs: null,
    lastPingAt: null,
    lastTickleAt: raw.lastTickleAt,
    lastError: raw.lastError,
    marketDataMode: raw.marketDataMode,
    liveMarketDataAvailable: raw.liveMarketDataAvailable,
    healthFresh: raw.healthFresh,
    healthAgeMs: raw.healthAgeMs,
    stale: raw.stale,
    bridgeReachable: raw.bridgeReachable,
    socketConnected: raw.socketConnected,
    brokerServerConnected: raw.brokerServerConnected,
    serverConnectivity: raw.serverConnectivity,
    lastServerConnectivityAt: raw.lastServerConnectivityAt,
    lastServerConnectivityError: raw.lastServerConnectivityError,
    accountsLoaded: raw.accountsLoaded,
    configuredLiveMarketDataMode: raw.configuredLiveMarketDataMode,
    streamFresh: raw.streamFresh,
    lastStreamEventAgeMs: raw.lastStreamEventAgeMs,
    strictReady: raw.strictReady,
    strictReason: raw.strictReason,
  };

  return {
    ...raw,
    updatedAt: toDate(raw.updatedAt),
    lastTickleAt: raw.lastTickleAt ? toDate(raw.lastTickleAt) : null,
    lastRecoveryAttemptAt: raw.lastRecoveryAttemptAt
      ? toDate(raw.lastRecoveryAttemptAt)
      : null,
    lastServerConnectivityAt: raw.lastServerConnectivityAt
      ? toDate(raw.lastServerConnectivityAt)
      : null,
    connections: {
      tws: hydrateConnectionHealth(twsConnection),
    },
  };
}

function hydrateConnectionHealth(
  raw: BridgeConnectionHealthSnapshot,
): BridgeConnectionHealthSnapshot {
  return {
    ...raw,
    lastPingAt: raw.lastPingAt ? toDate(raw.lastPingAt) : null,
    lastTickleAt: raw.lastTickleAt ? toDate(raw.lastTickleAt) : null,
    lastServerConnectivityAt: raw.lastServerConnectivityAt
      ? toDate(raw.lastServerConnectivityAt)
      : null,
  };
}

function hydrateLatency(
  latency: QuoteSnapshot["latency"] | undefined,
): QuoteSnapshot["latency"] {
  if (!latency) return latency ?? null;

  return {
    bridgeReceivedAt: latency.bridgeReceivedAt
      ? toDate(latency.bridgeReceivedAt)
      : latency.bridgeReceivedAt,
    bridgeEmittedAt: latency.bridgeEmittedAt
      ? toDate(latency.bridgeEmittedAt)
      : latency.bridgeEmittedAt,
    apiServerReceivedAt: latency.apiServerReceivedAt
      ? toDate(latency.apiServerReceivedAt)
      : latency.apiServerReceivedAt,
    apiServerEmittedAt: latency.apiServerEmittedAt
      ? toDate(latency.apiServerEmittedAt)
      : latency.apiServerEmittedAt,
  };
}

function hydrateQuote(
  raw: Omit<QuoteSnapshot, "updatedAt"> & { updatedAt: string | Date },
): QuoteSnapshot {
  return {
    ...raw,
    symbol: normalizeSymbol(raw.symbol),
    // Older bridge versions don't emit openInterest; normalize to null
    // so downstream code can rely on the field always being present.
    openInterest: raw.openInterest ?? null,
    updatedAt:
      raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt),
    dataUpdatedAt: raw.dataUpdatedAt ? toDate(raw.dataUpdatedAt) : null,
    latency: hydrateLatency(raw.latency),
  };
}

function toIbkrBridgeStockSymbol(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  if (/^[A-Z]{1,5}\.[A-Z]{1,2}$/.test(normalized)) {
    return normalized.replace(/\./g, " ");
  }
  return normalized;
}

function normalizeBridgeStockSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols.map((symbol) => toIbkrBridgeStockSymbol(symbol)).filter(Boolean),
    ),
  ).sort();
}

function toBridgeStockSymbolForRequest(input: {
  symbol: string;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
}): string {
  if (input.assetClass === "option" || input.providerContractId) {
    return input.symbol;
  }
  return toIbkrBridgeStockSymbol(input.symbol);
}

function readJsonResponsePayload(text: string, contentType: string): unknown {
  if (!text) {
    return null;
  }

  if (
    contentType.includes("application/json") ||
    contentType.includes("+json")
  ) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

function buildBridgeErrorMessage(
  status: number,
  statusText: string,
  body: unknown,
): string {
  const prefix = `HTTP ${status} ${statusText}`;

  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed ? `${prefix}: ${trimmed}` : prefix;
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const detail =
      record["detail"] ??
      record["message"] ??
      record["error_description"] ??
      record["error"];

    if (typeof detail === "string" && detail.trim()) {
      return `${prefix}: ${detail.trim()}`;
    }
  }

  return prefix;
}

function parseSseBlock(block: string): SseMessage | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];

  lines.forEach((line) => {
    if (!line || line.startsWith(":")) {
      return;
    }

    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      return;
    }

    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  });

  if (data.length === 0) {
    return null;
  }

  return {
    event,
    data: data.join("\n"),
  };
}

function findSseBoundary(
  buffer: string,
): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");

  if (lf === -1 && crlf === -1) {
    return null;
  }

  if (lf === -1) {
    return { index: crlf, length: 4 };
  }

  if (crlf === -1 || lf < crlf) {
    return { index: lf, length: 2 };
  }

  return { index: crlf, length: 4 };
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isLikelyUsEquitySession(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  if (["Sat", "Sun"].includes(weekday)) {
    return false;
  }
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 25 && minutes <= 16 * 60 + 5;
}

export class IbkrBridgeClient {
  // Keep bridge calls bounded by default. Market-open load can leave the
  // tunnel/bridge wedged long enough for request handlers and UI queries to
  // pile up; callers that need a shorter budget should pass an AbortSignal.
  private readonly requestTimeoutMs = Math.max(
    0,
    Number(process.env["IBKR_BRIDGE_REQUEST_TIMEOUT_MS"] ?? "12000"),
  );
  private readonly quoteStreamStallMs = readPositiveIntegerEnv(
    "IBKR_QUOTE_STREAM_STALL_MS",
    45_000,
  );
  private readonly optionQuoteStreamStallMs = readPositiveIntegerEnv(
    "IBKR_OPTION_QUOTE_STREAM_STALL_MS",
    0,
  );
  private readonly historicalBarStreamStallMs = readPositiveIntegerEnv(
    "IBKR_BAR_STREAM_STALL_MS",
    0,
  );

  private getConfig(): IbkrBridgeRuntimeConfig {
    const config = getIbkrBridgeRuntimeConfig();

    if (!config) {
      throw new HttpError(
        503,
        "Interactive Brokers bridge is not configured.",
        {
          code: "ibkr_bridge_not_configured",
        },
      );
    }

    return config;
  }

  private buildUrl(
    config: IbkrBridgeRuntimeConfig,
    path: string,
    params: Record<string, QueryValue> = {},
  ): URL {
    return withSearchParams(`${config.baseUrl}${path}`, params);
  }

  private buildHeaders(
    config: IbkrBridgeRuntimeConfig,
    initHeaders?: RequestInit["headers"],
  ): Headers {
    const headers = new Headers(initHeaders);

    if (config.apiToken) {
      headers.set("Authorization", `Bearer ${config.apiToken}`);
    }

    return headers;
  }

  private buildNodeHeaders(
    config: IbkrBridgeRuntimeConfig,
    initHeaders: RequestInit["headers"] = {},
  ): Record<string, string> {
    return Object.fromEntries(this.buildHeaders(config, initHeaders).entries());
  }

  private request<T>(
    path: string,
    init: RequestInit = {},
    params: Record<string, QueryValue> = {},
  ): Promise<T> {
    const config = this.getConfig();
    const controller = new AbortController();
    const inputSignal = init.signal;
    let didTimeout = false;
    const timeout =
      this.requestTimeoutMs > 0
        ? setTimeout(() => {
            didTimeout = true;
            controller.abort();
          }, this.requestTimeoutMs)
        : null;
    const abortFromInput = () => controller.abort(inputSignal?.reason);

    if (inputSignal?.aborted) {
      controller.abort(inputSignal.reason);
    } else {
      inputSignal?.addEventListener("abort", abortFromInput, { once: true });
    }

    return this.requestJson<T>(path, this.buildUrl(config, path, params), {
      ...init,
      headers: this.buildHeaders(config, {
        Accept: "application/json",
        ...(init.headers
          ? Object.fromEntries(new Headers(init.headers).entries())
          : {}),
      }),
      signal: controller.signal,
    })
      .catch((error: unknown) => {
        if (didTimeout) {
          throw new HttpError(
            504,
            `IBKR bridge request to ${path} timed out after ${this.requestTimeoutMs}ms.`,
            {
              code: "ibkr_bridge_request_timeout",
              cause: error,
            },
          );
        }

        throw error;
      })
      .finally(() => {
        if (timeout !== null) {
          clearTimeout(timeout);
        }
        inputSignal?.removeEventListener("abort", abortFromInput);
      });
  }

  private requestJson<T>(
    path: string,
    url: URL,
    init: RequestInit,
  ): Promise<T> {
    const startedAt = performance.now();
    const requestId = randomUUID();
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    const body =
      typeof init.body === "string" || Buffer.isBuffer(init.body)
        ? init.body
        : init.body == null
          ? undefined
          : String(init.body);

    if (body !== undefined && !headers.has("Content-Length")) {
      headers.set("Content-Length", String(Buffer.byteLength(body)));
    }

    return new Promise<T>((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const agent =
        url.protocol === "https:" ? bridgeHttpsAgent : bridgeHttpAgent;
      const request = client.request(
        url,
        {
          method,
          headers: Object.fromEntries(headers.entries()),
          agent,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            const durationMs = Math.round(performance.now() - startedAt);
            const text = Buffer.concat(chunks).toString("utf8");
            const statusCode = response.statusCode ?? 0;
            const statusMessage = response.statusMessage ?? "";
            const payload = readJsonResponsePayload(
              text,
              String(response.headers["content-type"] ?? ""),
            );
            const logPayload = {
              requestId,
              path,
              method,
              statusCode,
              durationMs,
              reusedSocket: request.reusedSocket,
            };
            const logLevel =
              process.env.LOG_LEVEL === "info" ? "info" : "debug";
            logger[logLevel](logPayload, "IBKR bridge request completed");

            if (statusCode < 200 || statusCode >= 300) {
              reject(
                new HttpError(
                  statusCode,
                  buildBridgeErrorMessage(statusCode, statusMessage, payload),
                  {
                    code: "upstream_http_error",
                    detail:
                      typeof payload === "string"
                        ? payload
                        : payload && typeof payload === "object"
                          ? JSON.stringify(payload)
                          : undefined,
                    data: payload,
                    expose: statusCode < 500,
                  },
                ),
              );
              return;
            }

            resolve(payload as T);
          });
        },
      );

      request.on("error", (error) => {
        reject(
          new HttpError(502, "Upstream request failed.", {
            code: "upstream_request_failed",
            cause: error,
            detail:
              error instanceof Error && error.message
                ? error.message
                : "The upstream service could not be reached.",
          }),
        );
      });

      const abort = () => {
        request.destroy(init.signal?.reason);
      };

      if (init.signal?.aborted) {
        abort();
      } else {
        init.signal?.addEventListener("abort", abort, { once: true });
      }

      request.on("close", () => {
        init.signal?.removeEventListener("abort", abort);
      });

      if (body !== undefined) {
        request.write(body);
      }
      request.end();
    });
  }

  async getHealth(): Promise<BridgeHealthSnapshot> {
    return hydrateHealth(await this.request<BridgeHealthSnapshot>("/healthz"));
  }

  async getLaneDiagnostics(): Promise<BridgeLaneDiagnosticsSnapshot> {
    return this.request<BridgeLaneDiagnosticsSnapshot>("/diagnostics/lanes");
  }

  async updateLaneDiagnostics(
    input: BridgeLaneSettingsRequest,
  ): Promise<BridgeLaneDiagnosticsSnapshot> {
    return this.request<BridgeLaneDiagnosticsSnapshot>("/diagnostics/lanes", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  }

  async getSession(): Promise<SessionStatusSnapshot | null> {
    return hydrateSession(
      await this.request<SessionStatusSnapshot | null>("/session"),
    );
  }

  async listAccounts(mode: RuntimeMode): Promise<BrokerAccountSnapshot[]> {
    const payload = await this.request<{ accounts: BrokerAccountSnapshot[] }>(
      "/accounts",
      {},
      { mode },
    );
    return payload.accounts.map(hydrateAccount);
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    const payload = await this.request<{ positions: BrokerPositionSnapshot[] }>(
      "/positions",
      {},
      {
        mode: input.mode,
        accountId: input.accountId,
      },
    );
    return payload.positions.map(hydratePosition);
  }

  async listOrders(input: {
    accountId?: string;
    mode: RuntimeMode;
    status?:
      | "pending_submit"
      | "submitted"
      | "accepted"
      | "partially_filled"
      | "filled"
      | "canceled"
      | "rejected"
      | "expired";
  }): Promise<BrokerOrderSnapshot[]> {
    const payload = await this.listOrdersWithMeta(input);
    return payload.orders;
  }

  async listOrdersWithMeta(input: {
    accountId?: string;
    mode: RuntimeMode;
    status?:
      | "pending_submit"
      | "submitted"
      | "accepted"
      | "partially_filled"
      | "filled"
      | "canceled"
      | "rejected"
      | "expired";
    signal?: AbortSignal;
  }): Promise<BridgeOrdersResult> {
    const payload = await this.request<{
      orders: BrokerOrderSnapshot[];
      degraded?: boolean;
      reason?: string;
      stale?: boolean;
      detail?: string;
      timeoutMs?: number;
    }>(
      "/orders",
      { signal: input.signal },
      {
        mode: input.mode,
        accountId: input.accountId,
        status: input.status,
      },
    );
    return {
      orders: payload.orders.map(hydrateOrder),
      degraded: payload.degraded,
      reason: payload.reason,
      stale: payload.stale,
      detail: payload.detail,
      timeoutMs: payload.timeoutMs,
    };
  }

  async listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]> {
    const payload = await this.request<{
      executions: BrokerExecutionSnapshot[];
    }>(
      "/executions",
      {},
      {
        accountId: input.accountId,
        days: input.days,
        limit: input.limit,
        symbol: input.symbol,
        providerContractId: input.providerContractId,
      },
    );
    return payload.executions.map(hydrateExecution);
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const bridgeSymbols = normalizeBridgeStockSymbols(symbols);
    const payload = await this.request<{
      quotes: Array<
        Omit<QuoteSnapshot, "updatedAt"> & { updatedAt: string | Date }
      >;
    }>("/quotes/snapshot", {}, { symbols: bridgeSymbols.join(",") });
    return payload.quotes.map(hydrateQuote);
  }

  async getOptionActivitySnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const bridgeSymbols = normalizeBridgeStockSymbols(symbols);
    const payload = await this.request<{
      quotes: Array<
        Omit<QuoteSnapshot, "updatedAt"> & { updatedAt: string | Date }
      >;
    }>("/quotes/option-activity", {}, { symbols: bridgeSymbols.join(",") });
    return payload.quotes.map(hydrateQuote);
  }

  async getOptionQuoteSnapshots(input: {
    underlying?: string | null;
    providerContractIds: string[];
  }): Promise<QuoteSnapshot[]> {
    const normalizedProviderContractIds = Array.from(
      new Set(
        input.providerContractIds
          .map((providerContractId) => providerContractId.trim())
          .filter(Boolean),
      ),
    );
    if (normalizedProviderContractIds.length === 0) {
      return [];
    }

    const payload = await this.request<{
      quotes: Array<
        Omit<QuoteSnapshot, "updatedAt"> & { updatedAt: string | Date }
      >;
    }>(
      "/options/quotes",
      {},
      {
        underlying: input.underlying ?? undefined,
        contracts: normalizedProviderContractIds.join(","),
      },
    );
    return payload.quotes.map(hydrateQuote);
  }

  async prewarmQuoteSubscriptions(symbols: string[]): Promise<void> {
    const normalizedSymbols = normalizeBridgeStockSymbols(symbols);

    await this.request<{ symbols: string[]; updatedAt: string }>(
      "/quotes/prewarm",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ symbols: normalizedSymbols }),
      },
    );
  }

  streamQuoteSnapshots(
    symbols: string[],
    onQuotes: (quotes: QuoteSnapshot[]) => void,
    onError?: (error: unknown) => void,
    onSignal?: (signal: QuoteStreamSignal) => void,
  ): () => void {
    const config = this.getConfig();
    const bridgeSymbols = normalizeBridgeStockSymbols(symbols);
    const url = this.buildUrl(config, "/streams/quotes", {
      symbols: bridgeSymbols.join(","),
    });
    const requestId = randomUUID();
    const client = url.protocol === "https:" ? https : http;
    const agent =
      url.protocol === "https:" ? bridgeHttpsAgent : bridgeHttpAgent;
    let stopped = false;
    let buffer = "";
    let lastUsefulEventAt = Date.now();
    let lastStreamStatus: StreamStatusPayload | null = null;
    let stallTimer: NodeJS.Timeout | null = null;
    const touchStreamActivity = () => {
      lastUsefulEventAt = Date.now();
    };
    const stopStallWatchdog = () => {
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
    };
    const startStallWatchdog = () => {
      stopStallWatchdog();
      if (this.quoteStreamStallMs <= 0) {
        return;
      }
      stallTimer = setInterval(
        () => {
          if (stopped || !isLikelyUsEquitySession()) {
            return;
          }
          const ageMs = Date.now() - lastUsefulEventAt;
          if (ageMs < this.quoteStreamStallMs) {
            return;
          }
          const error = new Error(
            `IBKR bridge quote stream stalled for ${ageMs}ms.`,
          );
          logger.warn(
            { requestId, ageMs, symbols: bridgeSymbols, lastStreamStatus },
            "IBKR bridge quote stream stalled",
          );
          stopped = true;
          request.destroy(error);
          onError?.(error);
        },
        Math.max(1_000, Math.floor(this.quoteStreamStallMs / 2)),
      );
      stallTimer.unref?.();
    };

    const request = client.request(
      url,
      {
        method: "GET",
        headers: this.buildNodeHeaders(config, {
          Accept: "text/event-stream",
        }),
        agent,
      },
      (response) => {
        if (
          (response.statusCode ?? 0) < 200 ||
          (response.statusCode ?? 0) >= 300
        ) {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            if (stopped) {
              return;
            }

            onError?.(
              new HttpError(
                response.statusCode ?? 502,
                `IBKR bridge quote stream failed with HTTP ${response.statusCode ?? 0}.`,
                {
                  code: "ibkr_bridge_stream_failed",
                  detail: Buffer.concat(chunks).toString("utf8"),
                },
              ),
            );
          });
          return;
        }

        logger.info(
          {
            requestId,
            symbols: bridgeSymbols,
            reusedSocket: request.reusedSocket,
          },
          "IBKR bridge quote stream connected",
        );
        lastUsefulEventAt = Date.now();
        onSignal?.({
          type: "open",
          at: new Date(lastUsefulEventAt),
          status: null,
        });
        startStallWatchdog();

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (stopped) {
            return;
          }

          buffer += chunk;
          let boundary = findSseBoundary(buffer);
          while (boundary) {
            const rawBlock = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary.length);
            const message = parseSseBlock(rawBlock);

            if (message?.event === "quotes") {
              try {
                const payload = JSON.parse(message.data) as QuoteStreamPayload;
                const quotes = (payload.quotes ?? []).map(hydrateQuote);
                if (quotes.length) {
                  lastUsefulEventAt = Date.now();
                  onQuotes(quotes);
                }
              } catch (error) {
                logger.warn(
                  { err: error },
                  "IBKR bridge quote stream payload parse failed",
                );
              }
            } else if (message?.event === "stream-status") {
              try {
                lastStreamStatus = JSON.parse(
                  message.data,
                ) as StreamStatusPayload;
                lastUsefulEventAt = Date.now();
                onSignal?.({
                  type: "status",
                  at: new Date(lastUsefulEventAt),
                  status: lastStreamStatus,
                });
              } catch {
                lastStreamStatus = null;
              }
            } else if (message?.event === "ready") {
              lastUsefulEventAt = Date.now();
              onSignal?.({
                type: "ready",
                at: new Date(lastUsefulEventAt),
                status: lastStreamStatus,
              });
            } else if (message?.event === "heartbeat") {
              lastUsefulEventAt = Date.now();
              onSignal?.({
                type: "heartbeat",
                at: new Date(lastUsefulEventAt),
                status: lastStreamStatus,
              });
            } else if (
              !message &&
              rawBlock.split(/\r?\n/).some((line) => line.startsWith(":"))
            ) {
              lastUsefulEventAt = Date.now();
              onSignal?.({
                type: "heartbeat",
                at: new Date(lastUsefulEventAt),
                status: lastStreamStatus,
              });
            }

            boundary = findSseBoundary(buffer);
          }
        });
        response.on("end", () => {
          stopStallWatchdog();
          if (!stopped) {
            onError?.(new Error("IBKR bridge quote stream ended."));
          }
        });
      },
    );

    request.on("error", (error) => {
      stopStallWatchdog();
      if (!stopped) {
        onError?.(error);
      }
    });

    request.end();

    return () => {
      stopped = true;
      stopStallWatchdog();
      request.destroy();
    };
  }

  streamOptionQuoteSnapshots(
    input: {
      underlying?: string | null;
      providerContractIds: string[];
    },
    onQuotes: (quotes: QuoteSnapshot[]) => void,
    onError?: (error: unknown) => void,
    onSignal?: (signal: QuoteStreamSignal) => void,
  ): () => void {
    const normalizedProviderContractIds = Array.from(
      new Set(
        input.providerContractIds
          .map((providerContractId) => providerContractId.trim())
          .filter(Boolean),
      ),
    );
    const config = this.getConfig();
    const url = this.buildUrl(config, "/streams/options/quotes", {
      underlying: input.underlying ?? undefined,
      contracts: normalizedProviderContractIds.join(","),
    });
    const requestId = randomUUID();
    const client = url.protocol === "https:" ? https : http;
    const agent =
      url.protocol === "https:" ? bridgeHttpsAgent : bridgeHttpAgent;
    let stopped = false;
    let buffer = "";
    let lastUsefulEventAt = Date.now();
    let lastStreamStatus: StreamStatusPayload | null = null;
    let stallTimer: NodeJS.Timeout | null = null;
    const touchStreamActivity = () => {
      lastUsefulEventAt = Date.now();
    };
    const stopStallWatchdog = () => {
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
    };
    const startStallWatchdog = () => {
      stopStallWatchdog();
      if (this.optionQuoteStreamStallMs <= 0) {
        return;
      }
      stallTimer = setInterval(
        () => {
          if (stopped || !isLikelyUsEquitySession()) {
            return;
          }
          const ageMs = Date.now() - lastUsefulEventAt;
          if (ageMs < this.optionQuoteStreamStallMs) {
            return;
          }
          const error = new Error(
            `IBKR bridge option quote stream stalled for ${ageMs}ms.`,
          );
          logger.warn(
            {
              requestId,
              ageMs,
              providerContractIds: normalizedProviderContractIds.length,
              lastStreamStatus,
            },
            "IBKR bridge option quote stream stalled",
          );
          stopped = true;
          request.destroy(error);
          onError?.(error);
        },
        Math.max(1_000, Math.floor(this.optionQuoteStreamStallMs / 2)),
      );
      stallTimer.unref?.();
    };

    const request = client.request(
      url,
      {
        method: "GET",
        headers: this.buildNodeHeaders(config, {
          Accept: "text/event-stream",
        }),
        agent,
      },
      (response) => {
        if (
          (response.statusCode ?? 0) < 200 ||
          (response.statusCode ?? 0) >= 300
        ) {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            if (stopped) {
              return;
            }

            onError?.(
              new HttpError(
                response.statusCode ?? 502,
                `IBKR bridge option quote stream failed with HTTP ${response.statusCode ?? 0}.`,
                {
                  code: "ibkr_bridge_option_stream_failed",
                  detail: Buffer.concat(chunks).toString("utf8"),
                },
              ),
            );
          });
          return;
        }

        logger.info(
          {
            requestId,
            providerContractIds: normalizedProviderContractIds,
            reusedSocket: request.reusedSocket,
          },
          "IBKR bridge option quote stream connected",
        );
        touchStreamActivity();
        onSignal?.({
          type: "open",
          at: new Date(lastUsefulEventAt),
          status: null,
        });
        startStallWatchdog();

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (stopped) {
            return;
          }

          buffer += chunk;
          let boundary = findSseBoundary(buffer);
          while (boundary) {
            const rawBlock = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary.length);
            const message = parseSseBlock(rawBlock);

            if (message?.event === "quotes") {
              try {
                const payload = JSON.parse(
                  message.data,
                ) as OptionQuoteStreamPayload;
                const quotes = (payload.quotes ?? []).map(hydrateQuote);
                if (quotes.length) {
                  touchStreamActivity();
                  onQuotes(quotes);
                }
              } catch (error) {
                logger.warn(
                  { err: error },
                  "IBKR bridge option quote stream payload parse failed",
                );
              }
            } else if (message?.event === "stream-status") {
              try {
                touchStreamActivity();
                lastStreamStatus = JSON.parse(
                  message.data,
                ) as StreamStatusPayload;
                onSignal?.({
                  type: "status",
                  at: new Date(lastUsefulEventAt),
                  status: lastStreamStatus,
                });
              } catch {
                lastStreamStatus = null;
              }
            } else if (message?.event === "ready") {
              touchStreamActivity();
              onSignal?.({
                type: "ready",
                at: new Date(lastUsefulEventAt),
                status: lastStreamStatus,
              });
            } else if (message?.event === "heartbeat") {
              touchStreamActivity();
              onSignal?.({
                type: "heartbeat",
                at: new Date(lastUsefulEventAt),
                status: lastStreamStatus,
              });
            } else if (
              !message &&
              rawBlock.split(/\r?\n/).some((line) => line.startsWith(":"))
            ) {
              touchStreamActivity();
              onSignal?.({
                type: "heartbeat",
                at: new Date(lastUsefulEventAt),
                status: lastStreamStatus,
              });
            }

            boundary = findSseBoundary(buffer);
          }
        });
        response.on("end", () => {
          stopStallWatchdog();
          if (!stopped) {
            onError?.(new Error("IBKR bridge option quote stream ended."));
          }
        });
      },
    );

    request.on("error", (error) => {
      stopStallWatchdog();
      if (!stopped) {
        onError?.(error);
      }
    });

    request.end();

    return () => {
      stopped = true;
      stopStallWatchdog();
      request.destroy();
    };
  }

  streamHistoricalBars(
    input: {
      symbol: string;
      timeframe: HistoryBarTimeframe;
      assetClass?: "equity" | "option";
      providerContractId?: string | null;
      outsideRth?: boolean;
      source?: HistoryDataSource;
    },
    onBar: (bar: BrokerBarSnapshot) => void,
    onError?: (error: unknown) => void,
  ): () => void {
    const config = this.getConfig();
    const bridgeSymbol = toBridgeStockSymbolForRequest(input);
    const url = this.buildUrl(config, "/streams/bars", {
      symbol: bridgeSymbol,
      timeframe: input.timeframe,
      assetClass: input.assetClass,
      providerContractId: input.providerContractId,
      outsideRth:
        typeof input.outsideRth === "boolean"
          ? String(input.outsideRth)
          : undefined,
      source: input.source,
    });
    const requestId = randomUUID();
    const client = url.protocol === "https:" ? https : http;
    const agent =
      url.protocol === "https:" ? bridgeHttpsAgent : bridgeHttpAgent;
    let stopped = false;
    let buffer = "";
    let lastUsefulEventAt = Date.now();
    let lastStreamStatus: StreamStatusPayload | null = null;
    let stallTimer: NodeJS.Timeout | null = null;
    const touchStreamActivity = () => {
      lastUsefulEventAt = Date.now();
    };
    const stopStallWatchdog = () => {
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
    };
    const startStallWatchdog = () => {
      stopStallWatchdog();
      if (this.historicalBarStreamStallMs <= 0) {
        return;
      }
      stallTimer = setInterval(
        () => {
          if (stopped || !isLikelyUsEquitySession()) {
            return;
          }
          const ageMs = Date.now() - lastUsefulEventAt;
          if (ageMs < this.historicalBarStreamStallMs) {
            return;
          }
          const error = new Error(
            `IBKR bridge historical bar stream stalled for ${ageMs}ms.`,
          );
          logger.warn(
            {
              requestId,
              ageMs,
              symbol: bridgeSymbol,
              timeframe: input.timeframe,
              lastStreamStatus,
            },
            "IBKR bridge historical bar stream stalled",
          );
          stopped = true;
          request.destroy(error);
          onError?.(error);
        },
        Math.max(5_000, Math.floor(this.historicalBarStreamStallMs / 2)),
      );
      stallTimer.unref?.();
    };

    const request = client.request(
      url,
      {
        method: "GET",
        headers: this.buildNodeHeaders(config, {
          Accept: "text/event-stream",
        }),
        agent,
      },
      (response) => {
        if (
          (response.statusCode ?? 0) < 200 ||
          (response.statusCode ?? 0) >= 300
        ) {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            if (stopped) {
              return;
            }

            onError?.(
              new HttpError(
                response.statusCode ?? 502,
                `IBKR bridge bar stream failed with HTTP ${response.statusCode ?? 0}.`,
                {
                  code: "ibkr_bridge_bar_stream_failed",
                  detail: Buffer.concat(chunks).toString("utf8"),
                },
              ),
            );
          });
          return;
        }

        logger.info(
          {
            requestId,
            symbol: bridgeSymbol,
            timeframe: input.timeframe,
            providerContractId: input.providerContractId ?? null,
            reusedSocket: request.reusedSocket,
          },
          "IBKR bridge historical bar stream connected",
        );
        touchStreamActivity();
        startStallWatchdog();

        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (stopped) {
            return;
          }

          buffer += chunk;
          let boundary = findSseBoundary(buffer);
          while (boundary) {
            const rawBlock = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary.length);
            const message = parseSseBlock(rawBlock);

            if (message?.event === "bar") {
              try {
                const payload = JSON.parse(message.data) as BarStreamPayload;
                if (payload.bar) {
                  touchStreamActivity();
                  onBar({
                    ...payload.bar,
                    timestamp:
                      payload.bar.timestamp instanceof Date
                        ? payload.bar.timestamp
                        : new Date(payload.bar.timestamp),
                    dataUpdatedAt: payload.bar.dataUpdatedAt
                      ? toDate(payload.bar.dataUpdatedAt)
                      : null,
                  });
                }
              } catch (error) {
                logger.warn(
                  { err: error },
                  "IBKR bridge bar stream payload parse failed",
                );
              }
            } else if (message?.event === "stream-status") {
              try {
                touchStreamActivity();
                lastStreamStatus = JSON.parse(
                  message.data,
                ) as StreamStatusPayload;
              } catch {
                lastStreamStatus = null;
              }
            } else if (
              message?.event === "ready" ||
              message?.event === "heartbeat"
            ) {
              touchStreamActivity();
            } else if (
              !message &&
              rawBlock.split(/\r?\n/).some((line) => line.startsWith(":"))
            ) {
              touchStreamActivity();
            } else if (
              message?.event === "stream-error" ||
              message?.event === "error"
            ) {
              try {
                const payload = JSON.parse(message.data) as {
                  title?: string;
                  detail?: string;
                };
                onError?.(
                  new Error(
                    payload.detail ||
                      payload.title ||
                      "IBKR bridge bar stream reported an error.",
                  ),
                );
              } catch (error) {
                logger.warn(
                  { err: error },
                  "IBKR bridge bar stream error payload parse failed",
                );
                onError?.(
                  new Error("IBKR bridge bar stream reported an error."),
                );
              }
            }

            boundary = findSseBoundary(buffer);
          }
        });
        response.on("end", () => {
          stopStallWatchdog();
          if (!stopped) {
            onError?.(new Error("IBKR bridge bar stream ended."));
          }
        });
      },
    );

    request.on("error", (error) => {
      stopStallWatchdog();
      if (!stopped) {
        onError?.(error);
      }
    });

    request.end();

    return () => {
      stopped = true;
      stopStallWatchdog();
      request.destroy();
    };
  }

  async getHistoricalBars(input: {
    symbol: string;
    timeframe: HistoryBarTimeframe;
    limit?: number;
    from?: Date;
    to?: Date;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    outsideRth?: boolean;
    source?: HistoryDataSource;
    signal?: AbortSignal;
  }): Promise<BrokerBarSnapshot[]> {
    const bridgeSymbol = toBridgeStockSymbolForRequest(input);
    const payload = await this.request<{
      bars: Array<
        Omit<BrokerBarSnapshot, "timestamp" | "dataUpdatedAt"> & {
          timestamp: string | Date;
          dataUpdatedAt?: string | Date | null;
        }
      >;
    }>(
      "/bars",
      { signal: input.signal },
      {
        symbol: bridgeSymbol,
        timeframe: input.timeframe,
        limit: input.limit,
        from: input.from,
        to: input.to,
        assetClass: input.assetClass,
        providerContractId: input.providerContractId,
        outsideRth: input.outsideRth,
        source: input.source,
      },
    );
    return payload.bars.map((bar) => ({
      ...bar,
      timestamp:
        bar.timestamp instanceof Date ? bar.timestamp : new Date(bar.timestamp),
      dataUpdatedAt: bar.dataUpdatedAt ? toDate(bar.dataUpdatedAt) : null,
    }));
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put";
    maxExpirations?: number;
    strikesAroundMoney?: number;
    strikeCoverage?: "fast" | "standard" | "full";
    quoteHydration?: "metadata" | "snapshot";
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    const payload = await this.request<{ contracts: OptionChainContract[] }>(
      "/options/chains",
      {
        signal: input.signal,
      },
      {
        underlying: input.underlying,
        expirationDate: input.expirationDate,
        contractType: input.contractType,
        maxExpirations: input.maxExpirations,
        strikesAroundMoney: input.strikesAroundMoney,
        strikeCoverage: input.strikeCoverage,
        quoteHydration: input.quoteHydration,
      },
    );
    return payload.contracts.map(hydrateOptionChainContract);
  }

  async getOptionExpirations(input: {
    underlying: string;
    maxExpirations?: number;
    signal?: AbortSignal;
  }): Promise<Date[]> {
    const payload = await this.request<OptionExpirationsPayload>(
      "/options/expirations",
      {
        signal: input.signal,
      },
      {
        underlying: input.underlying,
        maxExpirations: input.maxExpirations,
      },
    ).catch(async (error: unknown) => {
      if (error instanceof HttpError && error.statusCode === 404) {
        const contracts = await this.getOptionChain({
          underlying: input.underlying,
          contractType: "call",
          maxExpirations: input.maxExpirations,
          strikesAroundMoney: 1,
          signal: input.signal,
        });

        return {
          expirations: Array.from(
            new Map(
              contracts.map((contract) => {
                const expirationDate = contract.contract.expirationDate;
                return [
                  expirationDate.toISOString().slice(0, 10),
                  expirationDate,
                ];
              }),
            ).values(),
          ),
        };
      }

      throw error;
    });
    return payload.expirations
      .map((expiration) =>
        expiration instanceof Date || typeof expiration === "string"
          ? toDate(expiration)
          : toDate(expiration.expirationDate),
      )
      .filter((expiration) => !Number.isNaN(expiration.getTime()));
  }

  async getMarketDepth(input: {
    accountId?: string;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null> {
    const bridgeSymbol = toBridgeStockSymbolForRequest(input);
    const payload = await this.request<{
      depth: BrokerMarketDepthSnapshot | null;
    }>(
      "/market-depth",
      {},
      {
        accountId: input.accountId,
        symbol: bridgeSymbol,
        assetClass: input.assetClass,
        providerContractId: input.providerContractId,
        exchange: input.exchange,
      },
    );
    return hydrateMarketDepth(payload.depth);
  }

  async previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    const raw = await this.request<OrderPreviewSnapshot>("/orders/preview", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
    return {
      ...raw,
      optionContract: hydrateOptionContract(raw.optionContract),
    };
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot> {
    return hydrateOrder(
      await this.request<BrokerOrderSnapshot>("/orders", {
        method: "POST",
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
  }

  submitRawOrders(input: {
    accountId?: string | null;
    mode?: RuntimeMode | null;
    confirm?: boolean | null;
    ibkrOrders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/orders/submit", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
    confirm?: boolean | null;
  }): Promise<ReplaceOrderSnapshot> {
    return hydrateOrder(
      await this.request<ReplaceOrderSnapshot>(
        `/orders/${encodeURIComponent(input.orderId)}/replace`,
        {
          method: "POST",
          body: JSON.stringify(input),
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
    confirm?: boolean | null;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    const raw = await this.request<CancelOrderSnapshot>(
      `/orders/${encodeURIComponent(input.orderId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return { ...raw, submittedAt: toDate(raw.submittedAt) };
  }

  async getNews(input: {
    ticker?: string;
    limit?: number;
  }): Promise<IbkrNewsArticle[]> {
    const params: Record<string, QueryValue> = {};
    if (input.ticker) params.ticker = input.ticker;
    if (typeof input.limit === "number") params.limit = input.limit;
    const raw = await this.request<IbkrNewsArticle[]>("/news", {}, params);
    return raw.map((article) => ({
      ...article,
      publishedAt: toDate(article.publishedAt),
    }));
  }

  async searchTickers(input: {
    search?: string;
    market?: IbkrUniverseTicker["market"];
    markets?: IbkrUniverseTicker["market"][];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    const params: Record<string, QueryValue> = {};
    if (input.search) params.search = input.search;
    if (input.market) params.market = input.market;
    if (input.markets?.length) params.markets = input.markets;
    if (typeof input.limit === "number") params.limit = input.limit;
    return this.request<{ count: number; results: IbkrUniverseTicker[] }>(
      "/universe/search",
      { signal: input.signal },
      params,
    );
  }
}
