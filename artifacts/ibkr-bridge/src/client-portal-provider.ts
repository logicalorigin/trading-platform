import type {
  IbkrMarketDataMode,
  IbkrRuntimeConfig,
  RuntimeMode,
} from "../../api-server/src/lib/runtime";
import { isHttpError } from "../../api-server/src/lib/errors";
import {
  IbkrClient,
  type BrokerBarSnapshot,
  type BrokerExecutionSnapshot,
  type BrokerMarketDepthSnapshot,
  type BrokerOrderSnapshot,
  type BrokerPositionSnapshot,
  type CancelOrderSnapshot,
  type HistoryBarTimeframe,
  type HistoryDataSource,
  type IbkrNewsArticle,
  type IbkrUniverseTicker,
  type OptionChainContract,
  type OrderPreviewSnapshot,
  type PlaceOrderInput,
  type QuoteSnapshot,
  type ReplaceOrderSnapshot,
  type SessionStatusSnapshot,
} from "../../api-server/src/providers/ibkr/client";
import { IbkrMarketDataStream } from "./market-data-stream";
import type { BridgeHealth, IbkrBridgeProvider } from "./provider";

export class ClientPortalIbkrBridgeProvider implements IbkrBridgeProvider {
  private readonly client: IbkrClient;
  private readonly marketDataStream: IbkrMarketDataStream;
  private readonly sessionRefreshTtlMs = 10 * 60_000;
  private readonly optionChainCacheTtlMs = 30_000;
  private readonly optionQuotePollIntervalMs = Math.max(
    1_000,
    Number(process.env["IBKR_BRIDGE_OPTION_QUOTE_POLL_INTERVAL_MS"] ?? "3000"),
  );
  private readonly historicalBarPollIntervalMs = Math.max(
    1_000,
    Number(process.env["IBKR_BRIDGE_HISTORICAL_BAR_POLL_INTERVAL_MS"] ?? "5000"),
  );
  private readonly tickleIntervalMs = Number(
    process.env["IBKR_BRIDGE_TICKLE_INTERVAL_MS"] ?? "55000",
  );
  private readonly recoveryCooldownMs = Math.max(
    5_000,
    Number(process.env["IBKR_BRIDGE_RECOVERY_COOLDOWN_MS"] ?? "30000"),
  );
  private tickleTimer: NodeJS.Timeout | null = null;
  private latestSession: SessionStatusSnapshot | null = null;
  private lastTickleAt: Date | null = null;
  private lastError: string | null = null;
  private lastRecoveryAttemptAt: Date | null = null;
  private lastRecoveryError: string | null = null;
  private observedMarketDataMode: IbkrMarketDataMode | null = "unknown";
  private observedLiveMarketDataAvailable: boolean | null = null;
  private lastSessionRefreshAt: Date | null = null;
  private sessionRefreshPromise: Promise<SessionStatusSnapshot | null> | null = null;
  private readonly optionChainCache = new Map<
    string,
    { value: OptionChainContract[]; expiresAt: number }
  >();
  private readonly optionChainInFlight = new Map<string, Promise<OptionChainContract[]>>();

