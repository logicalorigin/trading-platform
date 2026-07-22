import { Router, type IRouter } from "express";
import {
  currentDbAdmissionSignal,
  runWithDbAdmissionSignal,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { requireAdminCsrf, requireUser, requireUserCsrf } from "./auth";
import {
  fetchAlgoCockpitPrimaryPayload,
  subscribeAlgoCockpitSnapshots,
  type AlgoCockpitStreamPayload,
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
  applyDeploymentTargetChanges,
  archiveManagedDeployment,
  createManagedDeployment,
  getManagedDeployment,
  listDeploymentAccountChoices,
  listManagedDeployments,
  listManagedDeploymentTargets,
  restoreManagedDeployment,
  updateManagedDeployment,
  type AlgoDeploymentTargetChange,
} from "../services/algo-deployment-management";
import { activateManagedDeploymentLive } from "../services/algo-deployment-live-activation";
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
  assertCanWriteAlgoDeployment,
  filterAlgoDeploymentListForSession,
  filterExecutionEventsForSession,
  firstReadableAlgoDeploymentId,
} from "../services/automation-authorization";
import {
  createSseConnectionWriter,
  recordSseStreamClose,
  recordSseStreamOpen,
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
  const requestSignal = currentDbAdmissionSignal();
  const taskSignal = requestSignal
    ? AbortSignal.any([requestSignal, controller.signal])
    : controller.signal;
  const taskPromise = Promise.resolve().then(() =>
    runWithDbAdmissionSignal(taskSignal, () => task(taskSignal)),
  );
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

async function scopeAlgoCockpitPayloadForSession(
  session: Awaited<ReturnType<typeof requireUser>>,
  payload: AlgoCockpitStreamPayload,
): Promise<AlgoCockpitStreamPayload> {
  const deployments = await filterAlgoDeploymentListForSession(
    session,
    payload.deployments,
  );
  const focusedDeployment = payload.deploymentId
    ? deployments.deployments.find(
        (deployment) => deployment.id === payload.deploymentId,
      ) ?? null
    : null;

  return {
    ...payload,
    deployments,
    deploymentId: focusedDeployment ? payload.deploymentId : null,
    focusedDeployment,
    events: focusedDeployment
      ? await filterExecutionEventsForSession(session, payload.events)
      : { ...payload.events, events: [] },
    signalOptionsState: focusedDeployment ? payload.signalOptionsState : null,
    cockpit: focusedDeployment ? payload.cockpit : null,
    performance: focusedDeployment ? payload.performance : null,
    signalMonitorProfile: focusedDeployment
      ? payload.signalMonitorProfile
      : null,
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

async function requireDeploymentAdminWrite(
  req: Parameters<typeof requireAdminCsrf>[0] & {
    params: { deploymentId: string };
  },
) {
  const session = await requireAdminCsrf(req);
  await assertCanWriteAlgoDeployment(session, req.params.deploymentId);
  return session;
}

function readOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readOptionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "Invalid symbol universe.", {
      code: "invalid_request",
      detail: "symbolUniverse must be an array of strings.",
    });
  }
  return value;
}

function readLiveTargetIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "Invalid live account selection.", {
      code: "invalid_request",
      detail: "targetIds must be an array of target ID strings.",
    });
  }
  return value;
}

function readTargetChanges(value: unknown): AlgoDeploymentTargetChange[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Invalid account changes.", {
      code: "invalid_request",
      detail: "changes must be an array.",
    });
  }
  return value.map((raw, index) => {
    const change = readOptionalRecord(raw);
    if (!change) {
      throw new HttpError(400, "Invalid account change.", {
        code: "invalid_request",
        detail: `changes[${index}] must be an object.`,
      });
    }
    const accountType = change.accountType;
    if (accountType !== "broker" && accountType !== "shadow") {
      throw new HttpError(400, "Invalid account type.", {
        code: "invalid_request",
        detail: `changes[${index}].accountType must be broker or shadow.`,
      });
    }
    const accountId = readRequiredString(
      change.accountId,
      `changes[${index}].accountId`,
    );
    if (change.action === "upsert") {
      if (
        Object.prototype.hasOwnProperty.call(change, "allocationPercent") ||
        Object.prototype.hasOwnProperty.call(change, "hardCeilingPercent")
      ) {
        throw new HttpError(400, "Use the unified allowance fields.", {
          code: "algo_allowance_legacy_write_unsupported",
          detail: `changes[${index}] must use allowance and totalAlgoAllowance.`,
        });
      }
      if (Object.prototype.hasOwnProperty.call(change, "executionEnabled")) {
        throw new HttpError(400, "Target activation is a separate action.", {
          code: "algo_target_activation_write_unsupported",
          detail: `changes[${index}].executionEnabled is not accepted by configuration Apply.`,
        });
      }
      return {
        accountType,
        accountId,
        action: "upsert" as const,
        allowance: change.allowance,
        totalAlgoAllowance: change.totalAlgoAllowance,
        accountDailyLossLimit: change.accountDailyLossLimit,
        riskOverrides: readOptionalRecord(change.riskOverrides),
      };
    }
    if (change.action === "remove") {
      if (
        change.removalMode !== undefined &&
        change.removalMode !== "drain" &&
        change.removalMode !== "manual_takeover"
      ) {
        throw new HttpError(400, "Invalid removal mode.", {
          code: "invalid_request",
          detail: `changes[${index}].removalMode must be drain or manual_takeover.`,
        });
      }
      return {
        accountType,
        accountId,
        action: "remove" as const,
        removalMode: change.removalMode,
      };
    }
    throw new HttpError(400, "Invalid account action.", {
      code: "invalid_request",
      detail: `changes[${index}].action must be upsert or remove.`,
    });
  });
}

