import crypto from "node:crypto";

import { toExecutionDecisionResponse } from "./execution-decision-response";
import type { ExecutionDecisionResponse } from "./execution-decision-response";
import { readEnvString } from "../lib/env";

export type SnapTradeReadinessStatus =
  | "unconfigured"
  | "research_required"
  | "upstream_error";

export type SnapTradeReadinessResponse = {
  provider: "snaptrade";
  configured: boolean;
  status: SnapTradeReadinessStatus;
  checkedAt: string;
  executionDecision: ExecutionDecisionResponse;
  credentials: {
    clientIdPresent: boolean;
    apiKeyPresent: boolean;
  };
  clientInfo: {
    reachable: boolean;
    redirectUriConfigured: boolean | null;
    canAccessTrades: boolean | null;
    canAccessHoldings: boolean | null;
    canAccessAccountHistory: boolean | null;
    canAccessReferenceData: boolean | null;
    canAccessPortfolioManagement: boolean | null;
    canAccessOrders: boolean | null;
  } | null;
  brokerages: {
    total: number;
    enabled: number;
    allowsTrading: number;
    degradedOrMaintenance: number;
  } | null;
  limitations: string[];
  upstream: {
    status: number;
    code: string;
    message: string;
  } | null;
};

export type SnapTradeReadinessOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type SnapTradeSignatureInput = {
  path: string;
  query: string;
  content: unknown;
  consumerKey: string;
};

export type SnapTradeSignature = {
  canonicalPayload: string;
  signature: string;
};

export const SNAPTRADE_API_VERSION_PREFIX = "/api/v1";
export const SNAPTRADE_API_BASE_URL = `https://api.snaptrade.com${SNAPTRADE_API_VERSION_PREFIX}`;
const SNAPTRADE_PARTNER_INFO_PATH = "/snapTrade/partners";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isPresentString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function buildSnapTradeSignature(
  input: SnapTradeSignatureInput,
): SnapTradeSignature {
  const canonicalPayload = canonicalJson({
    content: input.content,
    path: snapTradeApiPath(input.path),
    query: input.query,
  });
  const signature = crypto
    .createHmac("sha256", input.consumerKey)
    .update(canonicalPayload, "utf8")
    .digest("base64");

  return { canonicalPayload, signature };
}

export function snapTradeApiPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (
    normalizedPath === SNAPTRADE_API_VERSION_PREFIX ||
    normalizedPath.startsWith(`${SNAPTRADE_API_VERSION_PREFIX}/`)
  ) {
    return normalizedPath;
  }
  return `${SNAPTRADE_API_VERSION_PREFIX}${normalizedPath}`;
}

function baseResponse(input: {
  configured: boolean;
  status: SnapTradeReadinessStatus;
  checkedAt: Date;
  clientIdPresent: boolean;
  apiKeyPresent: boolean;
  clientInfo?: SnapTradeReadinessResponse["clientInfo"];
  brokerages?: SnapTradeReadinessResponse["brokerages"];
  limitations?: string[];
  upstream?: SnapTradeReadinessResponse["upstream"];
}): SnapTradeReadinessResponse {
  return {
    provider: "snaptrade",
    configured: input.configured,
    status: input.status,
    checkedAt: input.checkedAt.toISOString(),
    executionDecision: toExecutionDecisionResponse("PROVIDER_RESEARCH_REQUIRED"),
    credentials: {
      clientIdPresent: input.clientIdPresent,
      apiKeyPresent: input.apiKeyPresent,
    },
    clientInfo: input.clientInfo ?? null,
    brokerages: input.brokerages ?? null,
    limitations: input.limitations ?? ["snaptrade.provider_research_required"],
    upstream: input.upstream ?? null,
  };
}