  constructor(private readonly config: IbkrRuntimeConfig) {
    this.client = new IbkrClient(this.config);
    this.marketDataStream = new IbkrMarketDataStream(
      this.client,
      this.config.allowInsecureTls,
    );

    if (this.config.allowInsecureTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    this.ensureTickleLoop();
  }

  private ensureTickleLoop() {
    if (this.tickleTimer) {
      return;
    }

    this.tickleTimer = setInterval(() => {
      void this.tickle().catch(() => {});
    }, Math.max(10_000, this.tickleIntervalMs));
    this.tickleTimer.unref?.();
  }

  private recordError(error: unknown) {
    this.lastError =
      error instanceof Error && error.message
        ? error.message
        : "Unknown IBKR bridge error.";
  }

  private shouldAttemptRecovery(session: SessionStatusSnapshot | null): boolean {
    if (!session) {
      return false;
    }

    if (session.authenticated && session.connected) {
      return false;
    }

    if (
      this.lastRecoveryAttemptAt &&
      Date.now() - this.lastRecoveryAttemptAt.getTime() < this.recoveryCooldownMs
    ) {
      return false;
    }

    return true;
  }

  private async maybeRecoverSession(
    session: SessionStatusSnapshot | null,
  ): Promise<SessionStatusSnapshot | null> {
    if (!this.shouldAttemptRecovery(session)) {
      return session;
    }

    this.lastRecoveryAttemptAt = new Date();

    try {
      const recoveredSession = await this.client.recoverBrokerageSession();
      this.lastRecoveryError = null;
      return recoveredSession;
    } catch (error) {
      this.lastRecoveryError =
        error instanceof Error && error.message
          ? error.message
          : "Unknown brokerage recovery error.";
      throw error;
    }
  }

  private observeDelayedFlags(delayedFlags: boolean[]): void {
    if (delayedFlags.length === 0) {
      return;
    }

    const anyLive = delayedFlags.some((delayed) => !delayed);
    const allDelayed = delayedFlags.every(Boolean);

    if (anyLive) {
      this.observedMarketDataMode = "live";
      this.observedLiveMarketDataAvailable = true;
      return;
    }

    if (allDelayed) {
      this.observedMarketDataMode = "delayed";
      this.observedLiveMarketDataAvailable = false;
    }
  }

  async refreshSession(): Promise<SessionStatusSnapshot | null> {
    try {
      let session: SessionStatusSnapshot | null =
        await this.client.ensureBrokerageSession();
      session = await this.maybeRecoverSession(session);
      if (session?.authenticated && session?.connected) {
        session = await this.client.ensureBrokerageSession();
      }
      this.latestSession = session;
      this.lastSessionRefreshAt = new Date();
      this.lastError = null;
      return session;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  private async ensureFreshSession({
    force = false,
  }: { force?: boolean } = {}): Promise<SessionStatusSnapshot | null> {
    if (
      !force &&
      this.latestSession?.authenticated &&
      this.latestSession.connected &&
      this.lastSessionRefreshAt &&
      Date.now() - this.lastSessionRefreshAt.getTime() < this.sessionRefreshTtlMs
    ) {
      return this.latestSession;
    }

    if (!force && this.sessionRefreshPromise) {
      return this.sessionRefreshPromise;
    }

    this.sessionRefreshPromise = this.refreshSession();
    try {
      return await this.sessionRefreshPromise;
    } finally {
      this.sessionRefreshPromise = null;
    }
  }

  private async withFreshSession<T>(
    task: () => Promise<T>,
    { retryUnauthorized = true }: { retryUnauthorized?: boolean } = {},
  ): Promise<T> {
    await this.ensureFreshSession();

    try {
      return await task();
    } catch (error) {
      if (retryUnauthorized && isHttpError(error) && error.statusCode === 401) {
        await this.ensureFreshSession({ force: true });
        return task();
      }

      throw error;
    }
  }

  private buildOptionChainCacheKey(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
  }): string {
    return JSON.stringify({
      underlying: input.underlying.trim().toUpperCase(),
      expirationDate: input.expirationDate?.toISOString().slice(0, 10) ?? null,
      contractType: input.contractType ?? null,
      maxExpirations: input.maxExpirations ?? null,
      strikesAroundMoney: input.strikesAroundMoney ?? null,
    });
  }

  async tickle(): Promise<void> {
    try {
      await this.client.tickleSession();
      this.lastTickleAt = new Date();
      this.lastError = null;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async getHealth(): Promise<BridgeHealth> {
    const session = await this.ensureFreshSession().catch(() => this.latestSession);

    return {
      configured: true,
      authenticated: Boolean(session?.authenticated),
      connected: Boolean(session?.connected),
      competing: Boolean(session?.competing),
      selectedAccountId:
        session?.selectedAccountId ?? this.config.defaultAccountId ?? null,
      accounts: session?.accounts ?? [],
      lastTickleAt: this.lastTickleAt,
      lastError: this.lastError,
      lastRecoveryAttemptAt: this.lastRecoveryAttemptAt,
      lastRecoveryError: this.lastRecoveryError,
      updatedAt: new Date(),
      transport: "client_portal",
      connectionTarget: this.config.baseUrl,
      sessionMode: null,
      clientId: null,
      marketDataMode: this.observedMarketDataMode,
      liveMarketDataAvailable: this.observedLiveMarketDataAvailable,
    };
  }

  async listAccounts(mode: RuntimeMode) {
    return this.withFreshSession(() => this.client.listAccounts(mode));
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    return this.withFreshSession(() => this.client.listPositions(input));
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
    return this.withFreshSession(() => this.client.listOrders(input));
  }

  async listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]> {
    return this.withFreshSession(() => this.client.listExecutions(input));
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const quotes = await this.withFreshSession(() =>
      this.marketDataStream.getQuotes(symbols),
    );
    this.observeDelayedFlags(quotes.map((quote) => quote.delayed));
    return quotes;
  }

  async prewarmQuoteSubscriptions(symbols: string[]): Promise<void> {
    await this.withFreshSession(() => this.marketDataStream.prewarmSymbols(symbols));
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
  }): Promise<BrokerBarSnapshot[]> {
    const bars = await this.withFreshSession(() =>
      this.client.getHistoricalBars(input),
    );
    this.observeDelayedFlags(bars.map((bar) => bar.delayed));
    return bars;
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    const cacheKey = this.buildOptionChainCacheKey(input);
    const now = Date.now();
    const cached = this.optionChainCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    if (cached) {
      this.optionChainCache.delete(cacheKey);
    }

    const inFlight = this.optionChainInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.withFreshSession(() => this.client.getOptionChain(input))
      .then((value) => {
        if (!input.signal?.aborted) {
          this.optionChainCache.set(cacheKey, {
            value,
            expiresAt: Date.now() + this.optionChainCacheTtlMs,
          });
        }

        return value;
      })
      .finally(() => {
        this.optionChainInFlight.delete(cacheKey);
      });

    this.optionChainInFlight.set(cacheKey, promise);
    return promise;
  }

  async getOptionExpirations(input: {
    underlying: string;
    maxExpirations?: number;
    signal?: AbortSignal;
  }): Promise<Date[]> {
    return this.withFreshSession(() =>
      this.client.getOptionExpirations(input),
    );
  }

  async getMarketDepth(input: {
    accountId?: string | null;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null> {
    return this.withFreshSession(() => this.marketDataStream.getPriceLadder(input));
  }

  async previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    return this.withFreshSession(() => this.client.previewOrder(input), {
      retryUnauthorized: false,
    });
  }

  async placeOrder(
    input: PlaceOrderInput,
  ): Promise<import("../../api-server/src/providers/ibkr/client").BrokerOrderSnapshot> {
    return this.withFreshSession(() => this.client.placeOrder(input), {
      retryUnauthorized: false,
    });
  }

  async submitRawOrders(input: {
    accountId?: string | null;
    mode?: RuntimeMode | null;
    confirm?: boolean | null;
    orders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    return this.withFreshSession(() => this.client.submitRawOrders(input), {
      retryUnauthorized: false,
    });
  }

  async replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
    confirm?: boolean | null;
  }): Promise<ReplaceOrderSnapshot> {
    return this.withFreshSession(() => this.client.replaceOrder(input), {
      retryUnauthorized: false,
    });
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
    confirm?: boolean | null;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    return this.withFreshSession(() => this.client.cancelOrder(input), {
      retryUnauthorized: false,
    });
  }

  async getNews(input: {
    ticker?: string;
    limit?: number;
  }): Promise<IbkrNewsArticle[]> {
    return this.withFreshSession(() => this.client.getNews(input));
  }

  async searchTickers(input: {
    search?: string;
    market?: IbkrUniverseTicker["market"];
    markets?: IbkrUniverseTicker["market"][];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    return this.withFreshSession(() => this.client.searchTickers(input));
  }

  async subscribeQuoteStream(
    symbols: string[],
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void> {
    return this.withFreshSession(() =>
      this.marketDataStream.subscribeQuotes(symbols, onQuote),
    );
  }

  private toOptionQuoteSnapshot(contract: OptionChainContract): QuoteSnapshot {
    const bid = Number.isFinite(contract.bid) ? contract.bid : 0;
    const ask = Number.isFinite(contract.ask) ? contract.ask : bid;
    const price = Number.isFinite(contract.last)
      ? contract.last
      : bid > 0 && ask > 0
        ? (bid + ask) / 2
        : bid;

    return {
      symbol: contract.contract.ticker,
      price,
      bid,
      ask,
      bidSize: 0,
      askSize: 0,
      change: 0,
      changePercent: 0,
      open: null,
      high: null,
      low: null,
      prevClose: null,
      volume: contract.volume ?? null,
      openInterest: contract.openInterest ?? null,
      impliedVolatility: contract.impliedVolatility ?? null,
      delta: contract.delta ?? null,
      gamma: contract.gamma ?? null,
      theta: contract.theta ?? null,
      vega: contract.vega ?? null,
      updatedAt: contract.updatedAt,
      providerContractId: contract.contract.providerContractId ?? null,
      transport: "client_portal",
      delayed: this.observedLiveMarketDataAvailable === false,
    };
  }

  async getOptionQuoteSnapshots(input: {
    underlying?: string | null;
    providerContractIds: string[];
  }): Promise<QuoteSnapshot[]> {
    const underlying = input.underlying?.trim().toUpperCase() ?? "";
    const normalizedProviderContractIds = Array.from(
      new Set(
        input.providerContractIds
          .map((providerContractId) => providerContractId.trim())
          .filter(Boolean),
      ),
    );

    if (!underlying || normalizedProviderContractIds.length === 0) {
      return [];
    }

    const contracts = await this.getOptionChain({ underlying });
    const contractsByProviderContractId = new Map(
      contracts
        .filter((contract) => contract.contract.providerContractId)
        .map((contract) => [contract.contract.providerContractId ?? "", contract]),
    );

    return normalizedProviderContractIds.flatMap((providerContractId) => {
      const contract = contractsByProviderContractId.get(providerContractId);
      return contract ? [this.toOptionQuoteSnapshot(contract)] : [];
    });
  }

  async subscribeOptionQuoteStream(
    input: {
      underlying?: string | null;
      providerContractIds: string[];
    },
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void> {
    const normalizedProviderContractIds = Array.from(
      new Set(
        input.providerContractIds
          .map((providerContractId) => providerContractId.trim())
          .filter(Boolean),
      ),
    );

    if (!input.underlying?.trim() || normalizedProviderContractIds.length === 0) {
      return () => {};
    }

    let active = true;
    let inFlight = false;
    const lastSignatureByProviderContractId = new Map<string, string>();
    const emitQuotes = async () => {
      if (!active || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const quotes = await this.getOptionQuoteSnapshots({
          underlying: input.underlying,
          providerContractIds: normalizedProviderContractIds,
        });

        if (!active) {
          return;
        }

        quotes.forEach((quote) => {
          const providerContractId = quote.providerContractId?.trim();
          if (!providerContractId) {
            return;
          }

          const signature = JSON.stringify({
            price: quote.price,
            bid: quote.bid,
            ask: quote.ask,
            volume: quote.volume,
            openInterest: quote.openInterest,
            impliedVolatility: quote.impliedVolatility,
            delta: quote.delta,
            gamma: quote.gamma,
            theta: quote.theta,
            vega: quote.vega,
            updatedAt: quote.updatedAt.toISOString(),
          });

          if (lastSignatureByProviderContractId.get(providerContractId) === signature) {
            return;
          }

          lastSignatureByProviderContractId.set(providerContractId, signature);
          onQuote(quote);
        });
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => {
      void emitQuotes();
    }, this.optionQuotePollIntervalMs);
    timer.unref?.();
    void emitQuotes();

    return () => {
      active = false;
      clearInterval(timer);
    };
  }

  async subscribeHistoricalBarStream(
    input: {
      symbol: string;
      timeframe: HistoryBarTimeframe;
      assetClass?: "equity" | "option";
      providerContractId?: string | null;
      outsideRth?: boolean;
      source?: HistoryDataSource;
    },
    onBar: (bar: BrokerBarSnapshot) => void,
  ): Promise<() => void> {
    let active = true;
    let inFlight = false;
    let lastSignature = "";

    const emitBar = async () => {
      if (!active || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const bars = await this.getHistoricalBars({
          ...input,
          limit: Math.max(2, input.timeframe === "1d" ? 1 : 2),
        });

        if (!active) {
          return;
        }

        const latestBar = bars[bars.length - 1];
        if (!latestBar) {
          return;
        }

        const nextBar = {
          ...latestBar,
          partial: true,
        } satisfies BrokerBarSnapshot;
        const signature = JSON.stringify({
          timestamp: nextBar.timestamp.toISOString(),
          open: nextBar.open,
          high: nextBar.high,
          low: nextBar.low,
          close: nextBar.close,
          volume: nextBar.volume,
          source: nextBar.source,
        });

        if (signature === lastSignature) {
          return;
        }

        lastSignature = signature;
        onBar(nextBar);
      } catch (error) {
        this.recordError(error);
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => {
      void emitBar();
    }, this.historicalBarPollIntervalMs);
    timer.unref?.();
    void emitBar();

    return () => {
      active = false;
      clearInterval(timer);
    };
  }
}
