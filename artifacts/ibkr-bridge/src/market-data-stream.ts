import WebSocket from "ws";
import {
  type BrokerMarketDepthLevel,
  type BrokerMarketDepthSnapshot,
  IbkrClient,
  parseSnapshotQuote,
  type QuoteSnapshot,
  type ResolvedIbkrContract,
  STREAMING_SNAPSHOT_FIELDS,
} from "../../api-server/src/providers/ibkr/client";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  compact,
  normalizeSymbol,
} from "../../api-server/src/lib/values";
import { logger } from "./logger";

type QuoteSubscriptionEntry = ResolvedIbkrContract;
type DepthSubscriptionEntry = {
  accountId: string;
  symbol: string;
  assetClass: "equity" | "option";
  providerContractId: string;
  exchange: string;
};
type QuoteStreamListener = {
  id: number;
  symbols: Set<string>;
  onQuote: (quote: QuoteSnapshot) => void;
};

function buildDepthKey(
  accountId: string,
  providerContractId: string,
  exchange: string,
): string {
  return `${accountId}:${providerContractId}:${exchange}`;
}

function extractNumericToken(
  value: unknown,
  { preferLast = false }: { preferLast?: boolean } = {},
): number | null {
  const direct = asNumber(value);
  if (direct !== null) {
    return direct;
  }

  const text = asString(value);
  if (!text) {
    return null;
  }

  const matches = Array.from(text.matchAll(/-?\d+(?:\.\d+)?/g)).map((match) =>
    Number(match[0]),
  );

  if (!matches.length) {
    return null;
  }

  return preferLast ? matches[matches.length - 1] : matches[0];
}

function parseDepthLevel(rawLevel: unknown): BrokerMarketDepthLevel | null {
  const level = asRecord(rawLevel);
  if (!level) {
    return null;
  }

  const row = asNumber(level["row"]);
  const priceField = asString(level["price"]);
  const price = extractNumericToken(level["price"], {
    preferLast: Boolean(priceField?.includes("@")),
  });

  if (row === null || price === null) {
    return null;
  }

  const totalSize = priceField?.includes("@")
    ? extractNumericToken(level["price"])
    : null;

  return {
    row,
    price,
    bidSize: extractNumericToken(level["bid"]),
    askSize: extractNumericToken(level["ask"]),
    totalSize,
    isLastTrade: asNumber(level["focus"]) === 1,
  };
}

export class IbkrMarketDataStream {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private smdRenewTimer: NodeJS.Timeout | null = null;
  private readonly smdRenewIntervalMs = Math.max(
    60_000,
    Number(process.env["IBKR_SMD_RENEW_INTERVAL_MS"] ?? "540000"),
  );
  private readonly quoteSubscriptionsByConid = new Map<
    string,
    QuoteSubscriptionEntry
  >();
  private readonly quotesByConid = new Map<string, QuoteSnapshot>();
  private readonly rawPayloadsByConid = new Map<
    string,
    Record<string, unknown>
  >();
  private readonly prewarmSymbolsSet = new Set<string>();
  private readonly quoteRestSeedInFlightSymbols = new Set<string>();
  private readonly depthSubscriptionsByKey = new Map<
    string,
    DepthSubscriptionEntry
  >();
  private readonly depthByKey = new Map<string, BrokerMarketDepthSnapshot>();
  private readonly quoteListeners = new Map<number, QuoteStreamListener>();
  private nextQuoteListenerId = 1;

  constructor(
    private readonly client: IbkrClient,
    private readonly allowInsecureTls: boolean,
  ) {}

  private getQuoteFreshness(quote: QuoteSnapshot, now = Date.now()) {
    const ageMs = Math.max(0, now - quote.updatedAt.getTime());
    return {
      freshness: ageMs <= 5_000 ? "live" as const : "stale" as const,
      cacheAgeMs: ageMs,
    };
  }

  private decorateQuoteForEmit(
    quote: QuoteSnapshot,
    bridgeEmittedAt = new Date(),
  ): QuoteSnapshot {
    return {
      ...quote,
      ...this.getQuoteFreshness(quote, bridgeEmittedAt.getTime()),
      latency: {
        ...(quote.latency ?? {}),
        bridgeEmittedAt,
      },
    };
  }

