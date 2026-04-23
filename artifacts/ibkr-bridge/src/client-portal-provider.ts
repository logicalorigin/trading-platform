import type {
  IbkrMarketDataMode,
  IbkrRuntimeConfig,
  RuntimeMode,
} from "../../api-server/src/lib/runtime";
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
      this.lastError = null;
      return session;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
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
    const session = await this.refreshSession().catch(() => this.latestSession);

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
    await this.refreshSession();
    return this.client.listAccounts(mode);
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    await this.refreshSession();
    return this.client.listPositions(input);
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
    await this.refreshSession();
    return this.client.listOrders(input);
  }

  async listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]> {
    await this.refreshSession();
    return this.client.listExecutions(input);
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    await this.refreshSession();
    const quotes = await this.marketDataStream.getQuotes(symbols);
    this.observeDelayedFlags(quotes.map((quote) => quote.delayed));
    return quotes;
  }

  async prewarmQuoteSubscriptions(symbols: string[]): Promise<void> {
    await this.refreshSession();
    await this.marketDataStream.prewarmSymbols(symbols);
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
    await this.refreshSession();
    const bars = await this.client.getHistoricalBars(input);
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
    await this.refreshSession();
    return this.client.getOptionChain(input);
  }

  async getMarketDepth(input: {
    accountId?: string | null;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null> {
    await this.refreshSession();
    return this.marketDataStream.getPriceLadder(input);
  }

  async previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    await this.refreshSession();
    return this.client.previewOrder(input);
  }

  async placeOrder(
    input: PlaceOrderInput,
  ): Promise<import("../../api-server/src/providers/ibkr/client").BrokerOrderSnapshot> {
    await this.refreshSession();
    return this.client.placeOrder(input);
  }

  async submitRawOrders(input: {
    accountId?: string | null;
    mode?: RuntimeMode | null;
    confirm?: boolean | null;
    orders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    await this.refreshSession();
    return this.client.submitRawOrders(input);
  }

  async replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
    confirm?: boolean | null;
  }): Promise<ReplaceOrderSnapshot> {
    await this.refreshSession();
    return this.client.replaceOrder(input);
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
    confirm?: boolean | null;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    await this.refreshSession();
    return this.client.cancelOrder(input);
  }

  async getNews(input: {
    ticker?: string;
    limit?: number;
  }): Promise<IbkrNewsArticle[]> {
    await this.refreshSession();
    return this.client.getNews(input);
  }

  async searchTickers(input: {
    search?: string;
    limit?: number;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    await this.refreshSession();
    return this.client.searchTickers(input);
  }
}
