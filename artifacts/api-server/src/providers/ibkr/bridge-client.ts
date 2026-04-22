import { HttpError } from "../../lib/errors";
import { fetchJson, withSearchParams, type QueryValue } from "../../lib/http";
import { getIbkrBridgeRuntimeConfig, type RuntimeMode } from "../../lib/runtime";
import type {
  BrokerBarSnapshot,
  BrokerAccountSnapshot,
  BrokerExecutionSnapshot,
  BrokerMarketDepthSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  CancelOrderSnapshot,
  HistoryBarTimeframe,
  HistoryDataSource,
  OptionChainContract,
  OrderPreviewSnapshot,
  PlaceOrderInput,
  QuoteSnapshot,
  ReplaceOrderSnapshot,
  SessionStatusSnapshot,
} from "./client";

type BridgeHealthSnapshot = {
  configured: boolean;
  authenticated: boolean;
  connected: boolean;
  competing: boolean;
  selectedAccountId: string | null;
  accounts: string[];
  lastTickleAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
  transport: "client_portal" | "tws";
  connectionTarget: string | null;
  sessionMode: RuntimeMode | null;
  clientId: number | null;
};

export class IbkrBridgeClient {
  private readonly config = getIbkrBridgeRuntimeConfig();

  private buildUrl(path: string, params: Record<string, QueryValue> = {}): URL {
    if (!this.config) {
      throw new HttpError(503, "Interactive Brokers bridge is not configured.", {
        code: "ibkr_bridge_not_configured",
      });
    }

    return withSearchParams(`${this.config.baseUrl}${path}`, params);
  }

  private request<T>(
    path: string,
    init: RequestInit = {},
    params: Record<string, QueryValue> = {},
  ): Promise<T> {
    return fetchJson<T>(this.buildUrl(path, params), {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {}),
      },
    });
  }

  getHealth(): Promise<BridgeHealthSnapshot> {
    return this.request<BridgeHealthSnapshot>("/healthz");
  }

  getSession(): Promise<SessionStatusSnapshot | null> {
    return this.request<SessionStatusSnapshot | null>("/session");
  }

  async listAccounts(mode: RuntimeMode): Promise<BrokerAccountSnapshot[]> {
    const payload = await this.request<{ accounts: BrokerAccountSnapshot[] }>("/accounts", {}, { mode });
    return payload.accounts;
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    const payload = await this.request<{ positions: BrokerPositionSnapshot[] }>("/positions", {}, {
      mode: input.mode,
      accountId: input.accountId,
    });
    return payload.positions;
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
    const payload = await this.request<{ orders: BrokerOrderSnapshot[] }>("/orders", {}, {
      mode: input.mode,
      accountId: input.accountId,
      status: input.status,
    });
    return payload.orders;
  }

  async listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]> {
    const payload = await this.request<{ executions: BrokerExecutionSnapshot[] }>(
      "/executions",
      {},
      {
        accountId: input.accountId,
        days: input.days,
        limit: input.limit,
        symbol: input.symbol,
        providerContractId: input.providerContractId,
      },
    );
    return payload.executions;
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const payload = await this.request<{ quotes: QuoteSnapshot[] }>("/quotes/snapshot", {}, {
      symbols: symbols.join(","),
    });
    return payload.quotes;
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
    const payload = await this.request<{ bars: BrokerBarSnapshot[] }>("/bars", {}, {
      symbol: input.symbol,
      timeframe: input.timeframe,
      limit: input.limit,
      from: input.from,
      to: input.to,
      assetClass: input.assetClass,
      providerContractId: input.providerContractId,
      outsideRth: input.outsideRth,
      source: input.source,
    });
    return payload.bars;
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put";
    maxExpirations?: number;
    strikesAroundMoney?: number;
  }): Promise<OptionChainContract[]> {
    const payload = await this.request<{ contracts: OptionChainContract[] }>("/options/chains", {}, {
      underlying: input.underlying,
      expirationDate: input.expirationDate,
      contractType: input.contractType,
      maxExpirations: input.maxExpirations,
      strikesAroundMoney: input.strikesAroundMoney,
    });
    return payload.contracts;
  }

  async getMarketDepth(input: {
    accountId?: string;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null> {
    const payload = await this.request<{ depth: BrokerMarketDepthSnapshot | null }>(
      "/market-depth",
      {},
      {
        accountId: input.accountId,
        symbol: input.symbol,
        assetClass: input.assetClass,
        providerContractId: input.providerContractId,
        exchange: input.exchange,
      },
    );
    return payload.depth;
  }

  previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    return this.request<OrderPreviewSnapshot>("/orders/preview", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot> {
    return this.request<BrokerOrderSnapshot>("/orders", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  submitRawOrders(input: {
    accountId?: string | null;
    ibkrOrders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/orders/submit", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
  }): Promise<ReplaceOrderSnapshot> {
    return this.request<ReplaceOrderSnapshot>(`/orders/${encodeURIComponent(input.orderId)}/replace`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  cancelOrder(input: {
    accountId: string;
    orderId: string;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    return this.request<CancelOrderSnapshot>(`/orders/${encodeURIComponent(input.orderId)}/cancel`, {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
