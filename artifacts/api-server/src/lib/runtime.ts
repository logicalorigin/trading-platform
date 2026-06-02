import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type RuntimeMode = "paper" | "live";
export type MassiveRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
};
export type MassiveProviderIdentity = "massive";
export type MassiveStocksRecency = "realtime" | "delayed";
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
  {
    transport: "tws";
    config: IbkrTwsRuntimeConfig;
  };
export type IbkrBridgeRuntimeConfig = {
  baseUrl: string;
  apiToken: string | null;
};
export type IbkrBridgeRuntimeOverrideMetadata = {
  bridgeId?: string | null;
  managementTokenHash?: string | null;
};
export type IbkrBridgeRuntimeOverrideSnapshot = IbkrBridgeRuntimeConfig & {
  updatedAt: Date;
  bridgeId: string | null;
  managementTokenHash: string | null;
};
export type IbkrBridgeRuntimeChangeEvent =
  | {
      type: "set";
      override: IbkrBridgeRuntimeOverrideSnapshot;
    }
  | {
      type: "clear";
      override: null;
    };

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

const IGNORED_IBKR_BRIDGE_URL_ENV_NAMES = [
  "IBKR_BASE_URL",
  "IBKR_API_BASE_URL",
  "IB_GATEWAY_URL",
  "IBKR_GATEWAY_URL",
  "IBKR_BRIDGE_URL",
  "IBKR_BRIDGE_BASE_URL",
];
const IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE_ENV_NAMES = [
  "IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
  "PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
];
let ibkrBridgeRuntimeOverride: IbkrBridgeRuntimeOverrideSnapshot | null = null;
let ibkrBridgeRuntimeOverrideLoaded = false;
let ibkrBridgeLegacyRuntimeOverrideFileForTests: string | null = null;
const ibkrBridgeRuntimeChangeListeners = new Set<
  (event: IbkrBridgeRuntimeChangeEvent) => void
>();

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeIbkrBridgeBaseUrl(value: string): string {
  return stripTrailingSlash(value.replace(/\s+/g, ""));
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

function getExplicitIbkrBridgeRuntimeOverrideFile(): string | null {
  return getOptionalEnv(IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE_ENV_NAMES);
}

function getDefaultIbkrBridgeRuntimeOverrideFile(): string {
  const replHome = process.env["REPL_HOME"]?.trim();
  if (replHome) {
    return join(
      replHome,
      "artifacts",
      "api-server",
      "data",
      "ibkr-bridge-runtime-override.json",
    );
  }

  return join(process.cwd(), "data", "ibkr-bridge-runtime-override.json");
}

function getIbkrBridgeRuntimeOverrideFile(): string {
  return (
    getExplicitIbkrBridgeRuntimeOverrideFile() ??
    getDefaultIbkrBridgeRuntimeOverrideFile()
  );
}

function getLegacyIbkrBridgeRuntimeOverrideFile(): string {
  if (ibkrBridgeLegacyRuntimeOverrideFileForTests) {
    return ibkrBridgeLegacyRuntimeOverrideFileForTests;
  }

  return join(tmpdir(), "pyrus", "ibkr-bridge-runtime-override.json");
}

function isDefaultIbkrBridgeRuntimeOverrideFile(): boolean {
  return getExplicitIbkrBridgeRuntimeOverrideFile() === null;
}

function deleteLegacyIbkrBridgeRuntimeOverride(): void {
  try {
    rmSync(getLegacyIbkrBridgeRuntimeOverrideFile(), { force: true });
  } catch {
    // Best effort cleanup; the active persistent file is already authoritative.
  }
}

function cloneIbkrBridgeRuntimeOverride(
  snapshot: IbkrBridgeRuntimeOverrideSnapshot,
): IbkrBridgeRuntimeOverrideSnapshot {
  return {
    ...snapshot,
    updatedAt: new Date(snapshot.updatedAt),
  };
}

function normalizeIbkrBridgeRuntimeConfig(
  config: IbkrBridgeRuntimeConfig,
  updatedAt = new Date(),
  metadata: IbkrBridgeRuntimeOverrideMetadata = {},
): IbkrBridgeRuntimeOverrideSnapshot {
  return {
    baseUrl: normalizeIbkrBridgeBaseUrl(config.baseUrl),
    apiToken: config.apiToken,
    updatedAt,
    bridgeId: metadata.bridgeId ?? null,
    managementTokenHash: metadata.managementTokenHash ?? null,
  };
}

function readIbkrBridgeRuntimeOverrideFile(
  path: string,
): IbkrBridgeRuntimeOverrideSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) {
      return null;
    }

    const apiToken =
      typeof record.apiToken === "string" && record.apiToken.trim()
        ? record.apiToken.trim()
        : null;
    const updatedAt =
      typeof record.updatedAt === "string" || record.updatedAt instanceof Date
        ? new Date(record.updatedAt)
        : new Date();

    return normalizeIbkrBridgeRuntimeConfig(
      {
        baseUrl: record.baseUrl,
        apiToken,
      },
      Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt,
      {
        bridgeId:
          typeof record.bridgeId === "string" && record.bridgeId.trim()
            ? record.bridgeId.trim()
            : typeof record.activationId === "string" &&
                record.activationId.trim()
              ? record.activationId.trim()
            : null,
        managementTokenHash:
          typeof record.managementTokenHash === "string" &&
          record.managementTokenHash.trim()
            ? record.managementTokenHash.trim()
            : null,
      },
    );
  } catch {
    return null;
  }
}

