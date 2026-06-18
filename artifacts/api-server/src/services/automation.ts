import {
  algoDeploymentsTable,
  algoStrategiesTable,
  db,
  executionEventsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  createTransientPostgresBackoff,
  isPoolContentionError,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { assertAlgoGatewayReady } from "./algo-gateway";
import { normalizeAlgoDeploymentProviderAccountId } from "./algo-deployment-account";
import {
  normalizeLegacyAlgoBranding,
  normalizeLegacyAlgoBrandText,
} from "./algo-branding";
import {
  getSignalMonitorProfile,
  updateSignalMonitorProfile,
} from "./signal-monitor";
import { notifyAlgoCockpitChanged } from "./algo-cockpit-events";
import {
  ensureDefaultSignalOptionsPaperDeployment,
  invalidateSignalOptionsDashboardCaches,
} from "./signal-options-automation";

type CreateAlgoDeploymentInput = {
  strategyId: string;
  name: string;
  providerAccountId: string;
  mode: "paper" | "live";
  symbolUniverse?: string[];
  config?: Record<string, unknown>;
};

type ListAlgoDeploymentsInput = {
  mode?: "paper" | "live";
};

type ListExecutionEventsInput = {
  deploymentId?: string;
  limit?: number;
  includePayload?: boolean;
};

const STRATEGY_SIGNAL_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"] as const;
const PYRUS_SIGNALS_BOS_CONFIRMATIONS = ["close", "wicks"] as const;
const RETIRED_SHADOW_EQUITY_FORWARD_EXECUTION_MODE = "signal_equity_shadow";
const DEFAULT_SIGNAL_OPTIONS_DEPLOYMENT_NAME =
  "Pyrus Signals Options Shadow Paper";
const LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME = "Pyrus Signals Shadow Paper";
const deploymentListDbBackoff = createTransientPostgresBackoff({
  backoffMs: 15_000,
  warningCooldownMs: 60_000,
});

type AlgoDeploymentRow = typeof algoDeploymentsTable.$inferSelect;
type AlgoDeploymentListResponse = {
  deployments: ReturnType<typeof deploymentToResponse>[];
  cacheStatus?: "hit" | "stale" | "unavailable";
};

type DeploymentListCacheEntry = {
  response: AlgoDeploymentListResponse;
  mode?: "paper" | "live";
  updatedAtMs: number;
};

const deploymentListCache = new Map<string, DeploymentListCacheEntry>();
const deploymentListInFlight = new Map<
  string,
  Promise<AlgoDeploymentListResponse>
>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function getStrategyOrThrow(strategyId: string) {
  const [strategy] = await db
    .select()
    .from(algoStrategiesTable)
    .where(eq(algoStrategiesTable.id, strategyId))
    .limit(1);

  if (!strategy) {
    throw new HttpError(404, "Algorithm strategy not found.", {
      code: "algo_strategy_not_found",
    });
  }

  return strategy;
}

async function getDeploymentOrThrow(deploymentId: string) {
  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, deploymentId))
    .limit(1);

  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }

  if (isRetiredShadowEquityForwardDeployment(deployment)) {
    throw new HttpError(410, "Retired shadow equity forward deployments are disabled.", {
      code: "retired_algo_deployment_disabled",
      expose: true,
    });
  }

  return deployment;
}

export async function getAlgoDeploymentForExecution(input: {
  deploymentId: string;
}) {
  return getDeploymentOrThrow(input.deploymentId);
}

function readTimeHorizon(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "Invalid time horizon.", {
      code: "algo_strategy_time_horizon_invalid",
      detail: "timeHorizon must be a number from 2 through 50.",
      expose: true,
    });
  }
  const horizon = Math.round(parsed);
  if (horizon < 2 || horizon > 50) {
    throw new HttpError(400, "Invalid time horizon.", {
      code: "algo_strategy_time_horizon_invalid",
      detail: "timeHorizon must be a number from 2 through 50.",
      expose: true,
    });
  }
  return horizon;
}

function readSignalTimeframe(value: unknown): string {
  const timeframe = String(value || "").trim();
  if (!STRATEGY_SIGNAL_TIMEFRAMES.includes(timeframe as never)) {
    throw new HttpError(400, "Unsupported signal timeframe.", {
      code: "algo_strategy_timeframe_invalid",
      detail: `Use one of ${STRATEGY_SIGNAL_TIMEFRAMES.join(", ")}.`,
      expose: true,
    });
  }
  return timeframe;
}

