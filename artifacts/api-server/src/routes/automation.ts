import { Router, type IRouter } from "express";
import { HttpError } from "../lib/errors";
import {
  createAlgoDeployment,
  listAlgoDeployments,
  listExecutionEvents,
  setAlgoDeploymentEnabled,
} from "../services/automation";
import {
  listSignalOptionsAutomationState,
  recordSignalOptionsManualDeviation,
  runSignalOptionsShadowScan,
  updateSignalOptionsExecutionProfile,
} from "../services/signal-options-automation";

const router: IRouter = Router();

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

router.get("/algo/deployments/:deploymentId/signal-options/state", async (req, res): Promise<void> => {
  res.json(
    await listSignalOptionsAutomationState({
      deploymentId: req.params.deploymentId,
    }),
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

export default router;
