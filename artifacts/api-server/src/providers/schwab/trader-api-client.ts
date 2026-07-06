import { HttpError } from "../../lib/errors";

// Thin REST client for the Schwab Trader API. Base URL verified live against
// https://developer.schwab.com/products/trader-api--individual on 2026-07-03.
// Order + safety-read methods added 2026-07-06 (attended-broker order path,
// Phase 0). Endpoints/order schema per the Schwab Trader API doc as mirrored by
// schwab-py / schwabr; the place/replace order-id-in-Location-header behavior is
// flagged for live-fixture confirmation before any executable flip.
export const SCHWAB_TRADER_API_BASE_URL = "https://api.schwabapi.com/trader/v1";

export type SchwabTraderApiClientOptions = {
  accessToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type SchwabAccountNumberMapping = {
  accountNumber: string;
  hashValue: string;
};

// Schwab order JSON (transport shape). The validated builder lives in the order
// service; this is the wire contract for EQUITY single-leg orders.
export type SchwabOrderInstruction = "BUY" | "SELL" | "BUY_TO_COVER" | "SELL_SHORT";

export type SchwabOrderLeg = {
  instruction: SchwabOrderInstruction;
  quantity: number;
  instrument: { symbol: string; assetType: "EQUITY" };
};

export type SchwabOrderRequest = {
  orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  session: "NORMAL" | "AM" | "PM" | "SEAMLESS";
  duration: "DAY" | "GOOD_TILL_CANCEL" | "FILL_OR_KILL";
  orderStrategyType: "SINGLE";
  price?: string;
  stopPrice?: string;
  orderLegCollection: SchwabOrderLeg[];
};

export type SchwabOrdersQuery = {
  maxResults?: number;
  fromEnteredTime?: string;
  toEnteredTime?: string;
  status?: string;
};

export type SchwabTransactionsQuery = {
  startDate?: string;
  endDate?: string;
  types?: string;
  symbol?: string;
};

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
};

type SchwabResponse = {
  status: number;
  headers: Headers;
  json: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

// Schwab returns the new order id only in the Location header of a place/replace
// response, e.g. ".../accounts/{hash}/orders/{orderId}". Extract the trailing id.
export function extractOrderIdFromLocation(location: string | null): string | null {
  if (!location) return null;
  const withoutQuery = location.split("?")[0]!.replace(/\/+$/, "");
  const segment = withoutQuery.substring(withoutQuery.lastIndexOf("/") + 1);
  return segment || null;
}

export class SchwabTraderApiClient {
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: SchwabTraderApiClientOptions) {
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? SCHWAB_TRADER_API_BASE_URL;
  }

  private async request(path: string, options: RequestOptions = {}): Promise<SchwabResponse> {
    const method = options.method ?? "GET";
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };
    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.baseUrl}${path}${buildQueryString(options.query)}`,
        init,
      );
    } catch {
      throw new HttpError(502, "Schwab Trader API request failed", {
        code: "schwab_trader_api_network_error",
        expose: false,
      });
    }

    if (!response.ok) {
      throw new HttpError(502, "Schwab Trader API request failed", {
        code: "schwab_trader_api_error",
        expose: false,
        data: { status: response.status, path },
      });
    }

    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
    }
    return { status: response.status, headers: response.headers, json };
  }

  async getAccountNumbers(): Promise<SchwabAccountNumberMapping[]> {
    const { json } = await this.request("/accounts/accountNumbers");
    if (!Array.isArray(json)) {
      throw new HttpError(502, "Schwab account numbers response was invalid", {
        code: "schwab_account_numbers_invalid_response",
        expose: false,
      });
    }

    const mappings: SchwabAccountNumberMapping[] = [];
    for (const entry of json) {
      const record = asRecord(entry);
      const accountNumber = nonEmptyString(record["accountNumber"]);
      const hashValue = nonEmptyString(record["hashValue"]);
      if (!accountNumber || !hashValue) {
        continue;
      }
      mappings.push({ accountNumber, hashValue });
    }
    return mappings;
  }

  async getAccounts(): Promise<unknown[]> {
    const { json } = await this.request("/accounts");
    if (!Array.isArray(json)) {
      throw new HttpError(502, "Schwab accounts response was invalid", {
        code: "schwab_accounts_invalid_response",
        expose: false,
      });
    }
    return json;
  }

  // Account snapshot including positions (safety-gate + reconciliation read).
  async getAccountWithPositions(accountHash: string): Promise<unknown> {
    const { json } = await this.request(
      `/accounts/${encodeURIComponent(accountHash)}`,
      { query: { fields: "positions" } },
    );
    return json;
  }

  // Place a single order. On success Schwab returns 201 with the new order id in
  // the Location header (empty body).
  async placeOrder(
    accountHash: string,
    order: SchwabOrderRequest,
  ): Promise<{ orderId: string | null }> {
    const { headers } = await this.request(
      `/accounts/${encodeURIComponent(accountHash)}/orders`,
      { method: "POST", body: order },
    );
    return { orderId: extractOrderIdFromLocation(headers.get("location")) };
  }

  // Dry-run an order (returns the order impact / balance projection).
  async previewOrder(accountHash: string, order: SchwabOrderRequest): Promise<unknown> {
    const { json } = await this.request(
      `/accounts/${encodeURIComponent(accountHash)}/previewOrder`,
      { method: "POST", body: order },
    );
    return json;
  }

  // Replace an existing order; Schwab cancels the old id and issues a new one
  // (returned in the Location header).
  async replaceOrder(
    accountHash: string,
    orderId: string,
    order: SchwabOrderRequest,
  ): Promise<{ orderId: string | null }> {
    const { headers } = await this.request(
      `/accounts/${encodeURIComponent(accountHash)}/orders/${encodeURIComponent(orderId)}`,
      { method: "PUT", body: order },
    );
    return {
      orderId: extractOrderIdFromLocation(headers.get("location")) ?? orderId,
    };
  }

  async cancelOrder(accountHash: string, orderId: string): Promise<void> {
    await this.request(
      `/accounts/${encodeURIComponent(accountHash)}/orders/${encodeURIComponent(orderId)}`,
      { method: "DELETE" },
    );
  }

  // Order read (fill confirmation / terminal-state polling — safety gate).
  async getOrder(accountHash: string, orderId: string): Promise<unknown> {
    const { json } = await this.request(
      `/accounts/${encodeURIComponent(accountHash)}/orders/${encodeURIComponent(orderId)}`,
    );
    return json;
  }

  async getOrders(accountHash: string, query: SchwabOrdersQuery = {}): Promise<unknown[]> {
    const { json } = await this.request(
      `/accounts/${encodeURIComponent(accountHash)}/orders`,
      { query: { ...query } },
    );
    if (!Array.isArray(json)) {
      throw new HttpError(502, "Schwab orders response was invalid", {
        code: "schwab_orders_invalid_response",
        expose: false,
      });
    }
    return json;
  }

  // Transactions read (reconciliation / audit durability — ADR-002).
  async getTransactions(
    accountHash: string,
    query: SchwabTransactionsQuery = {},
  ): Promise<unknown[]> {
    const { json } = await this.request(
      `/accounts/${encodeURIComponent(accountHash)}/transactions`,
      { query: { ...query } },
    );
    if (!Array.isArray(json)) {
      throw new HttpError(502, "Schwab transactions response was invalid", {
        code: "schwab_transactions_invalid_response",
        expose: false,
      });
    }
    return json;
  }
}