function readOptionalBosConfirmation(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const confirmation = String(value || "").trim();
  if (!PYRUS_SIGNALS_BOS_CONFIRMATIONS.includes(confirmation as never)) {
    throw new HttpError(400, "Unsupported BOS confirmation.", {
      code: "algo_strategy_bos_confirmation_invalid",
      detail: `Use one of ${PYRUS_SIGNALS_BOS_CONFIRMATIONS.join(", ")}.`,
      expose: true,
    });
  }
  return confirmation;
}

function readOptionalPyrusSignalsNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 20) {
    throw new HttpError(400, "Invalid Pyrus Signals setting.", {
      code: "algo_strategy_pyrus_signals_setting_invalid",
      detail: `${field} must be a number from 0 through 20.`,
      expose: true,
    });
  }
  return parsed;
}

function deploymentToResponse(
  deployment: typeof algoDeploymentsTable.$inferSelect,
) {
  return {
    id: deployment.id,
    strategyId: deployment.strategyId,
    name: normalizeLegacyAlgoBrandText(deployment.name),
    mode: deployment.mode,
    enabled: deployment.enabled,
    providerAccountId: deployment.providerAccountId,
    symbolUniverse: deployment.symbolUniverse,
    config: normalizeLegacyAlgoBranding(deployment.config),
    lastEvaluatedAt: deployment.lastEvaluatedAt ?? null,
    lastSignalAt: deployment.lastSignalAt ?? null,
    lastError: deployment.lastError ?? null,
    createdAt: deployment.createdAt,
    updatedAt: deployment.updatedAt,
  };
}

function isRetiredShadowEquityForwardDeployment(
  deployment: typeof algoDeploymentsTable.$inferSelect,
) {
  return isRetiredShadowEquityForwardConfig(deployment.config);
}

function isRetiredShadowEquityForwardConfig(configValue: unknown) {
  const config = asRecord(configValue);
  const parameters = asRecord(config.parameters);
  return parameters.executionMode === RETIRED_SHADOW_EQUITY_FORWARD_EXECUTION_MODE;
}

function deploymentHasSignalOptionsProfile(
  deployment: Pick<AlgoDeploymentRow, "config" | "name">,
) {
  const config = asRecord(deployment.config);
  const parameters = asRecord(config.parameters);
  const signalOptions = asRecord(config.signalOptions);
  const deploymentName = normalizeLegacyAlgoBrandText(deployment.name);
  return Boolean(
    Object.keys(signalOptions).length > 0 ||
      parameters.executionMode === "signal_options" ||
      config.source === "default_signal_options_seed" ||
      deploymentName === DEFAULT_SIGNAL_OPTIONS_DEPLOYMENT_NAME ||
      deploymentName === LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME,
  );
}

function visibleDeploymentRows(rows: AlgoDeploymentRow[]) {
  return rows.filter(
    (deployment) => !isRetiredShadowEquityForwardDeployment(deployment),
  );
}

function buildDeploymentListResponse(
  rows: AlgoDeploymentRow[],
): AlgoDeploymentListResponse {
  return {
    deployments: visibleDeploymentRows(rows).map(deploymentToResponse),
  };
}

function readDeploymentListCache(
  input: ListAlgoDeploymentsInput,
): AlgoDeploymentListResponse | null {
  const exact = deploymentListCache.get(deploymentListKey(input));
  if (exact) {
    return {
      ...exact.response,
      cacheStatus: "stale",
    };
  }

  if (input.mode) {
    const allDeployments = deploymentListCache.get(deploymentListKey({}));
    if (allDeployments) {
      return {
        ...allDeployments.response,
        deployments: allDeployments.response.deployments.filter(
          (deployment) => deployment.mode === input.mode,
        ),
        cacheStatus: "stale",
      };
    }
  }

  return null;
}

function rememberDeploymentListCache(
  input: ListAlgoDeploymentsInput,
  response: AlgoDeploymentListResponse,
) {
  deploymentListCache.set(deploymentListKey(input), {
    mode: input.mode,
    response,
    updatedAtMs: Date.now(),
  });
}