  private emitQuote(quote: QuoteSnapshot) {
    const normalizedSymbol = normalizeSymbol(quote.symbol);
    const emittedQuote = this.decorateQuoteForEmit(quote);

    this.quoteListeners.forEach((listener) => {
      if (!listener.symbols.has(normalizedSymbol)) {
        return;
      }

      listener.onQuote(emittedQuote);
    });
  }

  private handleMessage(payload: WebSocket.RawData) {
    const text = typeof payload === "string" ? payload : payload.toString("utf8");
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    const record = asRecord(parsed);
    if (!record) {
      return;
    }

    const topic = asString(record["topic"]);
    if (!topic) {
      return;
    }

    if (topic.startsWith("smd+")) {
      const bridgeReceivedAt = new Date();
      const conid = asString(record["conid"]) ?? asString(record["conidEx"]);
      if (!conid) {
        return;
      }

      const subscription = this.quoteSubscriptionsByConid.get(conid);
      const symbol =
        subscription?.symbol ??
        normalizeSymbol(asString(record["55"]) ?? asString(record["symbol"]) ?? "");

      if (!symbol) {
        return;
      }

      // IBKR streams partial field updates per tick. Merge incoming
      // fields into the cached payload so accumulated state (high/low/
      // open/prevClose/volume) survives subsequent ticks that only
      // carry bid/ask/last deltas.
      const previous = this.rawPayloadsByConid.get(conid) ?? {};
      const merged: Record<string, unknown> = { ...previous };
      for (const [key, value] of Object.entries(record)) {
        if (value === null || value === undefined || value === "") {
          continue;
        }
        merged[key] = value;
      }
      this.rawPayloadsByConid.set(conid, merged);
      const quote = {
        ...parseSnapshotQuote(symbol, conid, merged, "equity"),
        freshness: "live" as const,
        cacheAgeMs: 0,
        latency: {
          bridgeReceivedAt,
        },
      };
      this.quotesByConid.set(conid, quote);
      this.emitQuote(quote);
      return;
    }

    if (topic.startsWith("sbd+")) {
      const [, accountId = "", providerContractId = "", exchange = "SMART"] =
        topic.split("+");
      if (!accountId || !providerContractId) {
        return;
      }

      const key = buildDepthKey(accountId, providerContractId, exchange);
      const subscription = this.depthSubscriptionsByKey.get(key);
      if (!subscription) {
        return;
      }

      const levels = compact(asArray(record["data"]).map(parseDepthLevel)).sort(
        (left, right) => left.row - right.row,
      );

      const updatedAt = new Date();
      this.depthByKey.set(key, {
        accountId,
        symbol: subscription.symbol,
        assetClass: subscription.assetClass,
        providerContractId,
        exchange,
        updatedAt,
        levels,
        freshness: "live",
        cacheAgeMs: 0,
      });
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch((error) => {
        logger.warn({ err: error }, "IBKR websocket reconnect failed");
      });
    }, 1_000);
    this.reconnectTimer.unref?.();
  }

  private sendQuoteSubscription(subscription: QuoteSubscriptionEntry) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(
      `smd+${subscription.conid}+${JSON.stringify({
        fields: STREAMING_SNAPSHOT_FIELDS,
      })}`,
    );
  }

  private sendQuoteUnsubscribe(providerContractId: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(`umd+${providerContractId}+{}`);
  }

  private getQuoteListenerSymbols(): Set<string> {
    return Array.from(this.quoteListeners.values()).reduce<Set<string>>(
      (symbols, listener) => {
        listener.symbols.forEach((symbol) => symbols.add(symbol));
        return symbols;
      },
      new Set(),
    );
  }

  private getDesiredQuoteSymbols(extraSymbols: string[] = []): string[] {
    return Array.from(
      new Set([
        ...this.prewarmSymbolsSet,
        ...this.getQuoteListenerSymbols(),
        ...extraSymbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
      ]),
    ).sort();
  }

  private trimUnusedQuoteSubscriptions() {
    const desiredSymbols = new Set(this.getDesiredQuoteSymbols());

    for (const [providerContractId, subscription] of this.quoteSubscriptionsByConid) {
      if (desiredSymbols.has(subscription.symbol)) {
        continue;
      }

      this.sendQuoteUnsubscribe(providerContractId);
      this.quoteSubscriptionsByConid.delete(providerContractId);
      this.quotesByConid.delete(providerContractId);
      this.rawPayloadsByConid.delete(providerContractId);
      this.quoteRestSeedInFlightSymbols.delete(subscription.symbol);
    }
  }

  private sendDepthSubscription(subscription: DepthSubscriptionEntry) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(
      `sbd+${subscription.accountId}+${subscription.providerContractId}+${subscription.exchange}`,
    );
  }

  private renewQuoteSubscriptions() {
    for (const subscription of this.quoteSubscriptionsByConid.values()) {
      this.sendQuoteSubscription(subscription);
    }
  }

  private async resubscribeAll() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.renewQuoteSubscriptions();

    for (const subscription of this.depthSubscriptionsByKey.values()) {
      this.sendDepthSubscription(subscription);
    }
  }

  private ensureSmdRenewalLoop() {
    if (this.smdRenewTimer) {
      return;
    }

    this.smdRenewTimer = setInterval(() => {
      if (this.quoteSubscriptionsByConid.size === 0) {
        return;
      }

      void this.ensureConnected()
        .then(() => this.renewQuoteSubscriptions())
        .catch((error) => {
          logger.warn({ err: error }, "IBKR SMD subscription renewal failed");
        });
    }, this.smdRenewIntervalMs);
    this.smdRenewTimer.unref?.();
  }

  async ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const connection = await this.client.getWebSocketConnectionConfig();

      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(connection.url, {
          headers: connection.headers,
          rejectUnauthorized: !this.allowInsecureTls,
        });

        let settled = false;

        socket.on("open", () => {
          settled = true;
          this.socket = socket;
          void this.resubscribeAll();
          resolve();
        });

        socket.on("message", (payload: WebSocket.RawData) => {
          this.handleMessage(payload);
        });

        socket.on("error", (error: Error) => {
          if (!settled) {
            settled = true;
            reject(error);
            return;
          }

          logger.warn({ err: error }, "IBKR websocket stream error");
        });

        socket.on("close", () => {
          if (this.socket === socket) {
            this.socket = null;
          }

          if (!settled) {
            settled = true;
            reject(new Error("IBKR websocket closed before opening"));
            return;
          }

          this.scheduleReconnect();
        });
      });
    })();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async ensureSymbolSubscriptions(symbols: string[]): Promise<void> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    if (normalizedSymbols.length === 0) {
      return;
    }

    const missingSymbols = normalizedSymbols.filter((symbol) => (
      !Array.from(this.quoteSubscriptionsByConid.values()).some(
        (entry) => entry.symbol === symbol,
      )
    ));

    if (missingSymbols.length > 0) {
      const resolvedContracts = await this.client.resolveStockContracts(missingSymbols);
      resolvedContracts.forEach((contract) => {
        this.quoteSubscriptionsByConid.set(contract.providerContractId, contract);
      });
    }

    await this.ensureConnected();
    this.ensureSmdRenewalLoop();

    if (missingSymbols.length === 0) {
      return;
    }

    await this.resubscribeAll();
  }

  private collectQuotesBySymbol(): Map<string, QuoteSnapshot> {
    const now = Date.now();
    const quotesBySymbol = new Map<string, QuoteSnapshot>();
    this.quotesByConid.forEach((quote) => {
      quotesBySymbol.set(quote.symbol, {
        ...quote,
        ...this.getQuoteFreshness(quote, now),
      });
    });
    return quotesBySymbol;
  }

  private seedMissingQuotesFromRest(symbols: string[]) {
    const quotesBySymbol = this.collectQuotesBySymbol();
    const missingSymbols = symbols.filter((symbol) => (
      !quotesBySymbol.has(symbol) && !this.quoteRestSeedInFlightSymbols.has(symbol)
    ));

    if (missingSymbols.length === 0) {
      return;
    }

    missingSymbols.forEach((symbol) => this.quoteRestSeedInFlightSymbols.add(symbol));

    void this.client.getQuoteSnapshots(missingSymbols)
      .then((quotes) => {
        quotes.forEach((quote) => {
          if (quote.providerContractId) {
            this.quotesByConid.set(quote.providerContractId, quote);
          }
          this.emitQuote(quote);
        });
      })
      .catch((error) => {
        logger.warn({ err: error, symbols: missingSymbols }, "IBKR REST quote seed failed");
      })
      .finally(() => {
        missingSymbols.forEach((symbol) =>
          this.quoteRestSeedInFlightSymbols.delete(symbol),
        );
      });
  }

  async getQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    if (normalizedSymbols.length === 0) {
      return [];
    }

    void this.ensureSymbolSubscriptions(normalizedSymbols)
      .then(() => this.seedMissingQuotesFromRest(normalizedSymbols))
      .catch((error) => {
        logger.warn({ err: error }, "IBKR websocket subscription bootstrap failed");
        this.seedMissingQuotesFromRest(normalizedSymbols);
      });

    const quotesBySymbol = this.collectQuotesBySymbol();
    return normalizedSymbols.flatMap((symbol) => {
      const quote = quotesBySymbol.get(symbol);
      return quote ? [quote] : [];
    });
  }

  // Pre-warm a set of symbols (typically the default watchlist) so the
  // first user-facing snapshot request finds populated cache entries.
  async prewarmSymbols(symbols: string[]): Promise<void> {
    const normalized = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );
    this.prewarmSymbolsSet.clear();
    normalized.forEach((symbol) => this.prewarmSymbolsSet.add(symbol));

    try {
      const desiredSymbols = this.getDesiredQuoteSymbols();
      if (desiredSymbols.length > 0) {
        await this.ensureSymbolSubscriptions(desiredSymbols);
      }
      this.trimUnusedQuoteSubscriptions();
      logger.info(
        {
          symbols: normalized,
          desiredSymbols,
          cached: this.quotesByConid.size,
        },
        "IBKR market-data prewarm synced",
      );
    } catch (error) {
      logger.warn({ err: error }, "IBKR market-data prewarm failed");
    }
  }

  async getPriceLadder(input: {
    accountId?: string | null;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null> {
    const symbol = normalizeSymbol(input.symbol);
    if (!symbol) {
      return null;
    }

    const accountId = await this.client.resolveActiveAccountId(input.accountId);
    if (!accountId) {
      return null;
    }

    let providerContractId = asString(input.providerContractId);
    if (!providerContractId) {
      if (input.assetClass === "option") {
        return null;
      }

      const [resolvedContract] = await this.client.resolveStockContracts([symbol]);
      providerContractId = resolvedContract?.providerContractId ?? null;
    }

    if (!providerContractId) {
      return null;
    }

    const exchange = input.exchange?.trim() || "SMART";
    const key = buildDepthKey(accountId, providerContractId, exchange);

    if (!this.depthSubscriptionsByKey.has(key)) {
      this.depthSubscriptionsByKey.set(key, {
        accountId,
        symbol,
        assetClass: input.assetClass === "option" ? "option" : "equity",
        providerContractId,
        exchange,
      });
    }

    await this.ensureConnected();

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(`sbd+${accountId}+${providerContractId}+${exchange}`);
    }

    const snapshot = this.depthByKey.get(key);
    if (!snapshot) {
      return null;
    }

    const cacheAgeMs = Math.max(0, Date.now() - snapshot.updatedAt.getTime());
    return {
      ...snapshot,
      freshness: cacheAgeMs <= 5_000 ? "live" : "stale",
      cacheAgeMs,
    };
  }

  async subscribeQuotes(
    symbols: string[],
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    if (normalizedSymbols.length === 0) {
      return () => {};
    }

    const listenerId = this.nextQuoteListenerId;
    this.nextQuoteListenerId += 1;
    const listener: QuoteStreamListener = {
      id: listenerId,
      symbols: new Set(normalizedSymbols),
      onQuote,
    };
    this.quoteListeners.set(listenerId, listener);

    const cachedQuotes = this.collectQuotesBySymbol();
    normalizedSymbols.forEach((symbol) => {
      const quote = cachedQuotes.get(symbol);
      if (quote) {
        onQuote(this.decorateQuoteForEmit(quote));
      }
    });

    void this.ensureSymbolSubscriptions(normalizedSymbols)
      .then(() => this.seedMissingQuotesFromRest(normalizedSymbols))
      .catch((error) => {
        logger.warn({ err: error }, "IBKR websocket subscription bootstrap failed");
        this.seedMissingQuotesFromRest(normalizedSymbols);
      });

    return () => {
      this.quoteListeners.delete(listenerId);
      this.trimUnusedQuoteSubscriptions();
    };
  }
}
