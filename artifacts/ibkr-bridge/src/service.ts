import { performance } from "node:perf_hooks";
import {
  getIbkrBridgeProviderRuntimeConfig,
  getIbkrTwsRuntimeConfig,
} from "@workspace/ibkr-contracts";
import type {
  BrokerBarSnapshot,
  BrokerExecutionSnapshot,
  BrokerMarketDepthSnapshot,
  BrokerOrderSnapshot,
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
  RuntimeMode,
  SessionStatusSnapshot,
} from "@workspace/ibkr-contracts";
import type {
  BridgeConnectionHealth,
  BridgeConnectionsHealth,
  BridgeHealth,
  BridgeHealthResponse,
  BridgeLaneSettingsInput,
  IbkrBridgeProvider,
} from "./provider";
import { TwsIbkrBridgeProvider } from "./tws-provider";

export class IbkrBridgeService {
  private readonly runtime = getIbkrBridgeProviderRuntimeConfig();
  private readonly twsConfig = getIbkrTwsRuntimeConfig();
  private readonly twsProvider = this.twsConfig
    ? new TwsIbkrBridgeProvider(this.twsConfig)
    : null;
  private readonly provider: IbkrBridgeProvider | null = this.runtime
    ? this.runtime.transport === "tws"
      ? this.twsProvider
      : null
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

  async shutdown(): Promise<void> {
    await this.provider?.shutdown?.();
  }

  private buildUnconfiguredHealth(): BridgeHealth {
    return {
      bridgeRuntimeBuild:
        process.env["IBKR_BRIDGE_RUNTIME_BUILD"]?.trim() || null,
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
      transport: "tws",
      connectionTarget: null,
      sessionMode: null,
      clientId: null,
      marketDataMode: null,
      liveMarketDataAvailable: null,
      healthFresh: false,
      healthAgeMs: null,
      stale: true,
      bridgeReachable: false,
      socketConnected: false,
      brokerServerConnected: false,
      serverConnectivity: "unknown",
      lastServerConnectivityAt: null,
      lastServerConnectivityError: null,
      accountsLoaded: false,
      configuredLiveMarketDataMode: false,
      streamFresh: false,
      lastStreamEventAgeMs: null,
      strictReady: false,
      strictReason: "bridge_not_configured",
    };
  }

  private buildUnconfiguredConnection(
    transport: BridgeConnectionHealth["transport"],
    role: BridgeConnectionHealth["role"],
    target: string | null,
    mode: RuntimeMode | null,
    clientId: number | null,
  ): BridgeConnectionHealth {
    return {
      transport,
      role,
      configured: false,
      reachable: false,
      authenticated: false,
      competing: false,
      target,
      mode,
      clientId,
      selectedAccountId: null,
      accounts: [],
      lastPingMs: null,
      lastPingAt: null,
      lastTickleAt: null,
      lastError: null,
      marketDataMode: null,
      liveMarketDataAvailable: null,
      healthFresh: false,
      healthAgeMs: null,
      stale: true,
      bridgeReachable: false,
      socketConnected: false,
      brokerServerConnected: false,
      serverConnectivity: "unknown",
      lastServerConnectivityAt: null,
      lastServerConnectivityError: null,
      accountsLoaded: false,
      configuredLiveMarketDataMode: false,
      streamFresh: false,
      lastStreamEventAgeMs: null,
      strictReady: false,
      strictReason: "bridge_not_configured",
    };
  }

  private mapConnectionHealth(
    health: BridgeHealth,
    role: BridgeConnectionHealth["role"],
    lastPingMs: number,
    lastPingAt: Date,
  ): BridgeConnectionHealth {
    return {
      transport: "tws",
      role,
      configured: health.configured,
      reachable: health.connected,
      authenticated: health.authenticated,
      competing: health.competing,
      target: health.connectionTarget,
      mode: health.sessionMode,
      clientId: health.clientId,
      selectedAccountId: health.selectedAccountId,
      accounts: health.accounts,
      lastPingMs,
      lastPingAt,
      lastTickleAt: health.lastTickleAt,
      lastError: health.lastError,
      marketDataMode: health.marketDataMode,
      liveMarketDataAvailable: health.liveMarketDataAvailable,
      healthFresh: health.healthFresh,
      healthAgeMs: health.healthAgeMs,
      stale: health.stale,
      bridgeReachable: health.bridgeReachable,
      socketConnected: health.socketConnected,
      brokerServerConnected: health.brokerServerConnected,
      serverConnectivity: health.serverConnectivity,
      lastServerConnectivityAt: health.lastServerConnectivityAt,
      lastServerConnectivityError: health.lastServerConnectivityError,
      accountsLoaded: health.accountsLoaded,
      configuredLiveMarketDataMode: health.configuredLiveMarketDataMode,
      streamFresh: health.streamFresh,
      lastStreamEventAgeMs: health.lastStreamEventAgeMs,
      strictReady: health.strictReady,
      strictReason: health.strictReason,
    };
  }

