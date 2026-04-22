export type RuntimeMode = "paper" | "live";
export type PolygonRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
};
export type FmpRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
};
export type IbkrRuntimeConfig = {
  baseUrl: string;
  bearerToken: string | null;
  cookie: string | null;
  defaultAccountId: string | null;
  extOperator: string | null;
  extraHeaders: Record<string, string>;
  username: string | null;
  password: string | null;
  allowInsecureTls: boolean;
};
export type IbkrTransport = "client_portal" | "tws";
export type IbkrMarketDataMode =
  | "live"
  | "frozen"
  | "delayed"
  | "delayed_frozen"
  | "unknown";
export type IbkrTwsRuntimeConfig = {
  host: string;
  port: number;
  clientId: number;
  defaultAccountId: string | null;
  mode: RuntimeMode;
  marketDataType: 1 | 2 | 3 | 4;
};
export type IbkrBridgeProviderRuntimeConfig =
  | {
      transport: "client_portal";
      config: IbkrRuntimeConfig;
    }
  | {
      transport: "tws";
      config: IbkrTwsRuntimeConfig;
    };
export type IbkrBridgeRuntimeConfig = {
  baseUrl: string;
};

const POLYGON_API_KEY_ENV_NAMES = [
  "POLYGON_API_KEY",
  "POLYGON_KEY",
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
];

const POLYGON_BASE_URL_ENV_NAMES = [
  "POLYGON_BASE_URL",
  "MASSIVE_API_BASE_URL",
];

const FMP_API_KEY_ENV_NAMES = [
  "FMP_API_KEY",
  "FMP_KEY",
  "FINANCIAL_MODELING_PREP_API_KEY",
  "FINANCIALMODELINGPREP_API_KEY",
];

const FMP_BASE_URL_ENV_NAMES = [
  "FMP_BASE_URL",
  "FINANCIAL_MODELING_PREP_BASE_URL",
];

const IBKR_BASE_URL_ENV_NAMES = [
  "IBKR_BASE_URL",
  "IBKR_API_BASE_URL",
  "IB_GATEWAY_URL",
  "IBKR_GATEWAY_URL",
];
const IBKR_TRANSPORT_ENV_NAMES = ["IBKR_TRANSPORT"];
const IBKR_TWS_HOST_ENV_NAMES = [
  "IBKR_TWS_HOST",
  "IBKR_SOCKET_HOST",
  "IB_GATEWAY_HOST",
  "TWS_HOST",
];
const IBKR_TWS_PORT_ENV_NAMES = [
  "IBKR_TWS_PORT",
  "IBKR_SOCKET_PORT",
  "IB_GATEWAY_PORT",
  "TWS_PORT",
];
const IBKR_TWS_CLIENT_ID_ENV_NAMES = [
  "IBKR_TWS_CLIENT_ID",
  "IBKR_CLIENT_ID",
  "IB_GATEWAY_CLIENT_ID",
  "TWS_CLIENT_ID",
];
const IBKR_TWS_MODE_ENV_NAMES = [
  "IBKR_TWS_MODE",
  "IBKR_GATEWAY_MODE",
  "IB_GATEWAY_MODE",
];
const IBKR_TWS_MARKET_DATA_TYPE_ENV_NAMES = [
  "IBKR_TWS_MARKET_DATA_TYPE",
  "IBKR_MARKET_DATA_TYPE",
  "IB_GATEWAY_MARKET_DATA_TYPE",
];

const IBKR_BEARER_TOKEN_ENV_NAMES = [
  "IBKR_OAUTH_TOKEN",
  "IBKR_AUTH_TOKEN",
  "IBKR_BEARER_TOKEN",
];

const IBKR_COOKIE_ENV_NAMES = [
  "IBKR_COOKIE",
  "IBKR_SESSION_COOKIE",
  "CP_GATEWAY_COOKIE",
];

const IBKR_DEFAULT_ACCOUNT_ENV_NAMES = [
  "IBKR_ACCOUNT_ID",
  "IBKR_DEFAULT_ACCOUNT_ID",
];

const IBKR_EXT_OPERATOR_ENV_NAMES = [
  "IBKR_EXT_OPERATOR",
  "IBKR_USERNAME",
];