router.get("/algo/deployments", async (req, res): Promise<void> => {
  const session = await requireUser(req);
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "shadow" ? "shadow" : undefined;
  res.json(
    await listManagedDeployments({
      appUserId: session.user.id,
      mode,
      includeArchived: readOptionalBoolean(req.query.includeArchived) ?? false,
    }),
  );
});

router.post("/algo/deployments", async (req, res): Promise<void> => {
  const session = await requireUserCsrf(req);
  const body = readOptionalRecord(req.body) ?? {};
  const targetChanges =
    body.targets === undefined ? [] : readTargetChanges(body.targets);
  const created = await createManagedDeployment({
    appUserId: session.user.id,
    strategyId: readRequiredString(req.body?.strategyId, "strategyId"),
    name: readRequiredString(req.body?.name, "name"),
    mode: readRequiredMode(req.body?.mode),
    symbolUniverse: readOptionalStringArray(body.symbolUniverse),
    config: readOptionalRecord(body.config),
  });
  const applyResult = targetChanges.length
    ? await applyDeploymentTargetChanges({
        appUserId: session.user.id,
        deploymentId: created.id,
        changes: targetChanges,
      })
    : null;
  res.status(201).json({
    ...(applyResult
      ? await getManagedDeployment({
          appUserId: session.user.id,
          deploymentId: created.id,
        })
      : created),
    ...(applyResult ? { applyResult } : {}),
  });
});

router.get("/algo/deployment-accounts", async (req, res): Promise<void> => {
  const session = await requireUser(req);
  const strategyKind =
    req.query.strategyKind === "equities" ? "equities" : "options";
  res.json(
    await listDeploymentAccountChoices({
      appUserId: session.user.id,
      strategyKind,
    }),
  );
});

router.get("/algo/deployments/:deploymentId", async (req, res): Promise<void> => {
  const session = await requireUser(req);
  res.json(
    await getManagedDeployment({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
    }),
  );
});

router.patch("/algo/deployments/:deploymentId", async (req, res): Promise<void> => {
  const session = await requireUserCsrf(req);
  const body = readOptionalRecord(req.body) ?? {};
  const isDraft = readOptionalBoolean(body.isDraft);
  if (body.isDraft !== undefined && isDraft === undefined) {
    throw new HttpError(400, "Invalid draft state.", {
      code: "invalid_request",
      detail: "isDraft must be a boolean.",
    });
  }
  res.json(
    await updateManagedDeployment({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
      patch: {
        ...(body.name !== undefined
          ? { name: readRequiredString(body.name, "name") }
          : {}),
        ...(body.mode !== undefined ? { mode: readRequiredMode(body.mode) } : {}),
        ...(body.symbolUniverse !== undefined
          ? { symbolUniverse: readOptionalStringArray(body.symbolUniverse)! }
          : {}),
        ...(body.config !== undefined
          ? { config: readOptionalRecord(body.config) ?? {} }
          : {}),
        ...(isDraft !== undefined ? { isDraft } : {}),
      },
    }),
  );
});

router.post("/algo/deployments/:deploymentId/archive", async (req, res): Promise<void> => {
  const session = await requireUserCsrf(req);
  res.json(
    await archiveManagedDeployment({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
    }),
  );
});

router.post("/algo/deployments/:deploymentId/restore", async (req, res): Promise<void> => {
  const session = await requireUserCsrf(req);
  res.json(
    await restoreManagedDeployment({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
    }),
  );
});

router.get("/algo/deployments/:deploymentId/targets", async (req, res): Promise<void> => {
  const session = await requireUser(req);
  res.json({
    targets: await listManagedDeploymentTargets({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
    }),
  });
});

async function applyTargetChangesRoute(
  req: Parameters<typeof requireUserCsrf>[0] & {
    params: { deploymentId: string };
    body?: unknown;
  },
) {
  const session = await requireUserCsrf(req);
  const body = readOptionalRecord(req.body) ?? {};
  return applyDeploymentTargetChanges({
    appUserId: session.user.id,
    deploymentId: req.params.deploymentId,
    changes: readTargetChanges(body.changes),
  });
}

