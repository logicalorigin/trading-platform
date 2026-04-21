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
  "IBKR_API_BASE_URL",
  "IB_GATEWAY_URL",
  "IBKR_GATEWAY_URL",
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
  };
}

export function getProviderConfiguration() {
  return {
    polygon: Boolean(getPolygonRuntimeConfig()),
    research: Boolean(getFmpRuntimeConfig()),
    ibkr: Boolean(getIbkrRuntimeConfig()),
  } as const;
}
