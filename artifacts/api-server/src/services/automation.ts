import {
  algoDeploymentsTable,
  algoStrategiesTable,
  automationDiagnosticsTable,
  db,
  executionEventsTable,
  shadowPositionsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import { SHADOW_ACCOUNT_ID } from "./shadow-account";
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
  getSignalOptionsTodayPnlByDeployment,
  invalidateSignalOptionsDashboardCaches,
  type SignalOptionsTodayPnl,
} from "./signal-options-automation";
import { resolveEquityExecutionProfile } from "./overnight-spot-automation";
import { assertManagedDeploymentEnablePreflight } from "./algo-deployment-management";

type CreateAlgoDeploymentInput = {
  strategyId: string;
  name: string;
  providerAccountId: string;
  mode: "shadow" | "live";
  symbolUniverse?: string[];
  config?: Record<string, unknown>;
};

type ListAlgoDeploymentsInput = {
  mode?: "shadow" | "live";
};

type ListExecutionEventsInput = {
  deploymentId?: string;
  limit?: number;
  includePayload?: boolean;
};
type NormalizedListExecutionEventsInput = {
  deploymentId?: string;
  limit: number;
  includePayload: boolean;
};

const STRATEGY_SIGNAL_TIMEFRAMES = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
] as const;
const PYRUS_SIGNALS_BOS_CONFIRMATIONS = ["close", "wicks"] as const;
const RETIRED_SHADOW_EQUITY_FORWARD_EXECUTION_MODE = "signal_equity_shadow";
const DEFAULT_SIGNAL_OPTIONS_DEPLOYMENT_NAME = "Pyrus Signals Options Shadow";
const LEGACY_SIGNAL_OPTIONS_DEPLOYMENT_NAME = "Pyrus Signals Shadow Paper";

type AlgoDeploymentRow = typeof algoDeploymentsTable.$inferSelect;
type AlgoDeploymentMetadataListResponse = {
  deployments: ReturnType<typeof deploymentToResponse>[];
};
type AlgoDeploymentListResponse = AlgoDeploymentMetadataListResponse & {
  // Sidecar map (deployment id -> today's net P&L) for the deployment tabs.
  // Kept off the deployment entity so create/enable/pause responses stay P&L-free;
  // attached per-request in listAlgoDeployments.
  pnlByDeployment?: Record<string, SignalOptionsTodayPnl>;
};

const deploymentListInFlight = new Map<
  string,
  Promise<AlgoDeploymentMetadataListResponse>
>();
const EXECUTION_EVENTS_LIST_CACHE_TTL_MS = 2_000;
// ponytail: cap by key; use a byte budget only if payload-size variance proves this insufficient.
const EXECUTION_EVENTS_COMPLETED_CACHE_MAX_KEYS = 32;
type ListExecutionEventsResult = {
  events: ReturnType<typeof executionEventToResponse>[];
};
type ListExecutionEventsReader = (
  input: NormalizedListExecutionEventsInput,
) => Promise<ListExecutionEventsResult>;
type ExecutionEventSource = "execution_events" | "automation_diagnostics";
type ExecutionEventIdentity = {
  source: ExecutionEventSource;
  id: string;
  occurredAt: Date;
  updatedAt: Date;
};
type MaterializedExecutionEventRow<T> = {
  source: ExecutionEventSource;
  id: string;
  value: T;
};
type ExecutionEventRowCache<T> = Map<
  string,
  {
    version: string;
    value: T;
  }
>;
const executionEventsListCache = new Map<
  string,
  {
    expiresAt: number;
    value: ListExecutionEventsResult;
  }
>();
const executionEventsListInFlight = new Map<
  string,
  Promise<ListExecutionEventsResult>
>();
const executionEventRowsCache = new Map<
  string,
  ExecutionEventRowCache<ListExecutionEventsResult["events"][number]>
>();
let listExecutionEventsReaderForTests: ListExecutionEventsReader | null = null;

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
    throw new HttpError(
      410,
      "Retired shadow equity forward deployments are disabled.",
      {
        code: "retired_algo_deployment_disabled",
        expose: true,
      },
    );
  }

  return deployment;
}

