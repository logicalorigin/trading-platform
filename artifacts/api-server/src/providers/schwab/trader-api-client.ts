import { HttpError } from "../../lib/errors";

// Thin REST client for the Schwab Trader API. Base URL verified live against
// https://developer.schwab.com/products/trader-api--individual on 2026-07-03.
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

  private async request(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
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

    const body = await response.text();
    if (!body) {
      return null;
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }

  async getAccountNumbers(): Promise<SchwabAccountNumberMapping[]> {
    const payload = await this.request("/accounts/accountNumbers");
    if (!Array.isArray(payload)) {
      throw new HttpError(502, "Schwab account numbers response was invalid", {
        code: "schwab_account_numbers_invalid_response",
        expose: false,
      });
    }

    const mappings: SchwabAccountNumberMapping[] = [];
    for (const entry of payload) {
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
    const payload = await this.request("/accounts");
    if (!Array.isArray(payload)) {
      throw new HttpError(502, "Schwab accounts response was invalid", {
        code: "schwab_accounts_invalid_response",
        expose: false,
      });
    }
    return payload;
  }
}
