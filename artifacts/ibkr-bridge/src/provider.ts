import type {
  RuntimeMode,
  IbkrTransport,
  IbkrMarketDataMode,
} from "../../api-server/src/lib/runtime";
import type {
  BrokerAccountSnapshot,
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

export type BridgeHealth = {
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
  transport: IbkrTransport;
  connectionTarget: string | null;
  sessionMode: RuntimeMode | null;
  clientId: number | null;
  marketDataMode: IbkrMarketDataMode | null;
  liveMarketDataAvailable: boolean | null;
};

export interface IbkrBridgeProvider {
  refreshSession(): Promise<SessionStatusSnapshot | null>;
  tickle(): Promise<void>;
  getHealth(): Promise<BridgeHealth>;
  listAccounts(mode: RuntimeMode): Promise<BrokerAccountSnapshot[]>;
  listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<import("../../api-server/src/providers/ibkr/client").BrokerPositionSnapshot[]>;
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
  }): Promise<import("../../api-server/src/providers/ibkr/client").BrokerOrderSnapshot[]>;
  listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]>;
  getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]>;
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
  }): Promise<BrokerBarSnapshot[]>;
  getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]>;
  getMarketDepth(input: {
    accountId?: string | null;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null>;
  previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot>;
  placeOrder(input: PlaceOrderInput): Promise<import("../../api-server/src/providers/ibkr/client").BrokerOrderSnapshot>;
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
    },
    onBar: (bar: BrokerBarSnapshot) => void,
  ): Promise<() => void>;
}
