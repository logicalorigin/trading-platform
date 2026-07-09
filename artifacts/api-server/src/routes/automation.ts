import { Router, type IRouter, type Response } from "express";
import { HttpError } from "../lib/errors";
import { requireAdminCsrf, requireUser } from "./auth";
import {
  fetchAlgoCockpitPrimaryPayload,
  subscribeAlgoCockpitSnapshots,
} from "../services/algo-cockpit-streams";
import {
  createAlgoDeployment,
  listAlgoDeployments,
  listExecutionEvents,
  setAlgoDeploymentEnabled,
  setAlgoDeploymentMode,
  updateAlgoDeploymentStrategySettings,
} from "../services/automation";
import {
  ensureDefaultSignalOptionsPaperDeployment,
  getAlgoDeploymentCockpit,
  getSignalOptionsPerformance,
  listSignalOptionsAutomationState,
  recordSignalOptionsManualDeviation,
  runSignalOptionsShadowBackfill,
  runSignalOptionsShadowScan,
  updateSignalOptionsExecutionProfile,
} from "../services/signal-options-automation";
import { runOvernightSpotSignalScan } from "../services/overnight-spot-execution";
import {
  getDeploymentSignalQualityKpis,
  refreshDeploymentSignalQualityKpiSnapshot,
  type SignalQualityDraftOverride,
} from "../services/signal-quality-kpis-service";
import {
  getApiRouteAdmission,
  withRouteAdmissionMetadata,
} from "../services/route-admission";
import {
  assertCanReadAlgoDeployment,
  filterAlgoDeploymentListForSession,
  filterExecutionEventsForSession,
  firstReadableAlgoDeploymentId,
} from "../services/automation-authorization";
import {
  recordSseStreamClose,
  recordSseStreamOpen,
  serializeSseEventData,
  type SseStreamCloseReason,
} from "../services/sse-stream-diagnostics";

const router: IRouter = Router();
const SIGNAL_OPTIONS_SHADOW_SCAN_ROUTE_TIMEOUT_MS = 45_000;
const SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_BUDGET_MS = 15_000;
const SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_ITEM_LIMIT = 4;
const OVERNIGHT_SPOT_SCAN_ROUTE_TIMEOUT_MS = 30_000;

type ContinuingSignalOptionsRouteTimeoutPolicy = {
  continuation: "continue-in-background";
  reason: string;
};

type AbortableSignalOptionsRouteTimeoutPolicy = {
  continuation: "abort-at-route-budget";
  reason: string;
};

type SignalOptionsRouteTimeoutPolicy =
  | ContinuingSignalOptionsRouteTimeoutPolicy
  | AbortableSignalOptionsRouteTimeoutPolicy;

const SIGNAL_OPTIONS_ROUTE_TIMEOUT_POLICIES = {
  shadowScan: {
    continuation: "abort-at-route-budget",
    reason: "manual Signal Options scans can trigger side-effectful action work",
  },
  overnightSpotScan: {
    continuation: "abort-at-route-budget",
    reason: "manual Overnight Spot scans can trigger side-effectful action work",
  },
} as const satisfies Record<string, SignalOptionsRouteTimeoutPolicy>;

function signalOptionsRequestCacheMode(
  value: unknown,
) {
  return value === "cache-only" ? "cache-only" : undefined;
}

function withAbortableSignalOptionsRouteTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  input: {
    timeoutMs: number;
    code: string;
    detail: string;
    policy: AbortableSignalOptionsRouteTimeoutPolicy;
  },
): Promise<T> {
  const controller = new AbortController();
  const taskPromise = Promise.resolve().then(() => task(controller.signal));
  taskPromise.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new HttpError(504, "Signal Options route timed out.", {
        code: input.code,
        detail: `${input.detail} Timed-out work is aborted because ${input.policy.reason}.`,
      });
      controller.abort(error);
      reject(error);
    }, input.timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([taskPromise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function writeSseEvent(
  res: Response,
  event: string,
  payload: unknown,
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${serializeSseEventData(payload)}\n\n`);
}

async function scopeAlgoCockpitPayloadForSession<T extends {
  deployments: Awaited<ReturnType<typeof listAlgoDeployments>>;
  events: Awaited<ReturnType<typeof listExecutionEvents>>;
}>(
  session: Awaited<ReturnType<typeof requireUser>>,
  payload: T,
): Promise<T> {
  return {
    ...payload,
    deployments: await filterAlgoDeploymentListForSession(
      session,
      payload.deployments,
    ),
    events: await filterExecutionEventsForSession(session, payload.events),
  };
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `Missing ${field}.`, {
      code: "invalid_request",
      detail: `${field} must be a non-empty string.`,
    });
  }

  return value.trim();
}

function readRequiredMode(value: unknown): "shadow" | "live" {
  if (value === "shadow" || value === "live") {
    return value;
  }

  throw new HttpError(400, "Missing mode.", {
    code: "invalid_request",
    detail: "mode must be either 'shadow' or 'live'.",
  });
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }

  return undefined;
}

router.get("/algo/deployments", async (req, res): Promise<void> => {
  const session = await requireUser(req);
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;

  res.json(
    await filterAlgoDeploymentListForSession(
      session,
      await listAlgoDeployments({ mode }),
    ),
  );
});

router.post("/algo/deployments", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const symbolUniverse = Array.isArray(req.body?.symbolUniverse)
    ? req.body.symbolUniverse.filter((value: unknown): value is string => typeof value === "string")
    : undefined;
  const config =
    req.body?.config && typeof req.body.config === "object" && !Array.isArray(req.body.config)
      ? req.body.config
      : undefined;

  const deployment = await createAlgoDeployment({
    strategyId: readRequiredString(req.body?.strategyId, "strategyId"),
    name: readRequiredString(req.body?.name, "name"),
    providerAccountId: readRequiredString(req.body?.providerAccountId, "providerAccountId"),
    mode: readRequiredMode(req.body?.mode),
    symbolUniverse,
    config,
  });

  res.status(201).json(deployment);
});

router.post("/algo/signal-options/default-paper-deployment", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const enabled =
    req.body?.enabled === false || req.body?.enabled === "false" ? false : true;

  res.status(201).json(
    await ensureDefaultSignalOptionsPaperDeployment({ enabled }),
  );
});

router.post("/algo/deployments/:deploymentId/enable", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  res.json(
    await setAlgoDeploymentEnabled({
      deploymentId: req.params.deploymentId,
      enabled: true,
    }),
  );
});

router.post("/algo/deployments/:deploymentId/pause", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  res.json(
    await setAlgoDeploymentEnabled({
      deploymentId: req.params.deploymentId,
      enabled: false,
    }),
  );
});

router.post("/algo/deployments/:deploymentId/mode", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  res.json(
    await setAlgoDeploymentMode({
      deploymentId: req.params.deploymentId,
      mode: readRequiredMode(req.body?.mode),
    }),
  );
});

router.patch("/algo/deployments/:deploymentId/strategy-settings", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};

  res.json(
    await updateAlgoDeploymentStrategySettings({
      deploymentId: req.params.deploymentId,
      timeHorizon: body.timeHorizon,
      signalTimeframe: body.signalTimeframe,
      bosConfirmation: body.bosConfirmation,
      chochAtrBuffer: body.chochAtrBuffer,
      chochBodyExpansionAtr: body.chochBodyExpansionAtr,
      chochVolumeGate: body.chochVolumeGate,
    }),
  );
});

// Reads an optional draft strategy-settings override from the query string (and
// body, as a fallback) so the control panel can preview signal-quality KPIs for
// unsaved settings. Only the strategy-settings fields are honored; anything else
// is ignored. An undefined field means "fall back to saved config / profile".
function readSignalQualityDraftOverride(
  req: { query: Record<string, unknown>; body?: unknown },
): SignalQualityDraftOverride | undefined {
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const source = { ...body, ...req.query };
  const fields = [
    "signalTimeframe",
    "timeHorizon",
    "outcomeHorizonBars",
    "outcomeTimeframe",
    "bosConfirmation",
    "chochAtrBuffer",
    "chochBodyExpansionAtr",
    "chochVolumeGate",
  ] as const;
  const draft: SignalQualityDraftOverride = {};
  let hasAny = false;
  for (const field of fields) {
    const value = source[field];
    if (value !== undefined && value !== "") {
      draft[field] = value;
      hasAny = true;
    }
  }
  return hasAny ? draft : undefined;
}

router.get("/algo/deployments/:deploymentId/signal-quality-kpis", async (req, res): Promise<void> => {
  await assertCanReadAlgoDeployment(await requireUser(req), req.params.deploymentId);
  res.json(
    await getDeploymentSignalQualityKpis({
      deploymentId: req.params.deploymentId,
      draft: readSignalQualityDraftOverride(req),
    }),
  );
});

router.post("/algo/deployments/:deploymentId/signal-quality-kpis/refresh", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  res.json(
    await refreshDeploymentSignalQualityKpiSnapshot({
      deploymentId: req.params.deploymentId,
      draft: readSignalQualityDraftOverride(req),
    }),
  );
});

router.get("/algo/deployments/:deploymentId/signal-options/state", async (req, res): Promise<void> => {
  await assertCanReadAlgoDeployment(await requireUser(req), req.params.deploymentId);
  const admission = getApiRouteAdmission(res);
  const view = req.query.view === "full" ? "full" : "summary";
  res.json(
    withRouteAdmissionMetadata(
      await listSignalOptionsAutomationState({
        deploymentId: req.params.deploymentId,
        cacheMode: signalOptionsRequestCacheMode(req.query.cacheMode),
        view,
        refreshSignalsFromMonitorState: req.query.refreshSignals === "true",
      }),
      admission,
    ),
  );
});

router.get("/algo/deployments/:deploymentId/cockpit", async (req, res): Promise<void> => {
  await assertCanReadAlgoDeployment(await requireUser(req), req.params.deploymentId);
  const admission = getApiRouteAdmission(res);
  const view = req.query.view === "full" ? "full" : "summary";
  res.json(
    withRouteAdmissionMetadata(
      await getAlgoDeploymentCockpit({
        deploymentId: req.params.deploymentId,
        cacheMode: signalOptionsRequestCacheMode(req.query.cacheMode),
        view,
      }),
      admission,
    ),
  );
});

router.get("/algo/deployments/:deploymentId/signal-options/performance", async (req, res): Promise<void> => {
  await assertCanReadAlgoDeployment(await requireUser(req), req.params.deploymentId);
  const admission = getApiRouteAdmission(res);
  res.json(
    withRouteAdmissionMetadata(
      await getSignalOptionsPerformance({
        deploymentId: req.params.deploymentId,
        cacheMode: signalOptionsRequestCacheMode(req.query.cacheMode),
      }),
      admission,
    ),
  );
});

router.post("/algo/deployments/:deploymentId/signal-options/shadow-scan", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
  const forceEvaluate =
    readOptionalBoolean(body.forceEvaluate) ??
    readOptionalBoolean(body.refreshSignals) ??
    false;
  const runActions =
    readOptionalBoolean(body.runActions) ??
    readOptionalBoolean(body.actionScan) ??
    false;

  res.json(
    await withAbortableSignalOptionsRouteTimeout(
      (signal) =>
        runSignalOptionsShadowScan({
          deploymentId: req.params.deploymentId,
          forceEvaluate,
          preferStoredMonitorState: forceEvaluate !== true,
          responseMode: "summary",
          skipActionWork: runActions !== true,
          source: "manual",
          actionWorkBudgetMs: SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_BUDGET_MS,
          actionWorkItemLimit: SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_ITEM_LIMIT,
          signal,
        }),
      {
        timeoutMs: SIGNAL_OPTIONS_SHADOW_SCAN_ROUTE_TIMEOUT_MS,
        code: "signal_options_shadow_scan_route_timeout",
        detail:
          "Signal Options shadow scan did not finish within the route budget.",
        policy: SIGNAL_OPTIONS_ROUTE_TIMEOUT_POLICIES.shadowScan,
      },
    ),
  );
});

router.post("/algo/deployments/:deploymentId/overnight-spot/scan", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
  const forceEvaluate =
    readOptionalBoolean(body.forceEvaluate) ??
    readOptionalBoolean(body.refreshSignals) ??
    false;
  const runActions =
    readOptionalBoolean(body.runActions) ??
    readOptionalBoolean(body.execute) ??
    false;
  const recordSignals =
    readOptionalBoolean(body.recordSignals) ??
    readOptionalBoolean(body.trackSignals) ??
    true;

  res.json(
    await withAbortableSignalOptionsRouteTimeout(
      (signal) =>
        runOvernightSpotSignalScan({
          deploymentId: req.params.deploymentId,
          forceEvaluate,
          runActions,
          recordSignals,
          signal,
        }),
      {
        timeoutMs: OVERNIGHT_SPOT_SCAN_ROUTE_TIMEOUT_MS,
        code: "overnight_spot_scan_route_timeout",
        detail:
          "Overnight spot scan did not finish within the route budget.",
        policy: SIGNAL_OPTIONS_ROUTE_TIMEOUT_POLICIES.overnightSpotScan,
      },
    ),
  );
});

router.post("/algo/deployments/:deploymentId/signal-options/backfill", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
  const replay =
    body.replay === true || body.source === "signal_options_replay"
      ? true
      : body.replay && typeof body.replay === "object" && !Array.isArray(body.replay)
        ? body.replay
        : undefined;

  res.status(201).json(
    await runSignalOptionsShadowBackfill({
      deploymentId: req.params.deploymentId,
      start: body.start,
      end: body.end,
      session: body.session,
      commit: body.commit,
      profilePatch: body.profilePatch,
      pyrusSignalsSettingsPatch: body.pyrusSignalsSettingsPatch,
      signalTimeframe: body.signalTimeframe,
      forceDeploymentUniverse: body.forceDeploymentUniverse,
      replay,
      replaceReplayRows: body.replaceReplayRows,
    }),
  );
});

router.post("/algo/deployments/:deploymentId/signal-options/deviation", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const deviation =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};

  res.status(201).json(
    await recordSignalOptionsManualDeviation({
      deploymentId: req.params.deploymentId,
      deviation,
    }),
  );
});

router.patch("/algo/deployments/:deploymentId/signal-options/profile", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const patch =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};

  res.json(
    await updateSignalOptionsExecutionProfile({
      deploymentId: req.params.deploymentId,
      patch,
    }),
  );
});

router.get("/algo/events", async (req, res): Promise<void> => {
  const session = await requireUser(req);
  const deploymentId =
    typeof req.query.deploymentId === "string" && req.query.deploymentId.trim()
      ? req.query.deploymentId.trim()
      : undefined;
  if (deploymentId) {
    await assertCanReadAlgoDeployment(session, deploymentId);
  }
  const limit =
    typeof req.query.limit === "string" && req.query.limit.trim()
      ? Number(req.query.limit)
      : undefined;
  const includePayload =
    req.query.includePayload === "true" || req.query.view === "full";

  res.json(
    await filterExecutionEventsForSession(
      session,
      await listExecutionEvents({
        deploymentId,
        limit: Number.isFinite(limit) ? limit : undefined,
        includePayload,
      }),
    ),
  );
});

router.get("/streams/algo/cockpit", async (req, res): Promise<void> => {
  const session = await requireUser(req);
  const mode: "shadow" | "live" = req.query.mode === "live" ? "live" : "shadow";
  const deploymentId =
    typeof req.query.deploymentId === "string" && req.query.deploymentId.trim()
      ? req.query.deploymentId.trim()
      : null;
  const eventLimit =
    typeof req.query.eventLimit === "string" && req.query.eventLimit.trim()
      ? Number(req.query.eventLimit)
      : undefined;
  const deployments = await filterAlgoDeploymentListForSession(
    session,
    await listAlgoDeployments({ mode }),
  );
  const readableDeploymentId = deploymentId
    ? (await assertCanReadAlgoDeployment(session, deploymentId), deploymentId)
    : await firstReadableAlgoDeploymentId(
        session,
        deployments.deployments.map((deployment) => deployment.id),
      );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write("retry: 5000\n\n");
  recordSseStreamOpen("algo-cockpit");

  let closed = false;
  let unsubscribe = () => {};
  let closeReason: SseStreamCloseReason = "server_cleanup";
  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe();
    recordSseStreamClose("algo-cockpit", closeReason);
    if (!res.destroyed) {
      res.end();
    }
  };
  req.on("aborted", () => {
    closeReason = "request_aborted";
    cleanup();
  });
  res.on("close", () => {
    closeReason = "client_close";
    cleanup();
  });

  try {
    const input = {
      deploymentId: readableDeploymentId,
      mode,
      eventLimit: Number.isFinite(eventLimit) ? eventLimit : undefined,
    };
    const initialPayload = await scopeAlgoCockpitPayloadForSession(
      session,
      await fetchAlgoCockpitPrimaryPayload(input),
    );
    if (closed) {
      return;
    }
    writeSseEvent(res, "live", initialPayload);
    writeSseEvent(res, "ready", {
      stream: "algo-cockpit",
      mode: initialPayload.mode,
      deploymentId: initialPayload.deploymentId,
      source: "algo-cockpit",
    });
    unsubscribe = subscribeAlgoCockpitSnapshots(
      input,
      (payload) => {
        if (!closed) {
          void scopeAlgoCockpitPayloadForSession(session, payload)
            .then((scopedPayload) => {
              if (!closed) {
                writeSseEvent(res, "live", scopedPayload);
              }
            })
            .catch((error) => {
              if (!closed) {
                writeSseEvent(res, "error", {
                  title: "Algo cockpit stream scope failed",
                  status: 500,
                  detail:
                    error instanceof Error
                      ? error.message
                      : "Unknown stream error.",
                });
              }
            });
        }
      },
      {
        initialPayload,
        onPollSuccess: ({ changed, payload }) => {
          if (!closed) {
            writeSseEvent(res, "freshness", {
              stream: "algo-cockpit",
              phase: payload.phase ?? null,
              mode: payload.mode,
              deploymentId: payload.deploymentId,
              changed,
              at: new Date().toISOString(),
            });
          }
        },
      },
    );
  } catch (error) {
    if (!closed) {
      writeSseEvent(res, "error", {
        title: "Algo cockpit stream setup failed",
        status: 500,
        detail: error instanceof Error ? error.message : "Unknown stream error.",
      });
    }
    closeReason = "setup_error";
    cleanup();
  }
});

export default router;