const IBKR_EXTRA_HEADERS_JSON_ENV_NAMES = ["IBKR_EXTRA_HEADERS_JSON"];
const IBKR_PASSWORD_ENV_NAMES = ["IBKR_PASSWORD"];
const IBKR_ALLOW_INSECURE_TLS_ENV_NAMES = ["IBKR_ALLOW_INSECURE_TLS"];
const IBKR_BRIDGE_URL_ENV_NAMES = [
  "IBKR_BRIDGE_URL",
  "IBKR_BRIDGE_BASE_URL",
];

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getOptionalEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];

    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function hasExplicitMassiveCredentials(): boolean {
  return Boolean(
    (process.env["MASSIVE_API_KEY"] && process.env["MASSIVE_API_KEY"]?.trim()) ||
    (process.env["MASSIVE_MARKET_DATA_API_KEY"] && process.env["MASSIVE_MARKET_DATA_API_KEY"]?.trim()),
  );
}

function hasExplicitPolygonCredentials(): boolean {
  return Boolean(
    (process.env["POLYGON_API_KEY"] && process.env["POLYGON_API_KEY"]?.trim()) ||
    (process.env["POLYGON_KEY"] && process.env["POLYGON_KEY"]?.trim()),
  );
}

function parseExtraHeaders(raw: string | null): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === "string" && value.trim() ? [[key, value.trim()]] : [],
      ),
    );
  } catch {
    return {};
  }
}

function isTruthyEnv(raw: string | null): boolean {
  if (!raw) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function normalizeRuntimeMode(value: string | null): RuntimeMode | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "live") {
    return "live";
  }

  if (normalized === "paper") {
    return "paper";
  }

  return null;
}

function normalizeIbkrTransport(value: string | null): IbkrTransport | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === "client_portal" ||
    normalized === "client-portal" ||
    normalized === "cp" ||
    normalized === "web" ||
    normalized === "web_api"
  ) {
    return "client_portal";
  }

  if (
    normalized === "tws" ||
    normalized === "socket" ||
    normalized === "gateway" ||
    normalized === "ib_gateway" ||
    normalized === "ibgateway"
  ) {
    return "tws";
  }

  return null;
}

function parseIntegerEnv(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getRuntimeMode(): RuntimeMode {
  return process.env["TRADING_MODE"] === "live" ? "live" : "paper";
}

export function getPolygonRuntimeConfig(): PolygonRuntimeConfig | null {
  const apiKey = getOptionalEnv(POLYGON_API_KEY_ENV_NAMES);

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: stripTrailingSlash(
      getOptionalEnv(POLYGON_BASE_URL_ENV_NAMES) ??
        (hasExplicitMassiveCredentials() && !hasExplicitPolygonCredentials()
          ? "https://api.massive.com"
          : "https://api.polygon.io"),
    ),
  };
}

export function getFmpRuntimeConfig(): FmpRuntimeConfig | null {
  const apiKey = getOptionalEnv(FMP_API_KEY_ENV_NAMES);

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: stripTrailingSlash(
      getOptionalEnv(FMP_BASE_URL_ENV_NAMES) ?? "https://financialmodelingprep.com/stable",
    ),
  };
}

export function getIbkrRuntimeConfig(): IbkrRuntimeConfig | null {
  const baseUrl = getOptionalEnv(IBKR_BASE_URL_ENV_NAMES);

  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl: stripTrailingSlash(baseUrl),
    bearerToken: getOptionalEnv(IBKR_BEARER_TOKEN_ENV_NAMES),
    cookie: getOptionalEnv(IBKR_COOKIE_ENV_NAMES),
    defaultAccountId: getOptionalEnv(IBKR_DEFAULT_ACCOUNT_ENV_NAMES),
    extOperator: getOptionalEnv(IBKR_EXT_OPERATOR_ENV_NAMES),
    extraHeaders: parseExtraHeaders(
      getOptionalEnv(IBKR_EXTRA_HEADERS_JSON_ENV_NAMES),
    ),
    username: getOptionalEnv(IBKR_EXT_OPERATOR_ENV_NAMES),
    password: getOptionalEnv(IBKR_PASSWORD_ENV_NAMES),
    allowInsecureTls: isTruthyEnv(
      getOptionalEnv(IBKR_ALLOW_INSECURE_TLS_ENV_NAMES),
    ),
  };
}