// Keep the in-memory deployment-list cache coherent with a single mutated
// deployment. The cache is served as the pool-contention fallback (see
// listAlgoDeployments / deploymentListFallback); without this, a save updates
// the DB but the fallback keeps returning the pre-save deployment, so the algo
// controls render stale "old" inputs (and a "deployment unavailable" window
// never reflects the new value) until a later uncontended read overwrites the
// cache. Write-through (not invalidate) so the fallback stays both useful and
// fresh under contention. Patches the "all" entry and the deployment's
// mode-keyed entry; a retired deployment is removed instead of inserted.
export function applyDeploymentToListCache(deployment: AlgoDeploymentRow) {
  const response =
    visibleDeploymentRows([deployment]).length > 0
      ? deploymentToResponse(deployment)
      : null;
  for (const key of ["all", deployment.mode]) {
    const entry = deploymentListCache.get(key);
    if (!entry) {
      continue;
    }
    const deployments = entry.response.deployments.filter(
      (existing) => existing.id !== deployment.id,
    );
    if (response) {
      deployments.unshift(response);
    }
    deploymentListCache.set(key, {
      ...entry,
      response: { ...entry.response, deployments },
      updatedAtMs: Date.now(),
    });
  }
}

function clearDeploymentListCacheForTests() {
  deploymentListCache.clear();
}

function shouldEnsureDefaultSignalOptionsDeployment(
  input: ListAlgoDeploymentsInput,
  rows: AlgoDeploymentRow[],
) {
  if (input.mode === "live") {
    return false;
  }
  return !visibleDeploymentRows(rows).some(deploymentHasSignalOptionsProfile);
}

function deploymentListKey(input: ListAlgoDeploymentsInput) {
  return input.mode ?? "all";
}

const deploymentListFallback = (input: ListAlgoDeploymentsInput) =>
  readDeploymentListCache(input);

