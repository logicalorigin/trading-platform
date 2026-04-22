import type {
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
  private tickleTimer: NodeJS.Timeout | null = null;
  private latestSession: SessionStatusSnapshot | null = null;
  private lastTickleAt: Date | null = null;
  private lastError: string | null = null;

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

  async refreshSession(): Promise<SessionStatusSnapshot | null> {
    try {
      const session = await this.client.ensureBrokerageSession();
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
      updatedAt: new Date(),
      transport: "client_portal",
      connectionTarget: this.config.baseUrl,
      sessionMode: null,
      clientId: null,
      marketDataMode: "unknown",
      liveMarketDataAvailable: null,
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
    return this.marketDataStream.getQuotes(symbols);
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
    return this.client.getHistoricalBars(input);
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
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
  }): Promise<ReplaceOrderSnapshot> {
    await this.refreshSession();
    return this.client.replaceOrder(input);
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
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
