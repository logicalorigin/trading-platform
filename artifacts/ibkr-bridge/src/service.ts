import {
  getIbkrBridgeProviderRuntimeConfig,
  type RuntimeMode,
} from "../../api-server/src/lib/runtime";
import type {
  BrokerBarSnapshot,
  BrokerExecutionSnapshot,
  BrokerMarketDepthSnapshot,
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
} from "../../api-server/src/providers/ibkr/client";
import { ClientPortalIbkrBridgeProvider } from "./client-portal-provider";
import type { BridgeHealth, IbkrBridgeProvider } from "./provider";
import { TwsIbkrBridgeProvider } from "./tws-provider";

export class IbkrBridgeService {
  private readonly runtime = getIbkrBridgeProviderRuntimeConfig();
  private readonly provider: IbkrBridgeProvider | null = this.runtime
    ? this.runtime.transport === "tws"
      ? new TwsIbkrBridgeProvider(this.runtime.config)
      : new ClientPortalIbkrBridgeProvider(this.runtime.config)
    : null;

  private ensureProvider(): IbkrBridgeProvider {
    if (!this.provider) {
      throw new Error("IBKR bridge is not configured.");
    }

    return this.provider;
  }

  async refreshSession(): Promise<SessionStatusSnapshot | null> {
    if (!this.provider) {
      return null;
    }

    return this.provider.refreshSession();
  }

  async tickle(): Promise<void> {
    if (!this.provider) {
      return;
    }

    await this.provider.tickle();
  }

  async getHealth(): Promise<BridgeHealth> {
    if (!this.provider) {
      return {
        configured: false,
        authenticated: false,
        connected: false,
        competing: false,
        selectedAccountId: null,
        accounts: [],
        lastTickleAt: null,
        lastError: null,
        lastRecoveryAttemptAt: null,
        lastRecoveryError: null,
        updatedAt: new Date(),
        transport: "client_portal",
        connectionTarget: null,
        sessionMode: null,
        clientId: null,
        marketDataMode: null,
        liveMarketDataAvailable: null,
      };
    }

    return this.provider.getHealth();
  }

  listAccounts(mode: RuntimeMode) {
    return this.ensureProvider().listAccounts(mode);
  }

  listPositions(input: { accountId?: string; mode: RuntimeMode }) {
    return this.ensureProvider().listPositions(input);
  }

  listOrders(input: {
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
  }) {
    return this.ensureProvider().listOrders(input);
  }

  listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]> {
    return this.ensureProvider().listExecutions(input);
  }

  getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    return this.ensureProvider().getQuoteSnapshots(symbols);
  }

  getHistoricalBars(input: {
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
    return this.ensureProvider().getHistoricalBars(input);
  }

  getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    return this.ensureProvider().getOptionChain(input);
  }

  getMarketDepth(input: {
    accountId?: string | null;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null> {
    return this.ensureProvider().getMarketDepth(input);
  }

  previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    return this.ensureProvider().previewOrder(input);
  }

  placeOrder(
    input: PlaceOrderInput,
  ): Promise<import("../../api-server/src/providers/ibkr/client").BrokerOrderSnapshot> {
    return this.ensureProvider().placeOrder(input);
  }

  submitRawOrders(input: {
    accountId?: string | null;
    mode?: RuntimeMode | null;
    confirm?: boolean | null;
    orders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    return this.ensureProvider().submitRawOrders(input);
  }

  replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
    confirm?: boolean | null;
  }): Promise<ReplaceOrderSnapshot> {
    return this.ensureProvider().replaceOrder(input);
  }

  cancelOrder(input: {
    accountId: string;
    orderId: string;
    confirm?: boolean | null;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    return this.ensureProvider().cancelOrder(input);
  }

  getNews(input: { ticker?: string; limit?: number }): Promise<IbkrNewsArticle[]> {
    return this.ensureProvider().getNews(input);
  }

  searchTickers(input: {
    search?: string;
    limit?: number;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    return this.ensureProvider().searchTickers(input);
  }

  async prewarmQuoteSubscriptions(symbols: string[]): Promise<void> {
    if (!this.provider?.prewarmQuoteSubscriptions) return;
    await this.provider.prewarmQuoteSubscriptions(symbols);
  }
}

export const ibkrBridgeService = new IbkrBridgeService();