export async function readSnapTradeReadiness(
  options: SnapTradeReadinessOptions = {},
): Promise<SnapTradeReadinessResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const checkedAt = options.now ?? new Date();
  const clientId = readEnvString(env, "SNAPTRADE_CLIENTID");
  const consumerKey = readEnvString(env, "SNAPTRADE_API_KEY");
  const clientIdPresent = clientId.length > 0;
  const apiKeyPresent = consumerKey.length > 0;

  if (!clientIdPresent || !apiKeyPresent) {
    const missing = [
      !clientIdPresent ? "snaptrade.client_id_missing" : null,
      !apiKeyPresent ? "snaptrade.api_key_missing" : null,
      "snaptrade.provider_research_required",
    ].filter((value): value is string => Boolean(value));
    return baseResponse({
      configured: false,
      status: "unconfigured",
      checkedAt,
      clientIdPresent,
      apiKeyPresent,
      limitations: missing,
    });
  }

  const timestamp = Math.floor(checkedAt.getTime() / 1000).toString();
  const query = `clientId=${encodeURIComponent(clientId)}&timestamp=${timestamp}`;
  const { signature } = buildSnapTradeSignature({
    path: SNAPTRADE_PARTNER_INFO_PATH,
    query,
    content: null,
    consumerKey,
  });

  try {
    const response = await fetchImpl(
      `${SNAPTRADE_API_BASE_URL}${SNAPTRADE_PARTNER_INFO_PATH}?${query}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Signature: signature,
        },
      },
    );
    const payload = await readJsonSafely(response);

    if (!response.ok) {
      return baseResponse({
        configured: true,
        status: "upstream_error",
        checkedAt,
        clientIdPresent,
        apiKeyPresent,
        clientInfo: {
          reachable: false,
          redirectUriConfigured: null,
          canAccessTrades: null,
          canAccessHoldings: null,
          canAccessAccountHistory: null,
          canAccessReferenceData: null,
          canAccessPortfolioManagement: null,
          canAccessOrders: null,
        },
        limitations: [
          "snaptrade.client_info_unavailable",
          "snaptrade.provider_research_required",
        ],
        upstream: {
          status: response.status,
          code: `snaptrade_http_${response.status}`,
          message: "SnapTrade client info probe failed.",
        },
      });
    }

    const record = asRecord(payload);
    const allowedBrokerages = Array.isArray(record["allowed_brokerages"])
      ? record["allowed_brokerages"].map(asRecord)
      : [];
    const redirectUriConfigured = isPresentString(record["redirect_uri"]);
    const limitations = [
      redirectUriConfigured ? null : "snaptrade.redirect_uri_not_configured",
      "snaptrade.provider_research_required",
    ].filter((value): value is string => Boolean(value));

    return baseResponse({
      configured: true,
      status: "research_required",
      checkedAt,
      clientIdPresent,
      apiKeyPresent,
      clientInfo: {
        reachable: true,
        redirectUriConfigured,
        canAccessTrades: asBooleanOrNull(record["can_access_trades"]),
        canAccessHoldings: asBooleanOrNull(record["can_access_holdings"]),
        canAccessAccountHistory: asBooleanOrNull(
          record["can_access_account_history"],
        ),
        canAccessReferenceData: asBooleanOrNull(
          record["can_access_reference_data"],
        ),
        canAccessPortfolioManagement: asBooleanOrNull(
          record["can_access_portfolio_management"],
        ),
        canAccessOrders: asBooleanOrNull(record["can_access_orders"]),
      },
      brokerages: {
        total: allowedBrokerages.length,
        enabled: allowedBrokerages.filter((brokerage) => brokerage["enabled"] === true)
          .length,
        allowsTrading: allowedBrokerages.filter(
          (brokerage) => brokerage["allows_trading"] === true,
        ).length,
        degradedOrMaintenance: allowedBrokerages.filter(
          (brokerage) =>
            brokerage["is_degraded"] === true ||
            brokerage["maintenance_mode"] === true,
        ).length,
      },
      limitations,
    });
  } catch {
    return baseResponse({
      configured: true,
      status: "upstream_error",
      checkedAt,
      clientIdPresent,
      apiKeyPresent,
      clientInfo: {
        reachable: false,
        redirectUriConfigured: null,
        canAccessTrades: null,
        canAccessHoldings: null,
        canAccessAccountHistory: null,
        canAccessReferenceData: null,
        canAccessPortfolioManagement: null,
        canAccessOrders: null,
      },
      limitations: [
        "snaptrade.client_info_unavailable",
        "snaptrade.provider_research_required",
      ],
      upstream: {
        status: 0,
        code: "snaptrade_network_error",
        message: "SnapTrade client info probe failed.",
      },
    });
  }
}