function readPersistedIbkrBridgeRuntimeOverride(): IbkrBridgeRuntimeOverrideSnapshot | null {
  const path = getIbkrBridgeRuntimeOverrideFile();
  const currentFileExists = existsSync(path);
  const current = readIbkrBridgeRuntimeOverrideFile(path);
  if (current || currentFileExists || !isDefaultIbkrBridgeRuntimeOverrideFile()) {
    return current;
  }

  const legacy = readIbkrBridgeRuntimeOverrideFile(
    getLegacyIbkrBridgeRuntimeOverrideFile(),
  );
  if (!legacy) {
    return null;
  }

  try {
    persistIbkrBridgeRuntimeOverride(legacy);
    deleteLegacyIbkrBridgeRuntimeOverride();
  } catch {
    return legacy;
  }

  return legacy;
}

function loadIbkrBridgeRuntimeOverride(): IbkrBridgeRuntimeOverrideSnapshot | null {
  if (!ibkrBridgeRuntimeOverrideLoaded) {
    ibkrBridgeRuntimeOverride =
      ibkrBridgeRuntimeOverride ?? readPersistedIbkrBridgeRuntimeOverride();
    ibkrBridgeRuntimeOverrideLoaded = true;
  }

  return ibkrBridgeRuntimeOverride;
}

