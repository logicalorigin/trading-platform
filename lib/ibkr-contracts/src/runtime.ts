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

export type IbkrBridgeProviderRuntimeConfig = {
  transport: "tws";
  config: IbkrTwsRuntimeConfig;
};

export type IbkrBridgeRuntimeConfig = {
  baseUrl: string;
  apiToken: string | null;
};

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
const IBKR_DEFAULT_ACCOUNT_ENV_NAMES = [
  "IBKR_ACCOUNT_ID",
  "IBKR_DEFAULT_ACCOUNT_ID",
];

function getOptionalEnv(
  names: string[],
  env: Record<string, string | undefined>,
): string | null {
  for (const name of names) {
    const value = env[name];

    if (value && value.trim()) {
      return value.trim();
    }
  }

  return null;
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
    return null;
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

export function getRuntimeMode(
  env: Record<string, string | undefined> = process.env,
): RuntimeMode {
  return env["TRADING_MODE"] === "live" ? "live" : "paper";
}

export function getIbkrTwsRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): IbkrTwsRuntimeConfig | null {
  const explicitTransport = normalizeIbkrTransport(
    getOptionalEnv(IBKR_TRANSPORT_ENV_NAMES, env),
  );
  const host = getOptionalEnv(IBKR_TWS_HOST_ENV_NAMES, env);
  const port = parseIntegerEnv(getOptionalEnv(IBKR_TWS_PORT_ENV_NAMES, env));

  if (explicitTransport !== "tws") {
    return null;
  }

  const mode =
    normalizeRuntimeMode(getOptionalEnv(IBKR_TWS_MODE_ENV_NAMES, env)) ??
    "live";
  const marketDataTypeCandidate = parseIntegerEnv(
    getOptionalEnv(IBKR_TWS_MARKET_DATA_TYPE_ENV_NAMES, env),
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
      parseIntegerEnv(getOptionalEnv(IBKR_TWS_CLIENT_ID_ENV_NAMES, env)) ?? 101,
    defaultAccountId: getOptionalEnv(IBKR_DEFAULT_ACCOUNT_ENV_NAMES, env),
    mode,
    marketDataType,
  };
}

export function getIbkrBridgeProviderRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): IbkrBridgeProviderRuntimeConfig | null {
  const explicitTransport = normalizeIbkrTransport(
    getOptionalEnv(IBKR_TRANSPORT_ENV_NAMES, env),
  );

  if (explicitTransport !== "tws") {
    return null;
  }

  const twsConfig = getIbkrTwsRuntimeConfig(env);
  if (twsConfig) {
    return {
      transport: "tws",
      config: twsConfig,
    };
  }

  return null;
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
