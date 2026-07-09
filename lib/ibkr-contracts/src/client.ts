import type {
  IbkrMarketDataMode,
  MarketDataTransport,
  RuntimeMode,
} from "./runtime";

export type AssetClass = "equity" | "option";
export type OptionRight = "call" | "put";
export type OrderSide = "buy" | "sell";
export type OptionOrderPositionEffect = "open" | "close";
export type OptionOrderStrategyIntent =
  | "long_option"
  | "sell_to_close"
  | "covered_call"
  | "uncovered_short_call";
export type OrderStatus =
  | "pending_submit"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired";
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
export type TimeInForce = "day" | "gtc" | "ioc" | "fok";
export type TradingSession =
  | "default"
  | "regular"
  | "extended"
  | "overnight"
  | "overnight_plus_day";
export type HistoryBarTimeframe = "5s" | "1m" | "5m" | "15m" | "1h" | "1d";
export type HistoryDataSource = "trades" | "midpoint" | "bid_ask";
export type UniverseMarket =
  | "stocks"
  | "etf"
  | "indices"
  | "futures"
  | "fx"
  | "crypto"
  | "otc";
export type MarketDataProvider = "ibkr" | "massive";
export type MarketDataFreshness =
  | "live"
  | "delayed"
  | "frozen"
  | "delayed_frozen"
  | "stale"
  | "metadata"
  | "unavailable"
  | "pending";
export type UniverseTickerContractMeta = Record<
  string,
  string | number | boolean | null
> | null;

export type OptionContractSnapshot = {
  ticker: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: OptionRight;
  multiplier: number;
  sharesPerContract: number;
  providerContractId?: string | null;
  brokerContractId?: string | null;
};

export type BrokerAccountSnapshot = {
  id: string;
  providerAccountId: string;
  provider: "ibkr" | "snaptrade" | "robinhood" | "schwab";
  mode: RuntimeMode;
  displayName: string;
  currency: string;
  buyingPower: number;
  cash: number;
  netLiquidation: number;
  dayPnl?: number | null;
  dayPnlPercent?: number | null;
  accountType?: string | null;
  totalCashValue?: number | null;
  settledCash?: number | null;
  accruedCash?: number | null;
  initialMargin?: number | null;
  maintenanceMargin?: number | null;
  excessLiquidity?: number | null;
  cushion?: number | null;
  sma?: number | null;
  dayTradingBuyingPower?: number | null;
  regTInitialMargin?: number | null;
  grossPositionValue?: number | null;
  leverage?: number | null;
  dayTradesRemaining?: number | null;
  isPatternDayTrader?: boolean | null;
  updatedAt: Date;
};

export type BrokerPositionSnapshot = {
  id: string;
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  providerSecurityType?: string | null;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  optionContract:
    | (OptionContractSnapshot & { providerContractId: string | null })
    | null;
  openedAt?: Date | null;
  openedAtSource?: PositionOpenedAtSource | null;
  quote?: PositionQuoteSnapshot | null;
};

export type PositionOpenedAtSource =
  | "broker"
  | "execution"
  | "lot"
  | "flex_open_position"
  | "flex_snapshot"
  | "expiration_same_day"
  | "shadow_position"
  | "automation"
  | "unknown";

export type PositionQuoteSource =
  | "bridge_quote"
  | "massive"
  | "option_quote"
  | "position_mark"
  | "shadow_ledger"
  | "unknown";

export type PositionQuoteSnapshot = {
  providerContractId?: string | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  last: number | null;
  mark: number | null;
  spread: number | null;
  spreadPercent: number | null;
  bidSize: number | null;
  askSize: number | null;
  updatedAt: Date | null;
  freshness: string | null;
  marketDataMode: string | null;
  source: PositionQuoteSource;
  transport?: MarketDataTransport | null;
  delayed?: boolean | null;
  dataUpdatedAt?: Date | null;
  ageMs?: number | null;
  cacheAgeMs?: number | null;
  status?: string | null;
  reason?: string | null;
  quoteStatus?: string | null;
  quoteReason?: string | null;
  greeksStatus?: string | null;
  greeksReason?: string | null;
  demandStatus?: string | null;
  demandReason?: string | null;
  quoteFreshness?: MarketDataFreshness | string | null;
  greeksFreshness?: MarketDataFreshness | string | null;
  unavailableDetail?: string | null;
  price?: number | null;
  dayChange?: number | null;
  dayChangePercent?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  impliedVolatility?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  underlyingPrice?: number | null;
};