function assertDeploymentAdminAccess(
  deployment: AlgoDeploymentRow,
  appUserId: string,
) {
  if (deployment.appUserId != null && deployment.appUserId !== appUserId) {
    throw new HttpError(403, "Algorithm deployment access denied.", {
      code: "algo_deployment_forbidden",
    });
  }
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
  return (
    parameters.executionMode === RETIRED_SHADOW_EQUITY_FORWARD_EXECUTION_MODE
  );
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

async function selectAlgoDeploymentRows(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentRow[]> {
  return db
    .select()
    .from(algoDeploymentsTable)
    .where(input.mode ? eq(algoDeploymentsTable.mode, input.mode) : undefined)
    .orderBy(desc(algoDeploymentsTable.updatedAt));
}

function deploymentListKey(input: ListAlgoDeploymentsInput) {
  return input.mode ?? "all";
}

async function loadAlgoDeploymentList(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentMetadataListResponse> {
  const rows = await selectAlgoDeploymentRows(input);
  return buildDeploymentListResponse(rows);
}

function readOrStartDeploymentListRequest(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentMetadataListResponse> {
  const key = deploymentListKey(input);
  const existing = deploymentListInFlight.get(key);
  if (existing) {
    return existing;
  }

  const request = loadAlgoDeploymentList(input).finally(() => {
    if (deploymentListInFlight.get(key) === request) {
      deploymentListInFlight.delete(key);
    }
  });
  deploymentListInFlight.set(key, request);
  request.catch(() => {});
  return request;
}

// `payload` is optional on the accepted row: the hot list read (listExecutionEvents)
// projects scalar columns only and omits the jsonb `payload` unless includePayload
// is set, so it is never read/parsed on the event loop for the common feed.
function executionEventToResponse(
  event: Omit<typeof executionEventsTable.$inferSelect, "payload"> & {
    payload?: (typeof executionEventsTable.$inferSelect)["payload"];
  },
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
    payload: input.includePayload
      ? normalizeLegacyAlgoBranding(event.payload ?? {})
      : {},
    occurredAt: event.occurredAt,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

// Attach per-deployment today's P&L without mutating the deployment rows.
// Today's net P&L for shadow-mode equity deployments, sourced from the
// shadow ledger's equity positions (which already carry unrealized/realized P&L):
// open positions -> unrealized; positions closed today (UTC) -> realized.
// Attributed to a deployment by its symbol universe. Live equity positions
// live in the real broker account (not the shadow ledger) and are not computed
// here. NOTE: unverified against real overnight data (none exists yet).
async function getEquityTodayPnlByDeployment(
  deployments: ReturnType<typeof deploymentToResponse>[],
): Promise<Record<string, SignalOptionsTodayPnl>> {
  const equityDeployments = deployments.filter(
    (deployment) =>
      deployment.mode === "shadow" &&
      resolveEquityExecutionProfile(deployment.config).styles.length > 0,
  );
  if (equityDeployments.length === 0) {
    return {};
  }
  const now = new Date();
  const startOfUtcDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const rows = await db
    .select({
      symbol: shadowPositionsTable.symbol,
      status: shadowPositionsTable.status,
      unrealizedPnl: shadowPositionsTable.unrealizedPnl,
      realizedPnl: shadowPositionsTable.realizedPnl,
      closedAt: shadowPositionsTable.closedAt,
    })
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.assetClass, "equity"),
        or(
          eq(shadowPositionsTable.status, "open"),
          gte(shadowPositionsTable.closedAt, startOfUtcDay),
        ),
      ),
    );

  const num = (value: unknown) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const result: Record<string, SignalOptionsTodayPnl> = {};
  for (const deployment of equityDeployments) {
    const universe = new Set(
      (deployment.symbolUniverse ?? []).map((symbol) =>
        String(symbol).toUpperCase(),
      ),
    );
    let realized = 0;
    let unrealized = 0;
    for (const row of rows) {
      if (!universe.has(String(row.symbol).toUpperCase())) continue;
      if (row.status === "open") {
        unrealized += num(row.unrealizedPnl);
      } else if (row.closedAt) {
        realized += num(row.realizedPnl);
      }
    }
    result[deployment.id] = {
      todayPnl: Number((realized + unrealized).toFixed(2)),
      dailyRealizedPnl: Number(realized.toFixed(2)),
      openUnrealizedPnl: Number(unrealized.toFixed(2)),
    };
  }
  return result;
}

async function attachTodayPnlToDeploymentList(
  response: AlgoDeploymentMetadataListResponse,
): Promise<AlgoDeploymentListResponse> {
  const signalOptionsIds = response.deployments
    .filter((deployment) => deploymentHasSignalOptionsProfile(deployment))
    .map((deployment) => deployment.id);
  const [signalOptionsPnl, equityPnl] = await Promise.all([
    signalOptionsIds.length
      ? getSignalOptionsTodayPnlByDeployment(signalOptionsIds)
      : Promise.resolve({}),
    getEquityTodayPnlByDeployment(response.deployments),
  ]);
  const pnlByDeployment = { ...signalOptionsPnl, ...equityPnl };
  if (Object.keys(pnlByDeployment).length === 0) {
    return response;
  }
  return { ...response, pnlByDeployment };
}

export function listAlgoDeploymentMetadata(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentMetadataListResponse> {
  return readOrStartDeploymentListRequest(input);
}

export async function listAlgoDeployments(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentListResponse> {
  return attachTodayPnlToDeploymentList(
    await listAlgoDeploymentMetadata(input),
  );
}

export async function createAlgoDeployment(input: CreateAlgoDeploymentInput) {
  const strategy = await getStrategyOrThrow(input.strategyId);
  const config = {
    ...(strategy.config as Record<string, unknown>),
    ...(input.config ?? {}),
  };
  if (isRetiredShadowEquityForwardConfig(config)) {
    throw new HttpError(
      410,
      "Retired shadow equity forward deployments cannot be created.",
      {
        code: "retired_algo_deployment_disabled",
        expose: true,
      },
    );
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

  await db.insert(automationDiagnosticsTable).values({
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
  notifyAlgoCockpitChanged({
    deploymentId: deployment.id,
    mode: deployment.mode,
    reason: "deployment_created",
  });

  return deploymentToResponse(deployment);
}

export async function setAlgoDeploymentEnabled(input: {
  appUserId: string;
  deploymentId: string;
  enabled: boolean;
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);
  assertDeploymentAdminAccess(existing, input.appUserId);

  const preflight = input.enabled
    ? await assertManagedDeploymentEnablePreflight({
        appUserId: input.appUserId,
        deploymentId: input.deploymentId,
      })
    : null;
  const providerAccountId = input.enabled
    ? normalizeAlgoDeploymentProviderAccountId({
        providerAccountId: preflight!.providerAccountId,
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
    .where(
      and(
        eq(algoDeploymentsTable.id, input.deploymentId),
        eq(algoDeploymentsTable.appUserId, input.appUserId),
      ),
    )
    .returning();

  await db.insert(automationDiagnosticsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: input.enabled ? "deployment_enabled" : "deployment_paused",
    summary: input.enabled
      ? `Enabled deployment ${normalizeLegacyAlgoBrandText(deployment.name)}`
      : `Paused deployment ${normalizeLegacyAlgoBrandText(deployment.name)}`,
    payload: {
      enabled: input.enabled,
      previousProviderAccountId: existing.providerAccountId,
      providerAccountNormalized:
        providerAccountId !== existing.providerAccountId,
    },
  });

  invalidateSignalOptionsDashboardCaches(deployment.id);
  notifyAlgoCockpitChanged({
    deploymentId: deployment.id,
    mode: deployment.mode,
    reason: input.enabled ? "deployment_enabled" : "deployment_paused",
  });

  return deploymentToResponse(deployment);
}

// Switch a deployment's execution mode in place (shadow <-> live), one mode at a
// time. Setting mode=live NEVER auto-arms real trading: it force-pauses the
// deployment so the user must explicitly enable it to start live orders.
// Switching to shadow keeps the existing enabled state (shadow is safe).
export async function setAlgoDeploymentMode(input: {
  appUserId: string;
  deploymentId: string;
  mode: "shadow" | "live";
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);
  assertDeploymentAdminAccess(existing, input.appUserId);
  if (existing.archivedAt) {
    throw new HttpError(409, "Restore this deployment before changing its mode.", {
      code: "algo_deployment_archived",
    });
  }

  if (existing.mode === input.mode) {
    return deploymentToResponse(existing);
  }

  const pausedForLiveSwitch = input.mode === "live" && existing.enabled;
  const enabled = input.mode === "live" ? false : existing.enabled;
  const providerAccountId = existing.providerAccountId
    ? normalizeAlgoDeploymentProviderAccountId({
        providerAccountId: existing.providerAccountId,
        config: existing.config,
        mode: input.mode,
      })
    : null;

  const [deployment] = await db
    .update(algoDeploymentsTable)
    .set({
      mode: input.mode,
      enabled,
      providerAccountId,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(
      and(
        eq(algoDeploymentsTable.id, input.deploymentId),
        eq(algoDeploymentsTable.appUserId, input.appUserId),
      ),
    )
    .returning();

  await db.insert(automationDiagnosticsTable).values({
    deploymentId: deployment.id,
    providerAccountId: deployment.providerAccountId,
    eventType: "deployment_mode_changed",
    summary: `Set deployment ${normalizeLegacyAlgoBrandText(deployment.name)} to ${input.mode.toUpperCase()}`,
    payload: {
      mode: input.mode,
      previousMode: existing.mode,
      pausedForLiveSwitch,
    },
  });

  invalidateSignalOptionsDashboardCaches(deployment.id);
  notifyAlgoCockpitChanged({
    deploymentId: deployment.id,
    mode: deployment.mode,
    reason: "deployment_mode_changed",
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
  const currentPyrusSignalsSettings = asRecord(profile.pyrusSignalsSettings);
  const nextPyrusSignalsSettings = {
    ...currentPyrusSignalsSettings,
    ...pyrusSignalsSettingsPatch,
    // The Pyrus Signals reader prefers the nested marketStructure values over
    // the top-level keys, so the patch has to land there too -- otherwise the
    // saved value is shadowed by a stale marketStructure entry, the control
    // snaps back, and the Algo save bar never clears its dirty state.
    marketStructure: {
      ...asRecord(currentPyrusSignalsSettings.marketStructure),
      ...pyrusSignalsSettingsPatch,
    },
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

  let signalMonitorProfile: Awaited<
    ReturnType<typeof updateSignalMonitorProfile>
  >;
  try {
    signalMonitorProfile = await updateSignalMonitorProfile({
      environment: existing.mode,
      timeframe: signalTimeframe,
      pyrusSignalsSettings: nextPyrusSignalsSettings,
    });
  } catch (error) {
    await db
      .update(algoDeploymentsTable)
      .set({ config: existing.config })
      .where(eq(algoDeploymentsTable.id, input.deploymentId));
    throw error;
  }
  const deployment = updated ?? existing;

  await db.insert(automationDiagnosticsTable).values({
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

// Merge two already-desc-sorted, per-branch-limited row lists into the global
// top-`limit` by occurred_at desc. Correct because a row outside a branch's
// top-`limit` cannot be in the global top-`limit` (each branch is desc-sorted).
function mergeExecutionEventRows<T extends { occurredAt: Date }>(
  ledgerRows: T[],
  diagnosticRows: T[],
  limit: number,
): T[] {
  return [...ledgerRows, ...diagnosticRows]
    .sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    )
    .slice(0, limit);
}

function normalizeListExecutionEventsInput(
  input: ListExecutionEventsInput,
): NormalizedListExecutionEventsInput {
  return {
    deploymentId: input.deploymentId,
    limit: Math.min(Math.max(Math.trunc(input.limit ?? 100), 1), 500),
    includePayload: input.includePayload === true,
  };
}

function executionEventsListCacheKey(
  input: NormalizedListExecutionEventsInput,
): string {
  return [
    input.deploymentId?.trim() || "all",
    input.limit,
    input.includePayload ? "payload" : "summary",
  ].join("|");
}

function setExecutionEventRowsCache(
  key: string,
  value: ExecutionEventRowCache<ListExecutionEventsResult["events"][number]>,
) {
  executionEventRowsCache.delete(key);
  executionEventRowsCache.set(key, value);
}

function setExecutionEventsListCache(
  key: string,
  value: { expiresAt: number; value: ListExecutionEventsResult },
) {
  if (
    !executionEventsListCache.has(key) &&
    executionEventsListCache.size >= EXECUTION_EVENTS_COMPLETED_CACHE_MAX_KEYS
  ) {
    const oldestKey = executionEventsListCache.keys().next().value;
    if (oldestKey !== undefined) {
      executionEventsListCache.delete(oldestKey);
      executionEventRowsCache.delete(oldestKey);
    }
  }
  executionEventsListCache.delete(key);
  executionEventsListCache.set(key, value);
}

function touchExecutionEventsCompletedCacheKey(key: string) {
  const listEntry = executionEventsListCache.get(key);
  if (listEntry) {
    executionEventsListCache.delete(key);
    executionEventsListCache.set(key, listEntry);
  }
  const rowsEntry = executionEventRowsCache.get(key);
  if (rowsEntry) {
    executionEventRowsCache.delete(key);
    executionEventRowsCache.set(key, rowsEntry);
  }
}

async function readExecutionEventsUncached(
  input: NormalizedListExecutionEventsInput,
): Promise<ListExecutionEventsResult> {
  // The identity query remains authoritative every two seconds. Full rows (and
  // opted-in JSONB payloads) are materialized only when an identity is new or
  // its occurred/updated version changed.
  const identities = await readExecutionEventIdentities(input);
  const cacheKey = executionEventsListCacheKey(input);
  const materialized = await materializeExecutionEventRows(
    identities,
    executionEventRowsCache.get(cacheKey),
    (changed) => readExecutionEventRows(input, changed),
  );
  setExecutionEventRowsCache(cacheKey, materialized.cache);
  return { events: materialized.rows };
}

async function readExecutionEventIdentities(
  input: NormalizedListExecutionEventsInput,
): Promise<ExecutionEventIdentity[]> {
  const ledgerQuery = db
    .select({
      id: executionEventsTable.id,
      occurredAt: executionEventsTable.occurredAt,
      updatedAt: executionEventsTable.updatedAt,
    })
    .from(executionEventsTable)
    .where(
      input.deploymentId
        ? eq(executionEventsTable.deploymentId, input.deploymentId)
        : undefined,
    )
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(input.limit);
  const diagnosticsQuery = db
    .select({
      id: automationDiagnosticsTable.id,
      occurredAt: automationDiagnosticsTable.occurredAt,
      updatedAt: automationDiagnosticsTable.updatedAt,
    })
    .from(automationDiagnosticsTable)
    .where(
      input.deploymentId
        ? eq(automationDiagnosticsTable.deploymentId, input.deploymentId)
        : undefined,
    )
    .orderBy(desc(automationDiagnosticsTable.occurredAt))
    .limit(input.limit);

  const [ledgerRows, diagnosticRows] = await Promise.all([
    ledgerQuery,
    diagnosticsQuery,
  ]);
  const ledgerIdentities: ExecutionEventIdentity[] = ledgerRows.map((row) => ({
    ...row,
    source: "execution_events",
  }));
  const diagnosticIdentities: ExecutionEventIdentity[] = diagnosticRows.map(
    (row) => ({ ...row, source: "automation_diagnostics" }),
  );
  return mergeExecutionEventRows(
    ledgerIdentities,
    diagnosticIdentities,
    input.limit,
  );
}

async function readExecutionEventRows(
  input: NormalizedListExecutionEventsInput,
  identities: ExecutionEventIdentity[],
): Promise<
  MaterializedExecutionEventRow<ListExecutionEventsResult["events"][number]>[]
> {
  const ledgerIds = identities
    .filter((identity) => identity.source === "execution_events")
    .map((identity) => identity.id);
  const diagnosticIds = identities
    .filter((identity) => identity.source === "automation_diagnostics")
    .map((identity) => identity.id);
  const ledgerColumns = {
    id: executionEventsTable.id,
    deploymentId: executionEventsTable.deploymentId,
    algoRunId: executionEventsTable.algoRunId,
    providerAccountId: executionEventsTable.providerAccountId,
    symbol: executionEventsTable.symbol,
    eventType: executionEventsTable.eventType,
    summary: executionEventsTable.summary,
    occurredAt: executionEventsTable.occurredAt,
    createdAt: executionEventsTable.createdAt,
    updatedAt: executionEventsTable.updatedAt,
    ...(input.includePayload ? { payload: executionEventsTable.payload } : {}),
  };
  const diagnosticsColumns = {
    id: automationDiagnosticsTable.id,
    deploymentId: automationDiagnosticsTable.deploymentId,
    algoRunId: automationDiagnosticsTable.algoRunId,
    providerAccountId: automationDiagnosticsTable.providerAccountId,
    symbol: automationDiagnosticsTable.symbol,
    eventType: automationDiagnosticsTable.eventType,
    summary: automationDiagnosticsTable.summary,
    occurredAt: automationDiagnosticsTable.occurredAt,
    createdAt: automationDiagnosticsTable.createdAt,
    updatedAt: automationDiagnosticsTable.updatedAt,
    ...(input.includePayload
      ? { payload: automationDiagnosticsTable.payload }
      : {}),
  };
  const [ledgerRows, diagnosticRows] = await Promise.all([
    ledgerIds.length
      ? db
          .select(ledgerColumns)
          .from(executionEventsTable)
          .where(inArray(executionEventsTable.id, ledgerIds))
      : [],
    diagnosticIds.length
      ? db
          .select(diagnosticsColumns)
          .from(automationDiagnosticsTable)
          .where(inArray(automationDiagnosticsTable.id, diagnosticIds))
      : [],
  ]);

  return [
    ...ledgerRows.map((event) => ({
      source: "execution_events" as const,
      id: event.id,
      value: executionEventToResponse(event, {
        includePayload: input.includePayload,
      }),
    })),
    ...diagnosticRows.map((event) => ({
      source: "automation_diagnostics" as const,
      id: event.id,
      value: executionEventToResponse(event, {
        includePayload: input.includePayload,
      }),
    })),
  ];
}

function executionEventIdentityKey(identity: {
  source: ExecutionEventSource;
  id: string;
}) {
  return `${identity.source}:${identity.id}`;
}

function executionEventIdentityVersion(identity: ExecutionEventIdentity) {
  return `${identity.occurredAt.getTime()}:${identity.updatedAt.getTime()}`;
}

async function materializeExecutionEventRows<T>(
  identities: ExecutionEventIdentity[],
  previous: ExecutionEventRowCache<T> | undefined,
  load: (
    identities: ExecutionEventIdentity[],
  ) => Promise<MaterializedExecutionEventRow<T>[]>,
): Promise<{ rows: T[]; cache: ExecutionEventRowCache<T> }> {
  const changed = identities.filter((identity) => {
    const cached = previous?.get(executionEventIdentityKey(identity));
    return cached?.version !== executionEventIdentityVersion(identity);
  });
  const loaded = new Map(
    (changed.length ? await load(changed) : []).map((row) => [
      executionEventIdentityKey(row),
      row.value,
    ]),
  );
  const cache: ExecutionEventRowCache<T> = new Map();
  const rows: T[] = [];
  for (const identity of identities) {
    const key = executionEventIdentityKey(identity);
    const version = executionEventIdentityVersion(identity);
    const prior = previous?.get(key);
    const value =
      loaded.get(key) ?? (prior?.version === version ? prior.value : undefined);
    if (value === undefined) {
      continue;
    }
    cache.set(key, { version, value });
    rows.push(value);
  }

  return { rows, cache };
}

export async function listExecutionEvents(
  input: ListExecutionEventsInput,
): Promise<ListExecutionEventsResult> {
  const normalized = normalizeListExecutionEventsInput(input);
  const key = executionEventsListCacheKey(normalized);
  const now = Date.now();
  const cached = executionEventsListCache.get(key);
  if (cached && cached.expiresAt > now) {
    touchExecutionEventsCompletedCacheKey(key);
    return cached.value;
  }
  const existing = executionEventsListInFlight.get(key);
  if (existing) {
    return existing;
  }

  const reader =
    listExecutionEventsReaderForTests ?? readExecutionEventsUncached;
  const request = reader(normalized)
    .then((value) => {
      setExecutionEventsListCache(key, {
        value,
        expiresAt: Date.now() + EXECUTION_EVENTS_LIST_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      if (executionEventsListInFlight.get(key) === request) {
        executionEventsListInFlight.delete(key);
      }
    });
  executionEventsListInFlight.set(key, request);
  request.catch(() => {});
  return request;
}

export const __algoAutomationInternalsForTests = {
  buildDeploymentListResponse,
  deploymentHasSignalOptionsProfile,
  visibleDeploymentRows,
  readSignalTimeframe,
  mergeExecutionEventRows,
  materializeExecutionEventRows,
  setExecutionEventRowsCacheForTests(input: ListExecutionEventsInput) {
    const normalized = normalizeListExecutionEventsInput(input);
    setExecutionEventRowsCache(
      executionEventsListCacheKey(normalized),
      new Map(),
    );
  },
  getExecutionEventsCompletedCacheStateForTests(
    input: ListExecutionEventsInput,
  ) {
    const key = executionEventsListCacheKey(
      normalizeListExecutionEventsInput(input),
    );
    return {
      listHasKey: executionEventsListCache.has(key),
      rowsHasKey: executionEventRowsCache.has(key),
      listSize: executionEventsListCache.size,
      rowsSize: executionEventRowsCache.size,
    };
  },
  clearExecutionEventsListCacheForTests() {
    executionEventsListCache.clear();
    executionEventsListInFlight.clear();
    executionEventRowsCache.clear();
  },
  setListExecutionEventsReaderForTests(
    reader: ListExecutionEventsReader | null,
  ) {
    listExecutionEventsReaderForTests = reader;
  },
};