function persistIbkrBridgeRuntimeOverride(
  snapshot: IbkrBridgeRuntimeOverrideSnapshot,
): void {
  const path = getIbkrBridgeRuntimeOverrideFile();
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(
      tempPath,
      JSON.stringify(
        {
          version: 1,
          baseUrl: snapshot.baseUrl,
          apiToken: snapshot.apiToken,
          bridgeId: snapshot.bridgeId,
          managementTokenHash: snapshot.managementTokenHash,
          updatedAt: snapshot.updatedAt.toISOString(),
        },
        null,
        2,
      ),
      {
        mode: 0o600,
      },
    );
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

function notifyIbkrBridgeRuntimeChanged(
  event: IbkrBridgeRuntimeChangeEvent,
): void {
  for (const listener of ibkrBridgeRuntimeChangeListeners) {
    try {
      listener(event);
    } catch {
      // Runtime attach/detach must not fail because a stream wake-up failed.
    }
  }
}

export function onIbkrBridgeRuntimeChanged(
  listener: (event: IbkrBridgeRuntimeChangeEvent) => void,
): () => void {
  ibkrBridgeRuntimeChangeListeners.add(listener);
  return () => {
    ibkrBridgeRuntimeChangeListeners.delete(listener);
  };
}

export function __setIbkrBridgeLegacyRuntimeOverrideFileForTests(
  path: string | null,
): void {
  ibkrBridgeLegacyRuntimeOverrideFileForTests = path;
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

export function getRuntimeMode(): RuntimeMode {
  return process.env["TRADING_MODE"] === "live" ? "live" : "paper";
}

export function getMassiveRuntimeConfig(): MassiveRuntimeConfig | null {
  const apiKey = getOptionalEnv(MASSIVE_API_KEY_ENV_NAMES);

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: stripTrailingSlash(
      getOptionalEnv(MASSIVE_API_BASE_URL_ENV_NAMES) ?? "https://api.massive.com",
    ),
  };
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
  const normalized = (process.env["MASSIVE_STOCKS_RECENCY"] ?? "")
    .trim()
    .toLowerCase();
  return normalized === "delayed" ? "delayed" : "realtime";
}

export function isMassiveStocksRealtimeConfigured(
  config: MassiveRuntimeConfig | null = getMassiveRuntimeConfig(),
): boolean {
  return (
    getMassiveProviderIdentity(config) === "massive" &&
    getMassiveStocksRecency() === "realtime"
  );
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

export function getIbkrTwsRuntimeConfig(): IbkrTwsRuntimeConfig | null {
  const explicitTransport = normalizeIbkrTransport(
    getOptionalEnv(IBKR_TRANSPORT_ENV_NAMES),
  );
  const host = getOptionalEnv(IBKR_TWS_HOST_ENV_NAMES);
  const port = parseIntegerEnv(getOptionalEnv(IBKR_TWS_PORT_ENV_NAMES));

  if (explicitTransport !== "tws") {
    return null;
  }

  const mode =
    normalizeRuntimeMode(getOptionalEnv(IBKR_TWS_MODE_ENV_NAMES)) ??
    "live";
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

  if (explicitTransport !== "tws") {
    return null;
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
  const override = loadIbkrBridgeRuntimeOverride();

  if (override) {
    return {
      baseUrl: override.baseUrl,
      apiToken: override.apiToken,
    };
  }

  return null;
}

export function getIgnoredIbkrBridgeRuntimeEnvNames(): string[] {
  return IGNORED_IBKR_BRIDGE_URL_ENV_NAMES.filter((name) =>
    Boolean(process.env[name]?.trim()),
  );
}

export function setIbkrBridgeRuntimeOverride(
  config: IbkrBridgeRuntimeConfig,
  metadata: IbkrBridgeRuntimeOverrideMetadata = {},
): IbkrBridgeRuntimeOverrideSnapshot {
  const nextOverride = normalizeIbkrBridgeRuntimeConfig(
    config,
    new Date(),
    metadata,
  );
  persistIbkrBridgeRuntimeOverride(nextOverride);
  ibkrBridgeRuntimeOverride = nextOverride;
  ibkrBridgeRuntimeOverrideLoaded = true;
  notifyIbkrBridgeRuntimeChanged({
    type: "set",
    override: cloneIbkrBridgeRuntimeOverride(nextOverride),
  });

  return ibkrBridgeRuntimeOverride;
}

export function clearIbkrBridgeRuntimeOverride(
  options: { deletePersisted?: boolean } = {},
): void {
  if (options.deletePersisted !== false) {
    rmSync(getIbkrBridgeRuntimeOverrideFile(), { force: true });
    if (isDefaultIbkrBridgeRuntimeOverrideFile()) {
      deleteLegacyIbkrBridgeRuntimeOverride();
    }
    ibkrBridgeRuntimeOverride = null;
    ibkrBridgeRuntimeOverrideLoaded = true;
    notifyIbkrBridgeRuntimeChanged({ type: "clear", override: null });
    return;
  }

  ibkrBridgeRuntimeOverride = null;
  ibkrBridgeRuntimeOverrideLoaded = false;
}

export function getIbkrBridgeRuntimeOverride(): IbkrBridgeRuntimeOverrideSnapshot | null {
  const override = loadIbkrBridgeRuntimeOverride();
  return override
    ? { ...override, updatedAt: new Date(override.updatedAt) }
    : null;
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
    ibkr: Boolean(getIbkrBridgeRuntimeConfig()),
  } as const;
}
