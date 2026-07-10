import {
  algoDeploymentsTable,
  algoStrategiesTable,
  automationDiagnosticsTable,
  db,
  executionEventsTable,
  shadowPositionsTable,
} from "@workspace/db";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { assertAlgoGatewayReady } from "./algo-gateway";
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
  ensureDefaultSignalOptionsPaperDeployment,
  getSignalOptionsTodayPnlByDeployment,
  invalidateSignalOptionsDashboardCaches,
  type SignalOptionsTodayPnl,
} from "./signal-options-automation";
import {
  buildOvernightSpotDeploymentConfig,
  stripOvernightSpotFromSignalOptionsConfig,
} from "./algo-deployment-profile-shape";

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
type AlgoDeploymentListResponse = {
  deployments: ReturnType<typeof deploymentToResponse>[];
  // Sidecar map (deployment id -> today's net P&L) for the deployment tabs.
  // Kept off the deployment entity so create/enable/pause responses stay P&L-free;
  // attached per-request in listAlgoDeployments.
  pnlByDeployment?: Record<string, SignalOptionsTodayPnl>;
};

const deploymentListInFlight = new Map<
  string,
  Promise<AlgoDeploymentListResponse>
>();
const EXECUTION_EVENTS_LIST_CACHE_TTL_MS = 2_000;
type ListExecutionEventsResult = {
  events: ReturnType<typeof executionEventToResponse>[];
};
type ListExecutionEventsReader = (
  input: NormalizedListExecutionEventsInput,
) => Promise<ListExecutionEventsResult>;
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
let listExecutionEventsReaderForTests: ListExecutionEventsReader | null = null;
let mixedDeploymentRepairInFlight: Promise<void> | null = null;
const overnightEventReassignmentInFlight = new Set<string>();
const OVERNIGHT_EVENT_REASSIGNMENT_BATCH_SIZE = 1_000;

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

function deploymentHasOvernightSpotProfile(
  deployment: Pick<AlgoDeploymentRow, "config">,
) {
  const config = asRecord(deployment.config);
  const parameters = asRecord(config.parameters);
  return Boolean(
    config.overnightSpot != null || parameters.overnightSpotTrading != null,
  );
}

function deploymentHasMixedSignalOptionsAndOvernightProfile(
  deployment: Pick<AlgoDeploymentRow, "config" | "name">,
) {
  return (
    deploymentHasSignalOptionsProfile(deployment) &&
    deploymentHasOvernightSpotProfile(deployment)
  );
}

const OVERNIGHT_SPOT_STRATEGY_SOURCE = "overnight_spot_seed";
const DEFAULT_OVERNIGHT_SPOT_STRATEGY_NAME = "Overnight Equities";

