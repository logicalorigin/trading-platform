import { HttpError } from "../lib/errors";
import {
  buildSnapTradeSignature,
  SNAPTRADE_API_BASE_URL,
} from "./snaptrade-readiness";
import { readEnvString } from "../lib/env";

export type SnapTradeBrokerageAuthorizationType = {
  type: string;
  authType: string | null;
};

export type SnapTradeBrokerageListing = {
  slug: string;
  displayName: string;
  description: string | null;
  url: string | null;
  allowsTrading: boolean;
  enabled: boolean;
  maintenanceMode: boolean;
  isDegraded: boolean;
  allowsFractionalUnits: boolean | null;
  logoUrl: string | null;
  squareLogoUrl: string | null;
  authorizationTypes: SnapTradeBrokerageAuthorizationType[];
};

export type ListSnapTradeBrokeragesResponse = {
  provider: "snaptrade";
  checkedAt: string;
  brokerages: SnapTradeBrokerageListing[];
};

export type ListSnapTradeBrokeragesOptions = {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
};

const SNAPTRADE_PARTNER_INFO_PATH = "/snapTrade/partners";
const BROKERAGES_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedResponse: { fetchedAtMs: number; data: ListSnapTradeBrokeragesResponse } | null =
  null;

export function resetSnapTradeBrokeragesCacheForTests(): void {
  cachedResponse = null;
}

function configuredSnapTradeCredentials(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): { clientId: string; consumerKey: string } {
  const clientId = readEnvString(env, "SNAPTRADE_CLIENTID");
  const consumerKey = readEnvString(env, "SNAPTRADE_API_KEY");
  if (!clientId || !consumerKey) {
    throw new HttpError(503, "SnapTrade credentials are not configured", {
      code: "snaptrade_credentials_not_configured",
    });
  }
  return { clientId, consumerKey };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asHttpsUrlOrNull(value: unknown): string | null {
  const candidate = asStringOrNull(value);
  if (!candidate) {
    return null;
  }
  try {
    return new URL(candidate).protocol === "https:" ? candidate : null;
  } catch {
    return null;
  }
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

function toBrokerageListing(value: unknown): SnapTradeBrokerageListing | null {
  const record = asRecord(value);
  const slug = asStringOrNull(record["slug"]);
  if (!slug) {
    return null;
  }
  const authorizationTypes = (Array.isArray(record["authorization_types"])
    ? record["authorization_types"]
    : []
  )
    .map((entry) => {
      const auth = asRecord(entry);
      const type = asStringOrNull(auth["type"]);
      return type
        ? { type, authType: asStringOrNull(auth["auth_type"]) }
        : null;
    })
    .filter(
      (entry): entry is SnapTradeBrokerageAuthorizationType => entry !== null,
    );

  return {
    slug,
    displayName:
      asStringOrNull(record["display_name"]) ??
      asStringOrNull(record["name"]) ??
      slug,
    description: asStringOrNull(record["description"]),
    url: asHttpsUrlOrNull(record["url"]),
    allowsTrading: record["allows_trading"] === true,
    enabled: record["enabled"] === true,
    maintenanceMode: record["maintenance_mode"] === true,
    isDegraded: record["is_degraded"] === true,
    allowsFractionalUnits:
      typeof record["allows_fractional_units"] === "boolean"
        ? record["allows_fractional_units"]
        : null,
    logoUrl: asHttpsUrlOrNull(record["aws_s3_logo_url"]),
    squareLogoUrl: asHttpsUrlOrNull(record["aws_s3_square_logo_url"]),
    authorizationTypes,
  };
}

function sortBrokerages(
  brokerages: SnapTradeBrokerageListing[],
): SnapTradeBrokerageListing[] {
  return [...brokerages].sort((a, b) => {
    const aTradable = a.allowsTrading && a.enabled ? 0 : 1;
    const bTradable = b.allowsTrading && b.enabled ? 0 : 1;
    if (aTradable !== bTradable) {
      return aTradable - bTradable;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

export async function listSnapTradeBrokerages(
  options: ListSnapTradeBrokeragesOptions = {},
): Promise<ListSnapTradeBrokeragesResponse> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();

  const { clientId, consumerKey } = configuredSnapTradeCredentials(env);

  if (
    cachedResponse &&
    now.getTime() - cachedResponse.fetchedAtMs < BROKERAGES_CACHE_TTL_MS
  ) {
    return cachedResponse.data;
  }

  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const query = `clientId=${encodeURIComponent(clientId)}&timestamp=${timestamp}`;
  const { signature } = buildSnapTradeSignature({
    path: SNAPTRADE_PARTNER_INFO_PATH,
    query,
    content: null,
    consumerKey,
  });

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
  if (!response.ok) {
    throw new HttpError(502, "SnapTrade brokerage listing is unavailable", {
      code: "snaptrade_brokerages_unavailable",
      expose: false,
    });
  }

  const record = asRecord(await readJsonSafely(response));
  const brokerages = sortBrokerages(
    (Array.isArray(record["allowed_brokerages"])
      ? record["allowed_brokerages"]
      : []
    )
      .map(toBrokerageListing)
      .filter((entry): entry is SnapTradeBrokerageListing => entry !== null),
  );

  const data: ListSnapTradeBrokeragesResponse = {
    provider: "snaptrade",
    checkedAt: now.toISOString(),
    brokerages,
  };
  cachedResponse = { fetchedAtMs: now.getTime(), data };
  return data;
}