export function getIbkrTwsRuntimeConfig(): IbkrTwsRuntimeConfig | null {
  const explicitTransport = normalizeIbkrTransport(
    getOptionalEnv(IBKR_TRANSPORT_ENV_NAMES),
  );
  const host = getOptionalEnv(IBKR_TWS_HOST_ENV_NAMES);
  const port = parseIntegerEnv(getOptionalEnv(IBKR_TWS_PORT_ENV_NAMES));

  if (explicitTransport !== "tws" && !host && port === null) {
    return null;
  }

  const mode =
    normalizeRuntimeMode(getOptionalEnv(IBKR_TWS_MODE_ENV_NAMES)) ??
    getRuntimeMode();
  const marketDataTypeCandidate = parseIntegerEnv(
    getOptionalEnv(IBKR_TWS_MARKET_DATA_TYPE_ENV_NAMES),
  );
  const marketDataType =
    marketDataTypeCandidate === 1 ||
    marketDataTypeCandidate === 2 ||
    marketDataTypeCandidate === 3 ||
    marketDataTypeCandidate === 4
      ? marketDataTypeCandidate
      : 1;

  return {
    host: host ?? "127.0.0.1",
    port: port ?? (mode === "live" ? 4001 : 4002),
    clientId:
      parseIntegerEnv(getOptionalEnv(IBKR_TWS_CLIENT_ID_ENV_NAMES)) ?? 101,
    defaultAccountId: getOptionalEnv(IBKR_DEFAULT_ACCOUNT_ENV_NAMES),
    mode,
    marketDataType,
  };
}

export function getIbkrBridgeProviderRuntimeConfig(): IbkrBridgeProviderRuntimeConfig | null {
  const explicitTransport = normalizeIbkrTransport(
    getOptionalEnv(IBKR_TRANSPORT_ENV_NAMES),
  );

  if (explicitTransport === "tws") {
    const config = getIbkrTwsRuntimeConfig();
    return config ? { transport: "tws", config } : null;
  }

  if (explicitTransport === "client_portal") {
    const config = getIbkrRuntimeConfig();
    return config ? { transport: "client_portal", config } : null;
  }

  const clientPortalConfig = getIbkrRuntimeConfig();
  if (clientPortalConfig) {
    return {
      transport: "client_portal",
      config: clientPortalConfig,
    };
  }

  const twsConfig = getIbkrTwsRuntimeConfig();
  if (twsConfig) {
    return {
      transport: "tws",
      config: twsConfig,
    };
  }

  return null;
}

export function getIbkrBridgeRuntimeConfig(): IbkrBridgeRuntimeConfig | null {
  const baseUrl = getOptionalEnv(IBKR_BRIDGE_URL_ENV_NAMES);

  if (!baseUrl) {
    return {
      baseUrl: "http://127.0.0.1:5002",
    };
  }

  return {
    baseUrl: stripTrailingSlash(baseUrl),
  };
}

export function resolveIbkrMarketDataMode(
  marketDataType: 1 | 2 | 3 | 4,
): IbkrMarketDataMode {
  switch (marketDataType) {
    case 1:
      return "live";
    case 2:
      return "frozen";
    case 3:
      return "delayed";
    case 4:
      return "delayed_frozen";
    default:
      return "unknown";
  }
}

export function isLiveIbkrMarketDataMode(
  mode: IbkrMarketDataMode | null,
): boolean | null {
  if (!mode) {
    return null;
  }

  if (mode === "live" || mode === "frozen") {
    return true;
  }

  if (mode === "delayed" || mode === "delayed_frozen") {
    return false;
  }

  return null;
}

export function getProviderConfiguration() {
  return {
    polygon: Boolean(getPolygonRuntimeConfig()),
    research: Boolean(getFmpRuntimeConfig()),
    ibkr: Boolean(getIbkrBridgeProviderRuntimeConfig()),
  } as const;
}