export type BrokerOrderSnapshot = {
  id: string;
  accountId: string;
  mode: RuntimeMode;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  type: OrderType;
  timeInForce: TimeInForce;
  status: OrderStatus;
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  placedAt: Date;
  updatedAt: Date;
  optionContract: BrokerPositionSnapshot["optionContract"];
  tradingSession?: TradingSession | null;
  resolvedExchange?: string | null;
  primaryExchange?: string | null;
  includeOvernight?: boolean | null;
  routingReason?: string | null;
};

export type PlaceOrderInput = {
  accountId: string;
  mode: RuntimeMode;
  confirm?: boolean | null;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  timeInForce: TimeInForce;
  optionContract: OptionContractSnapshot | null;
  positionEffect?: OptionOrderPositionEffect;
  strategyIntent?: OptionOrderStrategyIntent;
  tradingSession?: TradingSession;
  includeOvernight?: boolean | null;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: string[] | null;
};

export type QuoteSnapshot = {
  symbol: string;
  price: number;
  last?: number | null;
  mark?: number | null;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  extendedBaselinePrice?: number | null;
  extendedBaselineAt?: Date | null;
  extendedBaselineSource?: "regular_close" | null;
  volume: number | null;
  openInterest: number | null;
  optionCallVolume?: number | null;
  optionPutVolume?: number | null;
  optionCallOpenInterest?: number | null;
  optionPutOpenInterest?: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  underlyingPrice?: number | null;
  updatedAt: Date;
  providerContractId: string | null;
  transport: MarketDataTransport;
  delayed: boolean;
  freshness?: MarketDataFreshness;
  marketDataMode?: IbkrMarketDataMode | null;
  dataUpdatedAt?: Date | null;
  ageMs?: number | null;
  cacheAgeMs?: number | null;
  latency?: {
    bridgeReceivedAt?: Date | null;
    bridgeEmittedAt?: Date | null;
    apiServerReceivedAt?: Date | null;
    apiServerEmittedAt?: Date | null;
  } | null;
};

export type BrokerBarSnapshot = {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  quoteAsOf?: Date | null;
  source: string;
  providerContractId: string | null;
  outsideRth: boolean;
  partial: boolean;
  transport: MarketDataTransport;
  delayed: boolean;
  freshness?: MarketDataFreshness;
  marketDataMode?: IbkrMarketDataMode | null;
  dataUpdatedAt?: Date | null;
  ageMs?: number | null;
};

export type FootprintAssetClass = "equity" | "option";
export type FootprintSourcePreference =
  | "massive_first"
  | "ibkr_first"
  | "massive_only";
export type FootprintSourceProvider = "massive" | "ibkr" | "none";
export type FootprintDisplayMode = "split" | "delta" | "total";
export type FootprintSide = "buy" | "sell" | "unknown";
export type FootprintClassificationMethod =
  | "quote_match"
  | "tick_rule"
  | "unknown";
export type FootprintPartialReason =
  | "window_capped"
  | "unsupported_timeframe"
  | "provider_unavailable"
  | "missing_option_ticker"
  | "no_trades"
  | "request_failed";

export type FootprintLevel = {
  price: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  totalVolume: number;
  delta: number;
  tradeCount: number;
  buyImbalance: boolean;
  sellImbalance: boolean;
};

export type FootprintCandle = {
  time: Date;
  endTime: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  unknownVolume: number;
  delta: number;
  tradeCount: number;
  pocPrice: number | null;
  levels: FootprintLevel[];
  complete: boolean;
  partialReason: FootprintPartialReason | null;
};

export type FootprintDiagnostics = {
  sourceProvider: FootprintSourceProvider;
  sourcePreference: FootprintSourcePreference;
  classificationMethod: FootprintClassificationMethod;
  classifiedVolume: number;
  unknownVolume: number;
  quoteMatchedTradeCount: number;
  tickRuleTradeCount: number;
  unknownTradeCount: number;
  tradeCount: number;
  quoteCount: number;
  bidAskCoveragePercent: number;
  minTick: number;
  minTickSource: "provider" | "inferred" | "default";
  rowSize: number;
  capped: boolean;
};