async function loadAlgoDeploymentList(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentListResponse> {
  let rows = await db
    .select()
    .from(algoDeploymentsTable)
    .where(
      input.mode
        ? eq(algoDeploymentsTable.mode, input.mode)
        : undefined,
    )
    .orderBy(desc(algoDeploymentsTable.updatedAt));

  if (shouldEnsureDefaultSignalOptionsDeployment(input, rows)) {
    await ensureDefaultSignalOptionsPaperDeployment({
      enabled: true,
      preserveExistingPaused: true,
    });
    rows = await db
      .select()
      .from(algoDeploymentsTable)
      .where(
        input.mode
          ? eq(algoDeploymentsTable.mode, input.mode)
          : undefined,
      )
      .orderBy(desc(algoDeploymentsTable.updatedAt));
  }

  const response = buildDeploymentListResponse(rows);
  rememberDeploymentListCache(input, response);
  deploymentListDbBackoff.clear();
  return response;
}

function markDeploymentListError(error: unknown, nowMs: number) {
  if (!isTransientPostgresError(error)) {
    return false;
  }
  // A pool-acquire timeout means "all pooled connections are busy right now"
  // (the startup read burst briefly saturating the pool), NOT "the database is
  // down". Opening the 15s lockout for it blocks the deployment read during the
  // exact window the pool is saturated, so the algo screen shows "deployment
  // unavailable" for 15s even though the deployment exists and the DB is healthy.
  // Serve the cached fallback (return true) but do NOT back off, so the next
  // request retries the DB immediately. Genuine connectivity failures still back off.
  if (!isPoolContentionError(error)) {
    deploymentListDbBackoff.markFailure({
      error,
      logger,
      message: "Algo deployment list database unavailable; serving cached deployments",
      nowMs,
    });
  }
  return true;
}

function readOrStartDeploymentListRequest(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentListResponse> {
  const key = deploymentListKey(input);
  const existing = deploymentListInFlight.get(key);
  if (existing) {
    return existing;
  }

  const request = loadAlgoDeploymentList(input)
    .catch((error) => {
      markDeploymentListError(error, Date.now());
      throw error;
    })
    .finally(() => {
      if (deploymentListInFlight.get(key) === request) {
        deploymentListInFlight.delete(key);
      }
    });
  deploymentListInFlight.set(key, request);
  request.catch(() => {});
  return request;
}

function executionEventToResponse(
  event: typeof executionEventsTable.$inferSelect,
  input: { includePayload?: boolean } = {},
) {
  return {
    id: event.id,
    deploymentId: event.deploymentId ?? null,
    algoRunId: event.algoRunId ?? null,
    providerAccountId: event.providerAccountId ?? null,
    symbol: event.symbol ?? null,
    eventType: event.eventType,
    summary: normalizeLegacyAlgoBrandText(event.summary),
    payload: input.includePayload ? normalizeLegacyAlgoBranding(event.payload) : {},
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export async function listAlgoDeployments(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentListResponse> {
  const nowMs = Date.now();
  if (deploymentListDbBackoff.isActive(nowMs)) {
    const cached = deploymentListFallback(input);
    if (cached) return cached;
  }

  try {
    return await readOrStartDeploymentListRequest(input);
  } catch (error) {
    if (!markDeploymentListError(error, nowMs)) {
      throw error;
    }
    const cached = deploymentListFallback(input);
    if (cached) return cached;
    // Transient DB error (pool contention or a connectivity blip) with no cached
    // fallback yet — e.g. the cold-boot pool race before the cache is primed.
    // Return an explicit "unavailable" marker instead of throwing a 500 so the
    // client renders a "temporarily unavailable, refresh" state and the SSE
    // clobber-guard preserves any already-known deployments, rather than the
    // misleading "no deployments exist" empty state.
    return { deployments: [], cacheStatus: "unavailable" };
  }
}

export async function createAlgoDeployment(input: CreateAlgoDeploymentInput) {
  const strategy = await getStrategyOrThrow(input.strategyId);
  const config = {
    ...(strategy.config as Record<string, unknown>),
    ...(input.config ?? {}),
  };
  if (isRetiredShadowEquityForwardConfig(config)) {
    throw new HttpError(410, "Retired shadow equity forward deployments cannot be created.", {
      code: "retired_algo_deployment_disabled",
      expose: true,
    });
  }
  const providerAccountId = normalizeAlgoDeploymentProviderAccountId({
    providerAccountId: input.providerAccountId,
    config,
    mode: input.mode,
  });

  const [deployment] = await db
    .insert(algoDeploymentsTable)
    .values({
      strategyId: strategy.id,
      name: normalizeLegacyAlgoBrandText(input.name),
      mode: input.mode,
      enabled: false,
      providerAccountId,
      symbolUniverse:
        input.symbolUniverse && input.symbolUniverse.length > 0
          ? input.symbolUniverse
          : strategy.symbolUniverse,
      config,
    })
    .returning();

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: "deployment_created",
    summary: `Created deployment ${deployment.name}`,
    payload: {
      strategyId: deployment.strategyId,
      mode: deployment.mode,
      symbolUniverse: deployment.symbolUniverse,
      requestedProviderAccountId: input.providerAccountId,
      providerAccountNormalized: providerAccountId !== input.providerAccountId,
    },
  });

  invalidateSignalOptionsDashboardCaches(deployment.id);
  applyDeploymentToListCache(deployment);
  notifyAlgoCockpitChanged({
    deploymentId: deployment.id,
    mode: deployment.mode,
    reason: "deployment_created",
  });

  return deploymentToResponse(deployment);
}

export async function setAlgoDeploymentEnabled(input: {
  deploymentId: string;
  enabled: boolean;
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);

  if (input.enabled) {
    await assertAlgoGatewayReady();
  }
  const providerAccountId = input.enabled
    ? normalizeAlgoDeploymentProviderAccountId({
        providerAccountId: existing.providerAccountId,
        config: existing.config,
        mode: existing.mode,
      })
    : existing.providerAccountId;

  const [deployment] = await db
    .update(algoDeploymentsTable)
    .set({
      enabled: input.enabled,
      providerAccountId,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(algoDeploymentsTable.id, input.deploymentId))
    .returning();

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: input.enabled ? "deployment_enabled" : "deployment_paused",
    summary: input.enabled
      ? `Enabled deployment ${normalizeLegacyAlgoBrandText(deployment.name)}`
      : `Paused deployment ${normalizeLegacyAlgoBrandText(deployment.name)}`,
    payload: {
      enabled: input.enabled,
      previousProviderAccountId: existing.providerAccountId,
      providerAccountNormalized: providerAccountId !== existing.providerAccountId,
    },
  });

  invalidateSignalOptionsDashboardCaches(deployment.id);
  applyDeploymentToListCache(deployment);
  notifyAlgoCockpitChanged({
    deploymentId: deployment.id,
    mode: deployment.mode,
    reason: input.enabled ? "deployment_enabled" : "deployment_paused",
  });

  return deploymentToResponse(deployment);
}

export async function updateAlgoDeploymentStrategySettings(input: {
  deploymentId: string;
  timeHorizon: unknown;
  signalTimeframe: unknown;
  bosConfirmation?: unknown;
  chochAtrBuffer?: unknown;
  chochBodyExpansionAtr?: unknown;
  chochVolumeGate?: unknown;
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);
  const timeHorizon = readTimeHorizon(input.timeHorizon);
  const signalTimeframe = readSignalTimeframe(input.signalTimeframe);
  const bosConfirmation = readOptionalBosConfirmation(input.bosConfirmation);
  const chochAtrBuffer = readOptionalPyrusSignalsNumber(
    input.chochAtrBuffer,
    "chochAtrBuffer",
  );
  const chochBodyExpansionAtr = readOptionalPyrusSignalsNumber(
    input.chochBodyExpansionAtr,
    "chochBodyExpansionAtr",
  );
  const chochVolumeGate = readOptionalPyrusSignalsNumber(
    input.chochVolumeGate,
    "chochVolumeGate",
  );
  const config = asRecord(existing.config);
  const parameters = asRecord(config.parameters);
  const pyrusSignalsSettingsPatch = {
    timeHorizon,
    ...(bosConfirmation !== undefined ? { bosConfirmation } : {}),
    ...(chochAtrBuffer !== undefined ? { chochAtrBuffer } : {}),
    ...(chochBodyExpansionAtr !== undefined ? { chochBodyExpansionAtr } : {}),
    ...(chochVolumeGate !== undefined ? { chochVolumeGate } : {}),
  };
  const nextConfig = {
    ...config,
    parameters: {
      ...parameters,
      signalTimeframe,
      ...pyrusSignalsSettingsPatch,
    },
  };
  const profile = await getSignalMonitorProfile({
    environment: existing.mode,
  });
  const nextPyrusSignalsSettings = {
    ...asRecord(profile.pyrusSignalsSettings),
    ...pyrusSignalsSettingsPatch,
  };

  const [updated] = await db
    .update(algoDeploymentsTable)
    .set({
      config: nextConfig,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(algoDeploymentsTable.id, input.deploymentId))
    .returning();

  const signalMonitorProfile = await updateSignalMonitorProfile({
    environment: existing.mode,
    timeframe: signalTimeframe,
    pyrusSignalsSettings: nextPyrusSignalsSettings,
  });
  const deployment = updated ?? existing;

  await db.insert(executionEventsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: "deployment_strategy_settings_updated",
    summary: `Updated strategy signal settings for ${normalizeLegacyAlgoBrandText(deployment.name)}`,
    payload: {
      timeHorizon,
      signalTimeframe,
      pyrusSignalsSettings: pyrusSignalsSettingsPatch,
      previousParameters: parameters,
      signalMonitorProfileId: signalMonitorProfile.id,
    },
  });

  invalidateSignalOptionsDashboardCaches(deployment.id);
  applyDeploymentToListCache(deployment);
  notifyAlgoCockpitChanged({
    deploymentId: deployment.id,
    mode: deployment.mode,
    reason: "deployment_strategy_settings_updated",
  });

  return {
    deployment: deploymentToResponse(deployment),
    signalMonitorProfile,
  };
}

export async function listExecutionEvents(input: ListExecutionEventsInput) {
  const rows = await db
    .select()
    .from(executionEventsTable)
    .where(
      input.deploymentId
        ? and(eq(executionEventsTable.deploymentId, input.deploymentId))
        : undefined,
    )
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));

  return {
    events: rows.map((event) =>
      executionEventToResponse(event, {
        includePayload: input.includePayload === true,
      }),
    ),
  };
}

export const __algoAutomationInternalsForTests = {
  buildDeploymentListResponse,
  clearDeploymentListCacheForTests,
  deploymentHasSignalOptionsProfile,
  deploymentListDbBackoff,
  markDeploymentListError,
  readDeploymentListCache,
  rememberDeploymentListCache,
  visibleDeploymentRows,
  readSignalTimeframe,
};