  private async probeConnection(
    provider: IbkrBridgeProvider | null,
    fallback: BridgeConnectionHealth,
  ): Promise<{
    health: BridgeHealth | null;
    connection: BridgeConnectionHealth;
  }> {
    if (!provider) {
      return { health: null, connection: fallback };
    }

    const startedAt = performance.now();
    const lastPingAt = new Date();

    try {
      const health = await provider.getHealth();
      const lastPingMs = Math.max(0, Math.round(performance.now() - startedAt));

      return {
        health,
        connection: this.mapConnectionHealth(
          health,
          fallback.role,
          lastPingMs,
          lastPingAt,
        ),
      };
    } catch (error) {
      const lastPingMs = Math.max(0, Math.round(performance.now() - startedAt));
      const lastError =
        error instanceof Error && error.message
          ? error.message
          : "Unknown IBKR connection health error.";

      return {
        health: null,
        connection: {
          ...fallback,
          configured: true,
          lastPingMs,
          lastPingAt,
          lastError,
          healthFresh: false,
          healthAgeMs: null,
          stale: true,
          bridgeReachable: false,
          socketConnected: false,
          brokerServerConnected: false,
          serverConnectivity: "unknown",
          lastServerConnectivityAt: null,
          lastServerConnectivityError: lastError,
          accountsLoaded: false,
          configuredLiveMarketDataMode: false,
          streamFresh: false,
          lastStreamEventAgeMs: null,
          strictReady: false,
          strictReason: "health_error",
        },
      };
    }
  }

  async getHealth(): Promise<BridgeHealthResponse> {
    const twsFallback = this.buildUnconfiguredConnection(
      "tws",
      "market_data",
      this.twsConfig ? `${this.twsConfig.host}:${this.twsConfig.port}` : null,
      this.twsConfig?.mode ?? null,
      this.twsConfig?.clientId ?? null,
    );

    const twsProbe = await this.probeConnection(this.twsProvider, {
      ...twsFallback,
      configured: Boolean(this.twsProvider),
    });

    const connections: BridgeConnectionsHealth = {
      tws: twsProbe.connection,
    };
    const activeHealth =
      this.runtime?.transport === "tws" ? twsProbe.health : null;

    return {
      ...(activeHealth ?? this.buildUnconfiguredHealth()),
      connections,
    };
  }

  async getLaneDiagnostics() {
    const provider = this.ensureProvider();
    if (!provider.getLaneDiagnostics) {
      throw new Error("IBKR bridge lane diagnostics are not supported.");
    }

    return provider.getLaneDiagnostics();
  }

  async updateLaneSettings(input: BridgeLaneSettingsInput) {
    const provider = this.ensureProvider();
    if (!provider.applyLaneSettings) {
      throw new Error("IBKR bridge lane settings are not supported.");
    }

    return provider.applyLaneSettings(input);
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

  getOptionActivitySnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const provider = this.ensureProvider();
    if (!provider.getOptionActivitySnapshots) {
      return Promise.resolve([]);
    }
    return provider.getOptionActivitySnapshots(symbols);
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
    exchange?: string | null;
  }): Promise<BrokerBarSnapshot[]> {
    return this.ensureProvider().getHistoricalBars(input);
  }

  getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    strikeCoverage?: "fast" | "standard" | "full";
    quoteHydration?: "metadata" | "snapshot";
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    return this.ensureProvider().getOptionChain(input);
  }

  getOptionExpirations(input: {
    underlying: string;
    maxExpirations?: number;
    signal?: AbortSignal;
  }): Promise<Date[]> {
    return this.ensureProvider().getOptionExpirations(input);
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

  placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot> {
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

  getNews(input: {
    ticker?: string;
    limit?: number;
  }): Promise<IbkrNewsArticle[]> {
    return this.ensureProvider().getNews(input);
  }

  searchTickers(input: {
    search?: string;
    market?: IbkrUniverseTicker["market"];
    markets?: IbkrUniverseTicker["market"][];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    return this.ensureProvider().searchTickers(input);
  }

  async prewarmQuoteSubscriptions(symbols: string[]): Promise<void> {
    if (!this.provider?.prewarmQuoteSubscriptions) return;
    await this.provider.prewarmQuoteSubscriptions(symbols);
  }

  async subscribeQuoteStream(
    symbols: string[],
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void> {
    if (!this.provider?.subscribeQuoteStream) {
      throw new Error(
        "IBKR quote streaming is not supported by this transport.",
      );
    }

    return this.provider.subscribeQuoteStream(symbols, onQuote);
  }

  async getOptionQuoteSnapshots(input: {
    underlying?: string | null;
    providerContractIds: string[];
  }): Promise<QuoteSnapshot[]> {
    if (!this.provider?.getOptionQuoteSnapshots) {
      return [];
    }

    return this.provider.getOptionQuoteSnapshots(input);
  }

  async subscribeOptionQuoteStream(
    input: {
      underlying?: string | null;
      providerContractIds: string[];
    },
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void> {
    if (!this.provider?.subscribeOptionQuoteStream) {
      return () => {};
    }

    return this.provider.subscribeOptionQuoteStream(input, onQuote);
  }

  async subscribeHistoricalBarStream(
    input: {
      symbol: string;
      timeframe: HistoryBarTimeframe;
      assetClass?: "equity" | "option";
      providerContractId?: string | null;
      outsideRth?: boolean;
      source?: HistoryDataSource;
      exchange?: string | null;
    },
    onBar: (bar: BrokerBarSnapshot) => void,
    onError?: (error: unknown) => void,
  ): Promise<() => void> {
    if (!this.provider?.subscribeHistoricalBarStream) {
      return () => {};
    }

    return this.provider.subscribeHistoricalBarStream(input, onBar, onError);
  }
}

export const ibkrBridgeService = new IbkrBridgeService();
