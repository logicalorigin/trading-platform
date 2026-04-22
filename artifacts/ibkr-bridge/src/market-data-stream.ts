import WebSocket from "ws";
import {
  type BrokerMarketDepthLevel,
  type BrokerMarketDepthSnapshot,
  IbkrClient,
  parseSnapshotQuote,
  type QuoteSnapshot,
  type ResolvedIbkrContract,
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
  private readonly quoteSubscriptionsByConid = new Map<
    string,
    QuoteSubscriptionEntry
  >();
  private readonly quotesByConid = new Map<string, QuoteSnapshot>();
  private readonly rawPayloadsByConid = new Map<
    string,
    Record<string, unknown>
  >();
  private readonly depthSubscriptionsByKey = new Map<
    string,
    DepthSubscriptionEntry
  >();
  private readonly depthByKey = new Map<string, BrokerMarketDepthSnapshot>();

  constructor(
    private readonly client: IbkrClient,
    private readonly allowInsecureTls: boolean,
  ) {}

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
      this.quotesByConid.set(conid, parseSnapshotQuote(symbol, conid, merged));
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

      this.depthByKey.set(key, {
        accountId,
        symbol: subscription.symbol,
        assetClass: subscription.assetClass,
        providerContractId,
        exchange,
        updatedAt: new Date(),
        levels,
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

  private async resubscribeAll() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const subscription of this.quoteSubscriptionsByConid.values()) {
      this.socket.send(
        `smd+${subscription.conid}+${JSON.stringify({
          fields: [
            "31",
            "55",
            "70",
            "71",
            "82",
            "83",
            "84",
            "85",
            "86",
            "87",
            "88",
            "7059",
            "7295",
            "7296",
            "7741",
            "7762",
            "7638",
          ],
        })}`,
      );
    }

    for (const subscription of this.depthSubscriptionsByKey.values()) {
      this.socket.send(
        `sbd+${subscription.accountId}+${subscription.providerContractId}+${subscription.exchange}`,
      );
    }
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

    if (missingSymbols.length === 0) {
      return;
    }

    await this.resubscribeAll();
  }

  private collectQuotesBySymbol(): Map<string, QuoteSnapshot> {
    const quotesBySymbol = new Map<string, QuoteSnapshot>();
    this.quotesByConid.forEach((quote) => {
      quotesBySymbol.set(quote.symbol, quote);
    });
    return quotesBySymbol;
  }

  // After subscribing fresh symbols, the WebSocket needs a brief moment
  // to deliver the first tick. Polling the cache here is dramatically
  // cheaper than falling through to the REST snapshot endpoint, which
  // typically takes 1-3s per batch on a cold session.
  private async waitForFirstTicks(
    symbols: string[],
    timeoutMs: number,
  ): Promise<void> {
    if (symbols.length === 0) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const cached = this.collectQuotesBySymbol();
      const stillMissing = symbols.filter((symbol) => !cached.has(symbol));
      if (stillMissing.length === 0) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
    }
  }

  async getQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    if (normalizedSymbols.length === 0) {
      return [];
    }

    const initiallyMissing = normalizedSymbols.filter((symbol) => (
      !Array.from(this.quoteSubscriptionsByConid.values()).some(
        (entry) => entry.symbol === symbol,
      )
    ));

    try {
      await this.ensureSymbolSubscriptions(normalizedSymbols);
    } catch (error) {
      logger.warn({ err: error }, "IBKR websocket subscription bootstrap failed");
    }

    if (initiallyMissing.length > 0) {
      await this.waitForFirstTicks(initiallyMissing, 800);
    }

    const quotesBySymbol = this.collectQuotesBySymbol();
    const missingSymbols = normalizedSymbols.filter(
      (symbol) => !quotesBySymbol.has(symbol),
    );
    if (missingSymbols.length > 0) {
      const fallbackQuotes = await this.client.getQuoteSnapshots(missingSymbols);
      fallbackQuotes.forEach((quote) => {
        if (quote.providerContractId) {
          this.quotesByConid.set(quote.providerContractId, quote);
        }
        quotesBySymbol.set(quote.symbol, quote);
      });
    }

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
    if (normalized.length === 0) return;
    try {
      await this.ensureSymbolSubscriptions(normalized);
      await this.waitForFirstTicks(normalized, 1_500);
      logger.info(
        { symbols: normalized, cached: this.quotesByConid.size },
        "IBKR market-data prewarm complete",
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

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const snapshot = this.depthByKey.get(key);
      if (snapshot?.levels.length) {
        return snapshot;
      }

      await new Promise((resolve) => setTimeout(resolve, 75));
    }

    return this.depthByKey.get(key) ?? null;
  }
}
