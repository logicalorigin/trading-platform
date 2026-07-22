export type RuntimeMode = "shadow" | "live";
export type MassiveRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
};
export type MassiveProviderIdentity = "massive";
export type MassiveStocksRecency = "realtime" | "delayed";
export type MassiveOptionsRecency = "realtime" | "delayed";
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
  paperAccountOnly?: boolean;
};
export type IbkrMarketDataMode =
  | "live"
  | "frozen"
  | "delayed"
  | "delayed_frozen"
  | "unknown";

const MASSIVE_API_KEY_ENV_NAMES = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
];

const MASSIVE_API_BASE_URL_ENV_NAMES = [
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

const IBKR_CLIENT_PORTAL_BASE_URL_ENV_NAMES = [
  "IBKR_CLIENT_PORTAL_BASE_URL",
  "IBKR_CLIENT_PORTAL_URL",
  "IBKR_BASE_URL",
  "IBKR_API_BASE_URL",
  "IB_GATEWAY_URL",
  "IBKR_GATEWAY_URL",
];
const IBKR_BEARER_TOKEN_ENV_NAMES = [
  "IBKR_BEARER_TOKEN",
  "IBKR_ACCESS_TOKEN",
  "IBKR_API_TOKEN",
];
const IBKR_COOKIE_ENV_NAMES = [
  "IBKR_COOKIE",
  "IBKR_CLIENT_PORTAL_COOKIE",
  "IBKR_SESSION_COOKIE",
];
const IBKR_DEFAULT_ACCOUNT_ENV_NAMES = [
  "IBKR_ACCOUNT_ID",
  "IBKR_DEFAULT_ACCOUNT_ID",
];
const IBKR_EXT_OPERATOR_ENV_NAMES = ["IBKR_EXT_OPERATOR"];

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

function parseBooleanEnv(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function getRuntimeMode(): RuntimeMode {
  return process.env["TRADING_MODE"] === "live" ? "live" : "shadow";
}

// Provider configs derive only from immutable provider env (API key + base
// URL), but are re-resolved per stock-aggregate fetch on the hot path
// (getCurrentStockMinuteAggregates → getPreferredStockAggregateStreamSource).
// Memoize the env read once per process; reset hook provided for tests.
let massiveRuntimeConfigCache: MassiveRuntimeConfig | null | undefined;
let fmpRuntimeConfigCache: FmpRuntimeConfig | null | undefined;
let massiveStocksRecencyCache: MassiveStocksRecency | undefined;
let massiveOptionsRecencyCache: MassiveOptionsRecency | undefined;

export function __resetProviderRuntimeConfigCacheForTests(): void {
  massiveRuntimeConfigCache = undefined;
  fmpRuntimeConfigCache = undefined;
  massiveStocksRecencyCache = undefined;
  massiveOptionsRecencyCache = undefined;
}

export function getMassiveRuntimeConfig(): MassiveRuntimeConfig | null {
  if (massiveRuntimeConfigCache !== undefined) {
    return massiveRuntimeConfigCache;
  }

  const apiKey = getOptionalEnv(MASSIVE_API_KEY_ENV_NAMES);

  massiveRuntimeConfigCache = apiKey
    ? {
        apiKey,
        baseUrl: stripTrailingSlash(
          getOptionalEnv(MASSIVE_API_BASE_URL_ENV_NAMES) ??
            "https://api.massive.com",
        ),
      }
    : null;

  return massiveRuntimeConfigCache;
}

export function getMassiveProviderIdentity(
  config: MassiveRuntimeConfig | null = getMassiveRuntimeConfig(),
): MassiveProviderIdentity | null {
  if (!config) {
    return null;
  }
  return "massive";
}

export function getMassiveStocksRecency(): MassiveStocksRecency {
  if (massiveStocksRecencyCache !== undefined) {
    return massiveStocksRecencyCache;
  }

  const normalized = (process.env["MASSIVE_STOCKS_RECENCY"] ?? "")
    .trim()
    .toLowerCase();
  massiveStocksRecencyCache =
    normalized === "delayed" ? "delayed" : "realtime";
  return massiveStocksRecencyCache;
}

export function isMassiveStocksRealtimeConfigured(
  config: MassiveRuntimeConfig | null = getMassiveRuntimeConfig(),
): boolean {
  return (
    getMassiveProviderIdentity(config) === "massive" &&
    getMassiveStocksRecency() === "realtime"
  );
}

export function getMassiveOptionsRecency(): MassiveOptionsRecency {
  if (massiveOptionsRecencyCache !== undefined) {
    return massiveOptionsRecencyCache;
  }

  const normalized = (process.env["MASSIVE_OPTIONS_RECENCY"] ?? "")
    .trim()
    .toLowerCase();
  massiveOptionsRecencyCache =
    normalized === "delayed" ? "delayed" : "realtime";
  return massiveOptionsRecencyCache;
}

export function isMassiveOptionsRealtimeConfigured(
  config: MassiveRuntimeConfig | null = getMassiveRuntimeConfig(),
): boolean {
  return (
    getMassiveProviderIdentity(config) === "massive" &&
    getMassiveOptionsRecency() === "realtime"
  );
}

export function getFmpRuntimeConfig(): FmpRuntimeConfig | null {
  if (fmpRuntimeConfigCache !== undefined) {
    return fmpRuntimeConfigCache;
  }

  const apiKey = getOptionalEnv(FMP_API_KEY_ENV_NAMES);

  fmpRuntimeConfigCache = apiKey
    ? {
        apiKey,
        baseUrl: stripTrailingSlash(
          getOptionalEnv(FMP_BASE_URL_ENV_NAMES) ??
            "https://financialmodelingprep.com/stable",
        ),
      }
    : null;

  return fmpRuntimeConfigCache;
}

export function getIbkrRuntimeConfig(): IbkrRuntimeConfig | null {
  const baseUrl = getOptionalEnv(IBKR_CLIENT_PORTAL_BASE_URL_ENV_NAMES);
  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl: stripTrailingSlash(baseUrl),
    bearerToken: getOptionalEnv(IBKR_BEARER_TOKEN_ENV_NAMES),
    cookie: getOptionalEnv(IBKR_COOKIE_ENV_NAMES),
    defaultAccountId: getOptionalEnv(IBKR_DEFAULT_ACCOUNT_ENV_NAMES),
    extOperator: getOptionalEnv(IBKR_EXT_OPERATOR_ENV_NAMES),
    extraHeaders: {},
    username: null,
    password: null,
    allowInsecureTls: parseBooleanEnv(
      process.env["IBKR_ALLOW_INSECURE_TLS"] ?? null,
    ),
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
  const massiveConfig = getMassiveRuntimeConfig();
  return {
    massive: Boolean(massiveConfig),
    research: Boolean(getFmpRuntimeConfig()),
    ibkr: Boolean(getIbkrRuntimeConfig()),
  } as const;
}
