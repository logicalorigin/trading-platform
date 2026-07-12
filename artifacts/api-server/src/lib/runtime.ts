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
export type IbkrBridgeRuntimeConfig = {
  baseUrl: string;
  apiToken: string | null;
};
export type IbkrBridgeRuntimeOverrideMetadata = {
  bridgeId?: string | null;
  managementTokenHash?: string | null;
  // Epoch ms when the user INTENTIONALLY stopped this bridge (Shutdown). Persisted
  // so an intentionally-stopped bridge is never auto-revived by self-heal, even
  // across an api-server restart (the in-memory shutdown job is lost; the file is not).
  // Null/absent => not intentionally stopped (a crash/tunnel-drop is healable).
  stopRequestedAt?: number | null;
};
export type IbkrBridgeRuntimeOverrideSnapshot = IbkrBridgeRuntimeConfig & {
  updatedAt: Date;
  bridgeId: string | null;
  managementTokenHash: string | null;
  stopRequestedAt: number | null;
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
const IBKR_USERNAME_ENV_NAMES = ["IBKR_USERNAME", "IBKR_CLIENT_PORTAL_USERNAME"];
const IBKR_PASSWORD_ENV_NAMES = ["IBKR_PASSWORD", "IBKR_CLIENT_PORTAL_PASSWORD"];

const IGNORED_IBKR_BRIDGE_URL_ENV_NAMES = [
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
    stopRequestedAt: metadata.stopRequestedAt ?? null,
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
        // Legacy (version 1) files have no stopRequestedAt — treat as not-stopped.
        stopRequestedAt:
          typeof record.stopRequestedAt === "number" &&
          Number.isFinite(record.stopRequestedAt)
            ? record.stopRequestedAt
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
          version: 2,
          baseUrl: snapshot.baseUrl,
          apiToken: snapshot.apiToken,
          bridgeId: snapshot.bridgeId,
          managementTokenHash: snapshot.managementTokenHash,
          stopRequestedAt: snapshot.stopRequestedAt,
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
    username: getOptionalEnv(IBKR_USERNAME_ENV_NAMES),
    password: getOptionalEnv(IBKR_PASSWORD_ENV_NAMES),
    allowInsecureTls: parseBooleanEnv(
      process.env["IBKR_ALLOW_INSECURE_TLS"] ?? null,
    ),
  };
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

/**
 * Durably stamp the override as INTENTIONALLY stopped (user Shutdown). Persisted so
 * self-heal never revives it across an api-server restart. No-op when there is no
 * override (Detach already deleted the file). A subsequent successful attach via
 * setIbkrBridgeRuntimeOverride writes fresh metadata, clearing stopRequestedAt.
 */
export function markIbkrBridgeRuntimeStopRequested(
  now: number = Date.now(),
): IbkrBridgeRuntimeOverrideSnapshot | null {
  const current = loadIbkrBridgeRuntimeOverride();
  if (!current) {
    return null;
  }
  const nextOverride: IbkrBridgeRuntimeOverrideSnapshot = {
    ...current,
    updatedAt: new Date(),
    stopRequestedAt: now,
  };
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
    ibkr: Boolean(getIbkrRuntimeConfig()),
  } as const;
}
