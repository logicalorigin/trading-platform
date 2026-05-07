import {
  getBridgeLaneOverrides,
  setBridgeLaneOverrideSection,
} from "./lane-overrides";

export type BridgeRuntimeLimitKey =
  | "tickleIntervalMs"
  | "historicalReconnectMaxRetries"
  | "maxLiveEquityLines"
  | "maxLiveOptionLines"
  | "maxMarketDataLines"
  | "optionQuoteVisibleContractLimit"
  | "genericTickSampleMs"
  | "connectTimeoutMs"
  | "openOrdersRequestTimeoutMs";

export type BridgeRuntimeLimitSource = "default" | "env" | "override";

export type BridgeRuntimeLimitMetadata = {
  envName: string;
  defaultValue: number;
  min: number;
  max: number;
  description: string;
};

export type BridgeRuntimeLimitSnapshot = Record<
  BridgeRuntimeLimitKey,
  BridgeRuntimeLimitMetadata & {
    value: number;
    override?: number;
    source: BridgeRuntimeLimitSource;
  }
>;

export const BRIDGE_RUNTIME_LIMITS: Record<
  BridgeRuntimeLimitKey,
  BridgeRuntimeLimitMetadata
> = {
  tickleIntervalMs: {
    envName: "IBKR_BRIDGE_TICKLE_INTERVAL_MS",
    defaultValue: 55_000,
    min: 10_000,
    max: 300_000,
    description: "Bridge keepalive tickle interval.",
  },
  historicalReconnectMaxRetries: {
    envName: "IBKR_HISTORICAL_RECONNECT_MAX_RETRIES",
    defaultValue: 1,
    min: 0,
    max: 5,
    description: "Historical data reconnect retries before failing a request.",
  },
  maxLiveEquityLines: {
    envName: "IBKR_MAX_LIVE_EQUITY_LINES",
    defaultValue: 90,
    min: 0,
    max: 500,
    description: "Dedicated live equity quote line budget. Zero uses total budget.",
  },
  maxLiveOptionLines: {
    envName: "IBKR_MAX_LIVE_OPTION_LINES",
    defaultValue: 100,
    min: 0,
    max: 500,
    description: "Dedicated live option quote line budget. Zero uses visible option limit.",
  },
  maxMarketDataLines: {
    envName: "IBKR_MAX_MARKET_DATA_LINES",
    defaultValue: 190,
    min: 1,
    max: 500,
    description: "Total live market data line budget used by bridge subscriptions.",
  },
  optionQuoteVisibleContractLimit: {
    envName: "OPTION_QUOTES_VISIBLE_CONTRACT_LIMIT",
    defaultValue: 100,
    min: 1,
    max: 500,
    description: "Maximum option contracts kept visible for quote hydration.",
  },
  genericTickSampleMs: {
    envName: "IBKR_GENERIC_TICK_SAMPLE_MS",
    defaultValue: 500,
    min: 100,
    max: 10_000,
    description: "Generic tick quote sampling window.",
  },
  connectTimeoutMs: {
    envName: "IBKR_TWS_CONNECT_TIMEOUT_MS",
    defaultValue: 30_000,
    min: 1_000,
    max: 120_000,
    description: "TWS socket connect timeout.",
  },
  openOrdersRequestTimeoutMs: {
    envName: "IBKR_OPEN_ORDERS_REQUEST_TIMEOUT_MS",
    defaultValue: 4_000,
    min: 500,
    max: 60_000,
    description: "Open orders request timeout.",
  },
};

function isLimitKey(key: string): key is BridgeRuntimeLimitKey {
  return Object.prototype.hasOwnProperty.call(BRIDGE_RUNTIME_LIMITS, key);
}

function clampLimit(key: BridgeRuntimeLimitKey, value: number): number {
  const metadata = BRIDGE_RUNTIME_LIMITS[key];
  return Math.min(metadata.max, Math.max(metadata.min, Math.floor(value)));
}

function readEnvLimit(
  key: BridgeRuntimeLimitKey,
): { value: number; source: BridgeRuntimeLimitSource } {
  const metadata = BRIDGE_RUNTIME_LIMITS[key];
  const parsed = Number.parseInt(process.env[metadata.envName] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return { value: metadata.defaultValue, source: "default" };
  }
  return { value: clampLimit(key, parsed), source: "env" };
}

export function getBridgeRuntimeLimit(key: BridgeRuntimeLimitKey): number {
  const override = getBridgeLaneOverrides().limits?.[key];
  if (Number.isFinite(override)) {
    return clampLimit(key, Number(override));
  }
  return readEnvLimit(key).value;
}

export function getBridgeRuntimeLimitSnapshot(): BridgeRuntimeLimitSnapshot {
  const overrides = getBridgeLaneOverrides().limits ?? {};
  return Object.fromEntries(
    (Object.keys(BRIDGE_RUNTIME_LIMITS) as BridgeRuntimeLimitKey[]).map((key) => {
      const envValue = readEnvLimit(key);
      const override = overrides[key];
      const hasOverride = Number.isFinite(override);
      return [
        key,
        {
          ...BRIDGE_RUNTIME_LIMITS[key],
          value: hasOverride ? clampLimit(key, Number(override)) : envValue.value,
          override: hasOverride ? clampLimit(key, Number(override)) : undefined,
          source: hasOverride ? "override" : envValue.source,
        },
      ];
    }),
  ) as BridgeRuntimeLimitSnapshot;
}

export function getBridgeRuntimeLimitOverrides(): Partial<
  Record<BridgeRuntimeLimitKey, number>
> {
  return { ...(getBridgeLaneOverrides().limits ?? {}) } as Partial<
    Record<BridgeRuntimeLimitKey, number>
  >;
}

export function setBridgeRuntimeLimitOverrides(
  overrides: Partial<Record<BridgeRuntimeLimitKey, number | null | undefined>>,
): void {
  const current = { ...(getBridgeLaneOverrides().limits ?? {}) };
  Object.entries(overrides).forEach(([key, rawValue]) => {
    if (!isLimitKey(key)) {
      return;
    }
    if (rawValue === null || rawValue === undefined) {
      delete current[key];
      return;
    }
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      delete current[key];
      return;
    }
    current[key] = clampLimit(key, parsed);
  });
  setBridgeLaneOverrideSection(
    "limits",
    Object.keys(current).length > 0 ? current : undefined,
  );
}

export function resetBridgeRuntimeLimitOverrides(
  keys?: BridgeRuntimeLimitKey[],
): void {
  if (!keys || keys.length === 0) {
    setBridgeLaneOverrideSection("limits", undefined);
    return;
  }

  const current = { ...(getBridgeLaneOverrides().limits ?? {}) };
  keys.forEach((key) => {
    delete current[key];
  });
  setBridgeLaneOverrideSection(
    "limits",
    Object.keys(current).length > 0 ? current : undefined,
  );
}