// A dedicated strategy row for overnight deployments. Without it, overnight
// deployments would reuse a signal-options strategyId as their FK, so an Options
// and an Overnight deployment could share a strategyId — and a strategyId-keyed
// consolidation (the merge of duplicate shadow/live rows) would wrongly fuse two
// different algos. Giving overnight its own strategy keeps strategyId a clean
// per-algo key. Created lazily on the first overnight deployment.
async function ensureDefaultOvernightSpotStrategy() {
  const [existing] = await db
    .select()
    .from(algoStrategiesTable)
    .where(
      sql`(${algoStrategiesTable.config} ->> 'source') = ${OVERNIGHT_SPOT_STRATEGY_SOURCE}`,
    )
    .limit(1);
  if (existing) {
    return existing;
  }
  const [created] = await db
    .insert(algoStrategiesTable)
    .values({
      name: DEFAULT_OVERNIGHT_SPOT_STRATEGY_NAME,
      mode: "shadow",
      enabled: false,
      symbolUniverse: [],
      config: {
        source: OVERNIGHT_SPOT_STRATEGY_SOURCE,
        strategyId: "pyrus_signals",
        parameters: { overnightSpotTrading: true },
        overnightSpot: {},
      },
    })
    .returning();
  return created;
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

function configValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
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

async function repairMixedSignalOptionsOvernightDeploymentRows(
  rows: AlgoDeploymentRow[],
) {
  const mixedRows = rows.filter(
    deploymentHasMixedSignalOptionsAndOvernightProfile,
  );
  if (!mixedRows.length) {
    return;
  }

  const overnightStrategy = await ensureDefaultOvernightSpotStrategy();
  const knownOvernightRows = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.strategyId, overnightStrategy.id));

  for (const mixedRow of mixedRows) {
    const [freshRow] = await db
      .select()
      .from(algoDeploymentsTable)
      .where(eq(algoDeploymentsTable.id, mixedRow.id))
      .limit(1);
    const source = freshRow ?? mixedRow;
    if (!deploymentHasMixedSignalOptionsAndOvernightProfile(source)) {
      continue;
    }

    let overnightDeployment = knownOvernightRows.find(
      (deployment) =>
        deployment.mode === source.mode &&
        deploymentHasOvernightSpotProfile(deployment) &&
        !deploymentHasSignalOptionsProfile(deployment),
    );

    if (!overnightDeployment) {
      const overnightConfig = buildOvernightSpotDeploymentConfig(source.config);
      const providerAccountId = normalizeAlgoDeploymentProviderAccountId({
        providerAccountId: source.providerAccountId,
        config: overnightConfig,
        mode: source.mode,
      });
      const [created] = await db
        .insert(algoDeploymentsTable)
        .values({
          strategyId: overnightStrategy.id,
          name: DEFAULT_OVERNIGHT_SPOT_STRATEGY_NAME,
          mode: source.mode,
          enabled: source.enabled,
          providerAccountId,
          symbolUniverse: source.symbolUniverse,
          config: overnightConfig,
          lastEvaluatedAt: source.lastEvaluatedAt,
          lastSignalAt: source.lastSignalAt,
        })
        .returning();

      if (created) {
        overnightDeployment = created;
        knownOvernightRows.unshift(created);
        await db.insert(automationDiagnosticsTable).values({
          deploymentId: created.id,
          providerAccountId: created.providerAccountId,
          eventType: "deployment_created",
          summary: `Created deployment ${created.name}`,
          payload: {
            strategyId: created.strategyId,
            mode: created.mode,
            symbolUniverse: created.symbolUniverse,
            sourceDeploymentId: source.id,
            reason: "split_mixed_signal_options_overnight_profile",
            requestedProviderAccountId: source.providerAccountId,
            providerAccountNormalized:
              providerAccountId !== source.providerAccountId,
          },
        });
      }
    }

    if (overnightDeployment) {
      scheduleOvernightSpotEventReassignment({
        sourceDeploymentId: source.id,
        overnightDeployment,
      });
    }

    const nextConfig = stripOvernightSpotFromSignalOptionsConfig(source.config);
    if (configValuesEqual(nextConfig, source.config)) {
      continue;
    }

    const [updated] = await db
      .update(algoDeploymentsTable)
      .set({
        config: nextConfig,
        updatedAt: new Date(),
      })
      .where(eq(algoDeploymentsTable.id, source.id))
      .returning();
    const signalOptionsDeployment = updated ?? {
      ...source,
      config: nextConfig,
    };
    await db.insert(automationDiagnosticsTable).values({
      deploymentId: signalOptionsDeployment.id,
      providerAccountId: signalOptionsDeployment.providerAccountId,
      eventType: "deployment_profile_split",
      summary: `Split overnight profile from ${normalizeLegacyAlgoBrandText(signalOptionsDeployment.name)}`,
      payload: {
        overnightDeploymentId: overnightDeployment?.id ?? null,
        removedKeys: [
          "overnightSpot",
          "parameters.overnightSpot",
          "parameters.overnightSpotTrading",
        ],
      },
    });
    if (overnightDeployment) {
      notifyAlgoCockpitChanged({
        deploymentId: overnightDeployment.id,
        mode: overnightDeployment.mode,
        reason: "deployment_profile_split",
      });
    }
    notifyAlgoCockpitChanged({
      deploymentId: signalOptionsDeployment.id,
      mode: signalOptionsDeployment.mode,
      reason: "deployment_profile_split",
    });
  }
}

