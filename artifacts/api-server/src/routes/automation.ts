import { Router, type IRouter, type Response } from "express";
import { HttpError } from "../lib/errors";
import {
  fetchAlgoCockpitCriticalPayload,
  subscribeAlgoCockpitSnapshots,
} from "../services/algo-cockpit-streams";
import {
  createAlgoDeployment,
  listAlgoDeployments,
  listExecutionEvents,
  setAlgoDeploymentEnabled,
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
import {
  getApiRouteAdmission,
  withRouteAdmissionMetadata,
} from "../services/route-admission";

const router: IRouter = Router();

function writeSseEvent(
  res: Response,
  event: string,
  payload: unknown,
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
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

function readRequiredMode(value: unknown): "paper" | "live" {
  if (value === "paper" || value === "live") {
    return value;
  }

  throw new HttpError(400, "Missing mode.", {
    code: "invalid_request",
    detail: "mode must be either 'paper' or 'live'.",
  });
}

router.get("/algo/deployments", async (req, res): Promise<void> => {
  const mode = req.query.mode === "live" ? "live" : req.query.mode === "paper" ? "paper" : undefined;

  res.json(await listAlgoDeployments({ mode }));
});

router.post("/algo/deployments", async (req, res): Promise<void> => {
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
  const enabled =
    req.body?.enabled === false || req.body?.enabled === "false" ? false : true;

  res.status(201).json(
    await ensureDefaultSignalOptionsPaperDeployment({ enabled }),
  );
});

router.post("/algo/deployments/:deploymentId/enable", async (req, res): Promise<void> => {
  res.json(
    await setAlgoDeploymentEnabled({
      deploymentId: req.params.deploymentId,
      enabled: true,
    }),
  );
});

router.post("/algo/deployments/:deploymentId/pause", async (req, res): Promise<void> => {
  res.json(
    await setAlgoDeploymentEnabled({
      deploymentId: req.params.deploymentId,
      enabled: false,
    }),
  );
});

router.patch("/algo/deployments/:deploymentId/strategy-settings", async (req, res): Promise<void> => {
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

router.get("/algo/deployments/:deploymentId/signal-options/state", async (req, res): Promise<void> => {
  const admission = getApiRouteAdmission(res);
  res.json(
    withRouteAdmissionMetadata(
      await listSignalOptionsAutomationState({
        deploymentId: req.params.deploymentId,
        cacheMode: admission.cacheOnly ? "cache-only" : "normal",
      }),
      admission,
    ),
  );
});

router.get("/algo/deployments/:deploymentId/cockpit", async (req, res): Promise<void> => {
  const admission = getApiRouteAdmission(res);
  res.json(
    withRouteAdmissionMetadata(
      await getAlgoDeploymentCockpit({
        deploymentId: req.params.deploymentId,
        cacheMode: admission.cacheOnly ? "cache-only" : "normal",
      }),
      admission,
    ),
  );
});

router.get("/algo/deployments/:deploymentId/signal-options/performance", async (req, res): Promise<void> => {
  const admission = getApiRouteAdmission(res);
  res.json(
    withRouteAdmissionMetadata(
      await getSignalOptionsPerformance({
        deploymentId: req.params.deploymentId,
        cacheMode: admission.cacheOnly ? "cache-only" : "normal",
      }),
      admission,
    ),
  );
});

router.post("/algo/deployments/:deploymentId/signal-options/shadow-scan", async (req, res): Promise<void> => {
  res.json(
    await runSignalOptionsShadowScan({
      deploymentId: req.params.deploymentId,
      forceEvaluate: true,
      source: "manual",
    }),
  );
});

router.post("/algo/deployments/:deploymentId/signal-options/backfill", async (req, res): Promise<void> => {
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
  const deploymentId =
    typeof req.query.deploymentId === "string" && req.query.deploymentId.trim()
      ? req.query.deploymentId.trim()
      : undefined;
  const limit =
    typeof req.query.limit === "string" && req.query.limit.trim()
      ? Number(req.query.limit)
      : undefined;

  res.json(
    await listExecutionEvents({
      deploymentId,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  );
});

router.get("/streams/algo/cockpit", async (req, res): Promise<void> => {
  const mode: "paper" | "live" = req.query.mode === "live" ? "live" : "paper";
  const deploymentId =
    typeof req.query.deploymentId === "string" && req.query.deploymentId.trim()
      ? req.query.deploymentId.trim()
      : null;
  const eventLimit =
    typeof req.query.eventLimit === "string" && req.query.eventLimit.trim()
      ? Number(req.query.eventLimit)
      : undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write("retry: 5000\n\n");

  let closed = false;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe();
    if (!res.destroyed) {
      res.end();
    }
  };
  req.on("aborted", cleanup);
  res.on("close", cleanup);

  try {
    const input = {
      deploymentId,
      mode,
      eventLimit: Number.isFinite(eventLimit) ? eventLimit : undefined,
    };
    const initialPayload = await fetchAlgoCockpitCriticalPayload(input);
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
          writeSseEvent(res, "live", payload);
        }
      },
      {
        initialPayload,
        onPollSuccess: ({ changed, payload }) => {
          if (!closed) {
            writeSseEvent(res, "freshness", {
              stream: "algo-cockpit",
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
    cleanup();
  }
});

export default router;