export type FootprintResponse = {
  symbol: string;
  assetClass: FootprintAssetClass;
  timeframe: HistoryBarTimeframe | "15s" | "30s" | "2m" | "30m";
  from: Date;
  to: Date;
  providerContractId: string | null;
  optionTicker: string | null;
  candles: FootprintCandle[];
  complete: boolean;
  partialReason: FootprintPartialReason | null;
  diagnostics: FootprintDiagnostics;
};

export type ResolvedIbkrContract = {
  conid: number;
  symbol: string;
  secType: string;
  listingExchange: string;
  providerContractId: string;
};

export type IbkrNewsArticle = {
  id: string;
  title: string;
  description: string | null;
  articleUrl: string;
  imageUrl: string | null;
  author: string | null;
  publishedAt: Date;
  tickers: string[];
  publisher: {
    name: string;
    homepageUrl: string | null;
    logoUrl: string | null;
  };
  sentiment: string | null;
  sentimentReasoning: string | null;
};

export type IbkrUniverseTicker = {
  ticker: string;
  name: string;
  market: UniverseMarket;
  rootSymbol: string | null;
  normalizedExchangeMic: string | null;
  exchangeDisplay: string | null;
  logoUrl: string | null;
  countryCode: string | null;
  exchangeCountryCode: string | null;
  sector: string | null;
  industry: string | null;
  contractDescription: string | null;
  contractMeta: UniverseTickerContractMeta;
  locale: string | null;
  type: string | null;
  active: boolean;
  primaryExchange: string | null;
  currencyName: string | null;
  cik: string | null;
  compositeFigi: string | null;
  shareClassFigi: string | null;
  lastUpdatedAt: Date | null;
  provider: MarketDataProvider | null;
  providers: MarketDataProvider[];
  tradeProvider: MarketDataProvider | null;
  dataProviderPreference: MarketDataProvider | null;
  providerContractId?: string | null;
};

export type OptionChainContract = {
  contract: {
    ticker: string;
    underlying: string;
    expirationDate: Date;
    strike: number;
    right: OptionRight;
    multiplier: number;
    sharesPerContract: number;
    providerContractId: string | null;
    brokerContractId?: string | null;
  };
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  openInterest: number | null;
  volume: number | null;
  updatedAt: Date;
  prevClose?: number | null;
  change?: number | null;
  changePercent?: number | null;
  quoteFreshness?: MarketDataFreshness;
  marketDataMode?: IbkrMarketDataMode | null;
  quoteUpdatedAt?: Date | null;
  dataUpdatedAt?: Date | null;
  ageMs?: number | null;
  underlyingPrice?: number | null;
};

export type SessionStatusSnapshot = {
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
  selectedAccountId: string | null;
  accounts: string[];
  updatedAt: Date;
  raw: Record<string, unknown> | null;
};

export type OrderPreviewSnapshot = {
  accountId: string;
  mode: RuntimeMode;
  symbol: string;
  assetClass: AssetClass;
  resolvedContractId: number;
  orderPayload: Record<string, unknown>;
  optionContract: BrokerPositionSnapshot["optionContract"];
  tradingSession?: TradingSession | null;
  resolvedExchange?: string | null;
  primaryExchange?: string | null;
  includeOvernight?: boolean | null;
  routingReason?: string | null;
};

export type CancelOrderSnapshot = {
  orderId: string;
  accountId: string | null;
  message: string;
  submittedAt: Date;
};

export type ReplaceOrderSnapshot = BrokerOrderSnapshot;

export type BrokerExecutionSnapshot = {
  id: string;
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  side: OrderSide;
  quantity: number;
  price: number;
  netAmount: number | null;
  exchange: string | null;
  executedAt: Date;
  orderDescription: string | null;
  contractDescription: string | null;
  providerContractId: string | null;
  optionContract?: OptionContractSnapshot | null;
  orderRef: string | null;
};

export type BrokerMarketDepthLevel = {
  row: number;
  price: number;
  bidSize: number | null;
  askSize: number | null;
  totalSize: number | null;
  isLastTrade: boolean;
};

export type BrokerMarketDepthSnapshot = {
  accountId: string | null;
  symbol: string;
  assetClass: AssetClass;
  providerContractId: string | null;
  exchange: string | null;
  updatedAt: Date;
  levels: BrokerMarketDepthLevel[];
  freshness?: "live" | "stale" | "pending";
  cacheAgeMs?: number | null;
};