async function reassignOvernightSpotRowsInTable(input: {
  table: "execution_events" | "automation_diagnostics";
  sourceDeploymentId: string;
  overnightDeployment: AlgoDeploymentRow;
}) {
  const table = sql.raw(input.table);
  let movedTotal = 0;
  for (;;) {
    const result = await db.execute(sql`
      with batch as (
        select id
        from ${table}
        where deployment_id = ${input.sourceDeploymentId}
          and event_type like 'overnight_spot_%'
        order by occurred_at desc
        limit ${OVERNIGHT_EVENT_REASSIGNMENT_BATCH_SIZE}
      )
      update ${table}
      set deployment_id = ${input.overnightDeployment.id},
          provider_account_id = ${input.overnightDeployment.providerAccountId},
          updated_at = now()
      where id in (select id from batch)
      returning id
    `);
    const moved = Number(result.rowCount ?? result.rows?.length ?? 0);
    movedTotal += moved;
    if (moved === 0) {
      return movedTotal;
    }
  }
}

// Move overnight_spot_% rows from the source deployment onto the new overnight
// deployment on split. The ledger keeps the staying overnight types
// (shadow/live/order_failed) and diagnostics keeps the moved telemetry
// (blocked/tracked); both must follow the deployment or the new deployment's UI
// feed and the dedup union (which key on deployment_id) lose those rows.
async function reassignOvernightSpotEvents(input: {
  sourceDeploymentId: string;
  overnightDeployment: AlgoDeploymentRow;
}) {
  const [movedLedger, movedDiagnostics] = await Promise.all([
    reassignOvernightSpotRowsInTable({
      table: "execution_events",
      sourceDeploymentId: input.sourceDeploymentId,
      overnightDeployment: input.overnightDeployment,
    }),
    reassignOvernightSpotRowsInTable({
      table: "automation_diagnostics",
      sourceDeploymentId: input.sourceDeploymentId,
      overnightDeployment: input.overnightDeployment,
    }),
  ]);
  return { movedLedger, movedDiagnostics };
}

function scheduleOvernightSpotEventReassignment(input: {
  sourceDeploymentId: string;
  overnightDeployment: AlgoDeploymentRow;
}) {
  const key = `${input.sourceDeploymentId}:${input.overnightDeployment.id}`;
  if (overnightEventReassignmentInFlight.has(key)) {
    return;
  }
  overnightEventReassignmentInFlight.add(key);
  void reassignOvernightSpotEvents(input)
    .then(async ({ movedLedger, movedDiagnostics }) => {
      const movedOvernightEventCount = movedLedger + movedDiagnostics;
      if (movedOvernightEventCount <= 0) {
        return;
      }
      await db.insert(automationDiagnosticsTable).values({
        deploymentId: input.overnightDeployment.id,
        providerAccountId: input.overnightDeployment.providerAccountId,
        eventType: "deployment_events_reassigned",
        summary: `Moved overnight events to ${normalizeLegacyAlgoBrandText(input.overnightDeployment.name)}`,
        payload: {
          sourceDeploymentId: input.sourceDeploymentId,
          eventTypePattern: "overnight_spot_%",
          movedOvernightEventCount,
          movedLedgerEventCount: movedLedger,
          movedDiagnosticEventCount: movedDiagnostics,
          reason: "split_mixed_signal_options_overnight_profile",
        },
      });
    })
    .catch((error) => {
      logger.warn(
        {
          err: error,
          sourceDeploymentId: input.sourceDeploymentId,
          overnightDeploymentId: input.overnightDeployment.id,
        },
        "Failed to reassign overnight spot events after deployment split",
      );
    })
    .finally(() => {
      overnightEventReassignmentInFlight.delete(key);
    });
}

