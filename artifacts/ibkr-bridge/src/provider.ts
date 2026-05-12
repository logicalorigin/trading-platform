import type {
  BrokerAccountSnapshot,
  BrokerBarSnapshot,
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
  RuntimeMode,
  SessionStatusSnapshot,
  IbkrTransport,
  IbkrMarketDataMode,
} from "@workspace/ibkr-contracts";

export type BridgeHealth = {
  bridgeRuntimeBuild: string | null;
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
  transport: Extract<IbkrTransport, "tws">;
  connectionTarget: string | null;
  sessionMode: RuntimeMode | null;
  clientId: number | null;
  marketDataMode: IbkrMarketDataMode | null;
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
};

export type BridgeConnectionHealth = {
  transport: Extract<IbkrTransport, "tws">;
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
  marketDataMode: IbkrMarketDataMode | null;
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

export type BridgeConnectionsHealth = {
  tws: BridgeConnectionHealth;
};

export type BridgeHealthResponse = BridgeHealth & {
  connections: BridgeConnectionsHealth;
};

export type BridgeOrdersResult = {
  orders: BrokerOrderSnapshot[];
  degraded?: boolean;
  reason?: "open_orders_timeout" | "open_orders_error";
  stale?: boolean;
  detail?: string;
  timeoutMs?: number;
};

export type BridgeLaneDiagnostics = {
  scheduler: unknown;
  schedulerConfig: unknown;
  limits: unknown;
  subscriptions: unknown;
  pressure: string;
  updatedAt: Date;
};

export type BridgeLaneSettingsInput = {
  scheduler?: Record<string, Record<string, number | null | undefined>>;
  limits?: Record<string, number | null | undefined>;
};

export interface IbkrBridgeProvider {
  shutdown?(): Promise<void> | void;
  refreshSession(): Promise<SessionStatusSnapshot | null>;
  tickle(): Promise<void>;
  getHealth(): Promise<BridgeHealth>;
  getLaneDiagnostics?(): BridgeLaneDiagnostics | Promise<BridgeLaneDiagnostics>;
  applyLaneSettings?(
    input: BridgeLaneSettingsInput,
  ): BridgeLaneDiagnostics | Promise<BridgeLaneDiagnostics>;
  listAccounts(mode: RuntimeMode): Promise<BrokerAccountSnapshot[]>;
  listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]>;
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
  }): Promise<BridgeOrdersResult>;
  listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]>;
  getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]>;
  getOptionActivitySnapshots?(symbols: string[]): Promise<QuoteSnapshot[]>;
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
  }): Promise<BrokerBarSnapshot[]>;
  getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    strikeCoverage?: "fast" | "standard" | "full";
    quoteHydration?: "metadata" | "snapshot";
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]>;
  getOptionExpirations(input: {
    underlying: string;
    maxExpirations?: number;
    signal?: AbortSignal;
  }): Promise<Date[]>;
  getMarketDepth(input: {
    accountId?: string | null;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null>;
  previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot>;
  placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot>;
  submitRawOrders(input: {
    accountId?: string | null;
    mode?: RuntimeMode | null;
    confirm?: boolean | null;
    orders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>>;
  replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
    confirm?: boolean | null;
  }): Promise<ReplaceOrderSnapshot>;
  cancelOrder(input: {
    accountId: string;
    orderId: string;
    confirm?: boolean | null;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot>;
  getNews(input: {
    ticker?: string;
    limit?: number;
  }): Promise<IbkrNewsArticle[]>;
  searchTickers(input: {
    search?: string;
    market?: IbkrUniverseTicker["market"];
    markets?: IbkrUniverseTicker["market"][];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }>;
  prewarmQuoteSubscriptions?(symbols: string[]): Promise<void>;
  subscribeQuoteStream?(
    symbols: string[],
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void>;
  getOptionQuoteSnapshots?(input: {
    underlying?: string | null;
    providerContractIds: string[];
  }): Promise<QuoteSnapshot[]>;
  subscribeOptionQuoteStream?(
    input: {
      underlying?: string | null;
      providerContractIds: string[];
    },
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void>;
  subscribeHistoricalBarStream?(
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
  ): Promise<() => void>;
}