router.post("/algo/deployments/:deploymentId/targets/apply", async (req, res): Promise<void> => {
  res.json(await applyTargetChangesRoute(req));
});

router.post("/algo/deployments/:deploymentId/targets/retry", async (req, res): Promise<void> => {
  res.json(await applyTargetChangesRoute(req));
});

router.post(
  "/algo/deployments/:deploymentId/activate-live",
  async (req, res): Promise<void> => {
    const session = await requireDeploymentAdminWrite(req);
    res.json(
      await activateManagedDeploymentLive({
        appUserId: session.user.id,
        deploymentId: req.params.deploymentId,
        targetIds: readLiveTargetIds(req.body?.targetIds),
      }),
    );
  },
);

router.post(
  "/algo/deployments/:deploymentId/targets/:targetId/takeover",
  async (req, res): Promise<void> => {
    const session = await requireUserCsrf(req);
    const target = (
      await listManagedDeploymentTargets({
        appUserId: session.user.id,
        deploymentId: req.params.deploymentId,
      })
    ).find((candidate) => candidate.id === req.params.targetId);
    if (!target) {
      throw new HttpError(404, "Deployment target not found.", {
        code: "algo_target_not_found",
      });
    }
    res.json(
      await applyDeploymentTargetChanges({
        appUserId: session.user.id,
        deploymentId: req.params.deploymentId,
        changes: [
          {
            accountType: target.accountType,
            accountId: target.accountId,
            action: "remove",
            removalMode: "manual_takeover",
          },
        ],
      }),
    );
  },
);

router.post("/algo/signal-options/default-paper-deployment", async (req, res): Promise<void> => {
  await requireAdminCsrf(req);
  const enabled =
    req.body?.enabled === false || req.body?.enabled === "false" ? false : true;

  res.status(201).json(
    await ensureDefaultSignalOptionsPaperDeployment({ enabled }),
  );
});

router.post("/algo/deployments/:deploymentId/enable", async (req, res): Promise<void> => {
  const session = await requireDeploymentAdminWrite(req);
  res.json(
    await setAlgoDeploymentEnabled({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
      enabled: true,
    }),
  );
});

router.post("/algo/deployments/:deploymentId/pause", async (req, res): Promise<void> => {
  const session = await requireDeploymentAdminWrite(req);
  res.json(
    await setAlgoDeploymentEnabled({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
      enabled: false,
    }),
  );
});

router.post("/algo/deployments/:deploymentId/mode", async (req, res): Promise<void> => {
  const session = await requireDeploymentAdminWrite(req);
  res.json(
    await setAlgoDeploymentMode({
      appUserId: session.user.id,
      deploymentId: req.params.deploymentId,
      mode: readRequiredMode(req.body?.mode),
    }),
  );
});

router.patch("/algo/deployments/:deploymentId/strategy-settings", async (req, res): Promise<void> => {
  await requireDeploymentAdminWrite(req);
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
  await requireDeploymentAdminWrite(req);
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
  await requireDeploymentAdminWrite(req);
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
  await requireDeploymentAdminWrite(req);
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
  await requireDeploymentAdminWrite(req);
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
  await requireDeploymentAdminWrite(req);
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
  await requireDeploymentAdminWrite(req);
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
  res.setHeader("Cache-Control", "private, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  recordSseStreamOpen("algo-cockpit");

  let closed = false;
  let unsubscribe = () => {};
  let closeReason: SseStreamCloseReason = "server_cleanup";
  let writer: ReturnType<typeof createSseConnectionWriter> | null = null;
  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    writer?.close();
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
  writer = createSseConnectionWriter({
    response: res,
    onWriteFailure: (reason) => {
      closeReason = reason;
      cleanup();
    },
  });
  writer.writeChunk("retry: 5000\n\n");

  try {
    const input = {
      appUserId: session.user.id,
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
    writer.writeEvent("live", initialPayload);
    writer.writeEvent("ready", {
      stream: "algo-cockpit",
      mode: initialPayload.mode,
      deploymentId: initialPayload.deploymentId,
      source: "algo-cockpit",
    });
    if (readableDeploymentId === null) {
      return;
    }
    unsubscribe = subscribeAlgoCockpitSnapshots(
      input,
      async (payload) => {
        try {
          const scopedPayload = await scopeAlgoCockpitPayloadForSession(
            session,
            payload,
          );
          if (!closed) {
            // Live and freshness frames are an ordered pair, so they are
            // intentionally not coalesced independently.
            writer?.writeEvent("live", scopedPayload);
          }
        } catch (error) {
          if (!closed) {
            writer?.writeEvent("error", {
              title: "Algo cockpit stream scope failed",
              status: 500,
              detail:
                error instanceof Error
                  ? error.message
                  : "Unknown stream error.",
            });
          }
          throw error;
        }
      },
      {
        initialPayload,
        onPollSuccess: ({ changed, payload }) => {
          if (!closed) {
            writer?.writeEvent("freshness", {
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
      writer.writeEvent("error", {
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