async function repairMixedSignalOptionsOvernightDeployments(
  input: ListAlgoDeploymentsInput,
  rows: AlgoDeploymentRow[],
): Promise<AlgoDeploymentRow[]> {
  if (!rows.some(deploymentHasMixedSignalOptionsAndOvernightProfile)) {
    return rows;
  }
  if (!mixedDeploymentRepairInFlight) {
    mixedDeploymentRepairInFlight =
      repairMixedSignalOptionsOvernightDeploymentRows(rows).finally(() => {
        mixedDeploymentRepairInFlight = null;
      });
  }
  await mixedDeploymentRepairInFlight;
  return selectAlgoDeploymentRows(input);
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

async function loadAlgoDeploymentList(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentListResponse> {
  let rows = await selectAlgoDeploymentRows(input);

  if (shouldEnsureDefaultSignalOptionsDeployment(input, rows)) {
    await ensureDefaultSignalOptionsPaperDeployment({
      enabled: true,
      preserveExistingPaused: true,
    });
    rows = await selectAlgoDeploymentRows(input);
  }
  rows = await repairMixedSignalOptionsOvernightDeployments(input, rows);

  return buildDeploymentListResponse(rows);
}

function readOrStartDeploymentListRequest(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentListResponse> {
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
// Only signal-options deployments carry P&L; other kinds get no entries.
// Today's net P&L for shadow-mode overnight-spot deployments, sourced from the
// shadow ledger's equity positions (which already carry unrealized/realized P&L):
// open positions -> unrealized; positions closed today (UTC) -> realized.
// Attributed to a deployment by its symbol universe. Live overnight positions
// live in the real broker account (not the shadow ledger) and are not computed
// here. NOTE: unverified against real overnight data (none exists yet).
async function getOvernightTodayPnlByDeployment(
  deployments: ReturnType<typeof deploymentToResponse>[],
): Promise<Record<string, SignalOptionsTodayPnl>> {
  const overnight = deployments.filter(
    (deployment) =>
      deployment.mode === "shadow" &&
      deploymentHasOvernightSpotProfile(deployment),
  );
  if (overnight.length === 0) {
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
  for (const deployment of overnight) {
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
  response: AlgoDeploymentListResponse,
): Promise<AlgoDeploymentListResponse> {
  const signalOptionsIds = response.deployments
    .filter((deployment) => deploymentHasSignalOptionsProfile(deployment))
    .map((deployment) => deployment.id);
  const [signalOptionsPnl, overnightPnl] = await Promise.all([
    signalOptionsIds.length
      ? getSignalOptionsTodayPnlByDeployment(signalOptionsIds)
      : Promise.resolve({}),
    getOvernightTodayPnlByDeployment(response.deployments),
  ]);
  const pnlByDeployment = { ...signalOptionsPnl, ...overnightPnl };
  if (Object.keys(pnlByDeployment).length === 0) {
    return response;
  }
  return { ...response, pnlByDeployment };
}

export async function listAlgoDeployments(
  input: ListAlgoDeploymentsInput,
): Promise<AlgoDeploymentListResponse> {
  return attachTodayPnlToDeploymentList(
    await readOrStartDeploymentListRequest(input),
  );
}

export async function createAlgoDeployment(input: CreateAlgoDeploymentInput) {
  // Overnight deployments bind to a dedicated overnight strategy (server-resolved)
  // so they never share a strategyId with signal-options; the requested
  // strategyId is ignored for overnight. Other kinds use the requested strategy.
  const strategy = deploymentHasOvernightSpotProfile({
    config: input.config ?? {},
  })
    ? await ensureDefaultOvernightSpotStrategy()
    : await getStrategyOrThrow(input.strategyId);
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
  deploymentId: string;
  enabled: boolean;
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);

  if (input.enabled && existing.mode === "live") {
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
  deploymentId: string;
  mode: "shadow" | "live";
}) {
  const existing = await getDeploymentOrThrow(input.deploymentId);

  if (existing.mode === input.mode) {
    return deploymentToResponse(existing);
  }

  const pausedForLiveSwitch = input.mode === "live" && existing.enabled;
  const enabled = input.mode === "live" ? false : existing.enabled;
  const providerAccountId = normalizeAlgoDeploymentProviderAccountId({
    providerAccountId: existing.providerAccountId,
    config: existing.config,
    mode: input.mode,
  });

  const [deployment] = await db
    .update(algoDeploymentsTable)
    .set({
      mode: input.mode,
      enabled,
      providerAccountId,
      updatedAt: new Date(),
      lastError: null,
    })
    .where(eq(algoDeploymentsTable.id, input.deploymentId))
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
  const config = stripOvernightSpotFromSignalOptionsConfig(existing.config);
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
    limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
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

async function readExecutionEventsUncached(
  input: NormalizedListExecutionEventsInput,
): Promise<ListExecutionEventsResult> {
  const { limit, includePayload } = input;

  // Project scalar columns only for the default feed and OMIT the jsonb `payload`
  // unless the caller opted in (`view=full`/includePayload). The `candidate_skipped`
  // firehose (~236K rows/day) previously read + JSON.parse'd payload per row on the
  // event loop only to have executionEventToResponse discard it (payload:{}); the
  // load-bearing payload consumer is the separate cached deployment-scoped path
  // (signal-options-automation listDeploymentEvents), not this list. Both union
  // branches keep an identical column set so the merge stays type-compatible.
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
    ...(includePayload ? { payload: executionEventsTable.payload } : {}),
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
    ...(includePayload ? { payload: automationDiagnosticsTable.payload } : {}),
  };

  // Union the ledger (execution_events) with telemetry (automation_diagnostics)
  // so the feed is identical to before the split: the cockpit/operations UI and
  // /algo/events still surface blocked/tracked/lifecycle events. Each branch is
  // sorted+limited independently then merge-sorted with an outer limit — correct
  // because a row outside a branch's top-`limit` (each branch sorted desc) can
  // never be in the global top-`limit`. Columns mirror exactly, so the two table
  // selects are union-compatible and executionEventToResponse maps both.
  const ledgerQuery = db
    .select(ledgerColumns)
    .from(executionEventsTable)
    .where(
      input.deploymentId
        ? eq(executionEventsTable.deploymentId, input.deploymentId)
        : undefined,
    )
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(limit);
  const diagnosticsQuery = db
    .select(diagnosticsColumns)
    .from(automationDiagnosticsTable)
    .where(
      input.deploymentId
        ? eq(automationDiagnosticsTable.deploymentId, input.deploymentId)
        : undefined,
    )
    .orderBy(desc(automationDiagnosticsTable.occurredAt))
    .limit(limit);

  const [ledgerRows, diagnosticRows] = await Promise.all([
    ledgerQuery,
    diagnosticsQuery,
  ]);
  const rows = mergeExecutionEventRows(ledgerRows, diagnosticRows, limit);

  return {
    events: rows.map((event) =>
      executionEventToResponse(event, { includePayload }),
    ),
  };
}

export async function listExecutionEvents(
  input: ListExecutionEventsInput,
): Promise<ListExecutionEventsResult> {
  const normalized = normalizeListExecutionEventsInput(input);
  const key = executionEventsListCacheKey(normalized);
  const now = Date.now();
  const cached = executionEventsListCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) {
    executionEventsListCache.delete(key);
  }
  const existing = executionEventsListInFlight.get(key);
  if (existing) {
    return existing;
  }

  const reader =
    listExecutionEventsReaderForTests ?? readExecutionEventsUncached;
  const request = reader(normalized)
    .then((value) => {
      executionEventsListCache.set(key, {
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
  buildOvernightSpotDeploymentConfig,
  deploymentHasSignalOptionsProfile,
  deploymentHasMixedSignalOptionsAndOvernightProfile,
  stripOvernightSpotFromSignalOptionsConfig,
  visibleDeploymentRows,
  readSignalTimeframe,
  mergeExecutionEventRows,
  clearExecutionEventsListCacheForTests() {
    executionEventsListCache.clear();
    executionEventsListInFlight.clear();
  },
  setListExecutionEventsReaderForTests(
    reader: ListExecutionEventsReader | null,
  ) {
    listExecutionEventsReaderForTests = reader;
  },
};
