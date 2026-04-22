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
  IbkrNewsArticle,
  IbkrUniverseTicker,
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

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string);
}

function hydrateOptionContract<
  T extends { expirationDate: unknown } | null | undefined,
>(contract: T): T {
  if (!contract) return contract;
  return { ...contract, expirationDate: toDate(contract.expirationDate) } as T;
}

function hydrateAccount(raw: BrokerAccountSnapshot): BrokerAccountSnapshot {
  return { ...raw, updatedAt: toDate(raw.updatedAt) };
}

function hydratePosition(raw: BrokerPositionSnapshot): BrokerPositionSnapshot {
  return { ...raw, optionContract: hydrateOptionContract(raw.optionContract) };
}

function hydrateOrder(raw: BrokerOrderSnapshot): BrokerOrderSnapshot {
  return {
    ...raw,
    placedAt: toDate(raw.placedAt),
    updatedAt: toDate(raw.updatedAt),
    optionContract: hydrateOptionContract(raw.optionContract),
  };
}

function hydrateExecution(raw: BrokerExecutionSnapshot): BrokerExecutionSnapshot {
  return { ...raw, executedAt: toDate(raw.executedAt) };
}

function hydrateMarketDepth(
  raw: BrokerMarketDepthSnapshot | null,
): BrokerMarketDepthSnapshot | null {
  if (!raw) return raw;
  return { ...raw, updatedAt: toDate(raw.updatedAt) };
}

function hydrateOptionChainContract(raw: OptionChainContract): OptionChainContract {
  return {
    ...raw,
    updatedAt: toDate(raw.updatedAt),
    contract: { ...raw.contract, expirationDate: toDate(raw.contract.expirationDate) },
  };
}

function hydrateSession(raw: SessionStatusSnapshot | null): SessionStatusSnapshot | null {
  if (!raw) return raw;
  return { ...raw, updatedAt: toDate(raw.updatedAt) };
}

function hydrateHealth(raw: BridgeHealthSnapshot): BridgeHealthSnapshot {
  return {
    ...raw,
    updatedAt: toDate(raw.updatedAt),
    lastTickleAt: raw.lastTickleAt ? toDate(raw.lastTickleAt) : null,
  };
}

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

  async getHealth(): Promise<BridgeHealthSnapshot> {
    return hydrateHealth(await this.request<BridgeHealthSnapshot>("/healthz"));
  }

  async getSession(): Promise<SessionStatusSnapshot | null> {
    return hydrateSession(await this.request<SessionStatusSnapshot | null>("/session"));
  }

  async listAccounts(mode: RuntimeMode): Promise<BrokerAccountSnapshot[]> {
    const payload = await this.request<{ accounts: BrokerAccountSnapshot[] }>("/accounts", {}, { mode });
    return payload.accounts.map(hydrateAccount);
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    const payload = await this.request<{ positions: BrokerPositionSnapshot[] }>("/positions", {}, {
      mode: input.mode,
      accountId: input.accountId,
    });
    return payload.positions.map(hydratePosition);
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
    return payload.orders.map(hydrateOrder);
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
    return payload.executions.map(hydrateExecution);
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    const payload = await this.request<{ quotes: Array<Omit<QuoteSnapshot, "updatedAt"> & { updatedAt: string | Date }> }>(
      "/quotes/snapshot",
      {},
      { symbols: symbols.join(",") },
    );
    return payload.quotes.map((quote) => ({
      ...quote,
      updatedAt: quote.updatedAt instanceof Date ? quote.updatedAt : new Date(quote.updatedAt),
    }));
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
    const payload = await this.request<{ bars: Array<Omit<BrokerBarSnapshot, "timestamp"> & { timestamp: string | Date }> }>(
      "/bars",
      {},
      {
        symbol: input.symbol,
        timeframe: input.timeframe,
        limit: input.limit,
        from: input.from,
        to: input.to,
        assetClass: input.assetClass,
        providerContractId: input.providerContractId,
        outsideRth: input.outsideRth,
        source: input.source,
      },
    );
    return payload.bars.map((bar) => ({
      ...bar,
      timestamp: bar.timestamp instanceof Date ? bar.timestamp : new Date(bar.timestamp),
    }));
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
    return payload.contracts.map(hydrateOptionChainContract);
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
    return hydrateMarketDepth(payload.depth);
  }

  async previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    const raw = await this.request<OrderPreviewSnapshot>("/orders/preview", {
      method: "POST",
      body: JSON.stringify(input),
      headers: {
        "Content-Type": "application/json",
      },
    });
    return { ...raw, optionContract: hydrateOptionContract(raw.optionContract) };
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot> {
    return hydrateOrder(
      await this.request<BrokerOrderSnapshot>("/orders", {
        method: "POST",
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
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

  async replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
  }): Promise<ReplaceOrderSnapshot> {
    return hydrateOrder(
      await this.request<ReplaceOrderSnapshot>(
        `/orders/${encodeURIComponent(input.orderId)}/replace`,
        {
          method: "POST",
          body: JSON.stringify(input),
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    const raw = await this.request<CancelOrderSnapshot>(
      `/orders/${encodeURIComponent(input.orderId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
    return { ...raw, submittedAt: toDate(raw.submittedAt) };
  }

  async getNews(input: { ticker?: string; limit?: number }): Promise<IbkrNewsArticle[]> {
    const params: Record<string, QueryValue> = {};
    if (input.ticker) params.ticker = input.ticker;
    if (typeof input.limit === "number") params.limit = input.limit;
    const raw = await this.request<IbkrNewsArticle[]>("/news", {}, params);
    return raw.map((article) => ({
      ...article,
      publishedAt: toDate(article.publishedAt),
    }));
  }

  async searchTickers(input: {
    search?: string;
    limit?: number;
  }): Promise<{ count: number; results: IbkrUniverseTicker[] }> {
    const params: Record<string, QueryValue> = {};
    if (input.search) params.search = input.search;
    if (typeof input.limit === "number") params.limit = input.limit;
    return this.request<{ count: number; results: IbkrUniverseTicker[] }>(
      "/universe/search",
      {},
      params,
    );
  }
}
