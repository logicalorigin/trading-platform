import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  CancelBacktestJobParams,
  CancelBacktestJobResponse,
  CreateBacktestRunBody,
  CreateBacktestStudyBody,
  CreateBacktestSweepBody,
  GetBacktestRunChartParams,
  GetBacktestRunChartQueryParams,
  GetBacktestRunChartResponse,
  GetBacktestRunParams,
  GetBacktestRunResponse,
  GetBacktestStudyParams,
  GetBacktestStudyPreviewChartParams,
  GetBacktestStudyPreviewChartResponse,
  GetBacktestStudyResponse,
  GetBacktestSweepParams,
  GetBacktestSweepResponse,
  ListBacktestDraftStrategiesResponse,
  ListBacktestJobsResponse,
  ListBacktestRunsQueryParams,
  ListBacktestRunsResponse,
  ListBacktestStrategiesResponse,
  ListBacktestStudiesResponse,
  PromoteBacktestRunBody,
  PromoteBacktestRunParams,
} from "@workspace/api-zod";
import {
  cancelBacktestJob,
  createBacktestRun,
  createBacktestStudy,
  createBacktestSweep,
  createOvernightSignalExpectancyStudy,
  createPatternDiscoveryStudy,
  getBacktestRunChart,
  getBacktestRun,
  getBacktestStudy,
  getBacktestStudyPreviewChart,
  getBacktestSweep,
  getOvernightSignalExpectancyResults,
  getPatternDiscoveryResults,
  getPatternOccurrences,
  listOvernightSignalExpectancySamples,
  listBacktestDraftStrategies,
  listBacktestJobs,
  listBacktestRuns,
  listBacktestStrategies,
  listBacktestStudies,
  promoteBacktestRun,
  resolveBacktestOptionContract,
} from "../services/backtesting";
import { promoteMtfPatternToDeployment } from "../services/signal-options-automation";
import { requireAdminCsrf } from "./auth";

const router: IRouter = Router();

export const BACKTEST_WORKER_RESOLVE_OPTION_PATH =
  "/backtests/internal/resolve-option-contract";
const BACKTEST_WORKER_TOKEN_ENVS = [
  "PYRUS_BACKTEST_WORKER_TOKEN",
  "PYRUS_BACKTEST_WORKER_NEXT_TOKEN",
] as const;

function configuredBacktestWorkerTokens(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return Array.from(
    new Set(
      BACKTEST_WORKER_TOKEN_ENVS.map((name) => env[name]?.trim() ?? "").filter(
        (token) => token.length >= 32,
      ),
    ),
  );
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function isBacktestWorkerServiceRequest(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const match = (req.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  const provided = match?.[1]?.trim() ?? "";
  return (
    provided.length > 0 &&
    configuredBacktestWorkerTokens(env).some((token) =>
      safeTokenEqual(provided, token),
    )
  );
}

function admitBacktestWorkerService(req: Request, res: Response): boolean {
  const tokens = configuredBacktestWorkerTokens();
  if (!tokens.length) {
    res.status(404).json({ title: "Not found", status: 404 });
    return false;
  }
  if (!isBacktestWorkerServiceRequest(req)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="backtest-worker"');
    res.status(401).json({ title: "Unauthorized", status: 401 });
    return false;
  }
  return true;
}

router.get("/backtests/strategies", async (_req, res): Promise<void> => {
  const data = ListBacktestStrategiesResponse.parse(listBacktestStrategies());
  res.json(data);
});

router.get("/backtests/studies", async (_req, res): Promise<void> => {
  const data = ListBacktestStudiesResponse.parse(await listBacktestStudies());
  res.json(data);
});

router.post("/backtests/studies", async (req, res): Promise<void> => {
  const body = CreateBacktestStudyBody.parse(req.body);
  const data = await createBacktestStudy(body);
  res.status(201).json(data);
});

router.get("/backtests/studies/:studyId", async (req, res): Promise<void> => {
  const params = GetBacktestStudyParams.parse(req.params);
  const data = GetBacktestStudyResponse.parse(
    await getBacktestStudy(params.studyId),
  );
  res.json(data);
});

router.get(
  "/backtests/studies/:studyId/preview-chart",
  async (req, res): Promise<void> => {
    const params = GetBacktestStudyPreviewChartParams.parse(req.params);
    const data = GetBacktestStudyPreviewChartResponse.parse(
      await getBacktestStudyPreviewChart(params.studyId),
    );
    res.json(data);
  },
);

router.get("/backtests/runs", async (req, res): Promise<void> => {
  const query = ListBacktestRunsQueryParams.parse(req.query);
  const data = ListBacktestRunsResponse.parse(await listBacktestRuns(query));
  res.json(data);
});

router.post("/backtests/runs", async (req, res): Promise<void> => {
  const body = CreateBacktestRunBody.parse(req.body);
  const data = GetBacktestRunResponse.parse(await createBacktestRun(body));
  res.status(201).json(data);
});

router.post(
  BACKTEST_WORKER_RESOLVE_OPTION_PATH,
  async (req, res): Promise<void> => {
    if (!admitBacktestWorkerService(req, res)) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const underlying =
      typeof body.underlying === "string" ? body.underlying.trim() : "";
    const occurredAt = new Date(String(body.occurredAt ?? ""));
    const right = body.right === "put" ? "put" : body.right === "call" ? "call" : null;
    const spotPrice =
      typeof body.spotPrice === "number"
        ? body.spotPrice
        : Number(body.spotPrice);
    const contractPresetId =
      typeof body.contractPresetId === "string" && body.contractPresetId.trim()
        ? body.contractPresetId.trim()
        : null;
    const signalOptionsProfile =
      body.signalOptionsProfile &&
      typeof body.signalOptionsProfile === "object" &&
      !Array.isArray(body.signalOptionsProfile)
        ? (body.signalOptionsProfile as Record<string, unknown>)
        : null;

    if (
      !underlying ||
      Number.isNaN(occurredAt.getTime()) ||
      !right ||
      !Number.isFinite(spotPrice) ||
      spotPrice <= 0
    ) {
      res.status(400).json({
        error: "Invalid option-contract resolution request.",
      });
      return;
    }

    const contract = await resolveBacktestOptionContract({
      underlying,
      occurredAt,
      right,
      spotPrice,
      contractPresetId,
      signalOptionsProfile,
    });
    res.json({ contract });
  },
);

router.get("/backtests/runs/:runId", async (req, res): Promise<void> => {
  const params = GetBacktestRunParams.parse(req.params);
  const data = GetBacktestRunResponse.parse(await getBacktestRun(params.runId));
  res.json(data);
});

router.get("/backtests/runs/:runId/chart", async (req, res): Promise<void> => {
  const params = GetBacktestRunChartParams.parse(req.params);
  const query = GetBacktestRunChartQueryParams.parse(req.query);
  const data = GetBacktestRunChartResponse.parse(
    await getBacktestRunChart(params.runId, query),
  );
  res.json(data);
});

router.post(
  "/backtests/runs/:runId/promote",
  async (req, res): Promise<void> => {
    const params = PromoteBacktestRunParams.parse(req.params);
    const body = PromoteBacktestRunBody.parse(req.body);
    const data = await promoteBacktestRun({
      runId: params.runId,
      name: body.name,
      notes: body.notes,
    });
    res.status(201).json(data);
  },
);

router.post("/backtests/sweeps", async (req, res): Promise<void> => {
  const body = CreateBacktestSweepBody.parse(req.body);
  const data = GetBacktestSweepResponse.parse(await createBacktestSweep(body));
  res.status(201).json(data);
});

router.get("/backtests/sweeps/:sweepId", async (req, res): Promise<void> => {
  const params = GetBacktestSweepParams.parse(req.params);
  const data = GetBacktestSweepResponse.parse(
    await getBacktestSweep(params.sweepId),
  );
  res.json(data);
});

router.get("/backtests/jobs", async (_req, res): Promise<void> => {
  const data = ListBacktestJobsResponse.parse(await listBacktestJobs());
  res.json(data);
});

router.post(
  "/backtests/jobs/:jobId/cancel",
  async (req, res): Promise<void> => {
    const params = CancelBacktestJobParams.parse(req.params);
    const data = CancelBacktestJobResponse.parse(
      await cancelBacktestJob(params.jobId),
    );
    res.json(data);
  },
);

router.get("/backtests/drafts", async (_req, res): Promise<void> => {
  const data = ListBacktestDraftStrategiesResponse.parse(
    await listBacktestDraftStrategies(),
  );
  res.json(data);
});

const OvernightTimeframe = z.enum(["15m", "30m", "1h", "4h"]);

const CreateOvernightExpectancyBody = z.object({
  name: z.string().min(1).optional(),
  symbols: z.array(z.string().min(1)).optional(),
  signalTimeframes: z.array(OvernightTimeframe).min(1).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  signalSettingsByTimeframe: z.record(z.record(z.unknown())).optional(),
  persistSamples: z.boolean().optional(),
});

const OvernightSamplesQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  timeframe: OvernightTimeframe.optional(),
  symbol: z.string().min(1).optional(),
  status: z
    .enum([
      "valid",
      "sell_state",
      "no_signal",
      "missing_return",
      "insufficient_warmup",
    ])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.post(
  "/backtests/overnight-expectancy",
  async (req, res): Promise<void> => {
    const body = CreateOvernightExpectancyBody.parse(req.body);
    const data = await createOvernightSignalExpectancyStudy(body);
    res.status(201).json(data);
  },
);

router.get(
  "/backtests/overnight-expectancy/:studyId",
  async (req, res): Promise<void> => {
    const studyId = z.string().uuid().parse(req.params.studyId);
    const data = await getOvernightSignalExpectancyResults(studyId);
    if (!data) {
      res.status(404).json({ error: "study_not_found" });
      return;
    }
    res.json(data);
  },
);

router.get(
  "/backtests/overnight-expectancy/:studyId/samples",
  async (req, res): Promise<void> => {
    const studyId = z.string().uuid().parse(req.params.studyId);
    const query = OvernightSamplesQuery.parse(req.query);
    const data = await listOvernightSignalExpectancySamples(studyId, query);
    res.json(data);
  },
);

const PatternDiscoveryBody = z.object({
  name: z.string().min(1),
  symbols: z.array(z.string().min(1)).min(1),
  timeframeSet: z.array(z.string().min(1)).min(1),
  baseTimeframe: z.string().optional(),
  forwardHorizonsBars: z.array(z.number().int().positive()).optional(),
  minSampleThreshold: z.number().int().nonnegative().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  signalSettingsByTimeframe: z.record(z.record(z.unknown())).optional(),
  persistOccurrences: z.boolean().optional(),
});

router.post("/backtests/pattern-discovery", async (req, res): Promise<void> => {
  const body = PatternDiscoveryBody.parse(req.body);
  const data = await createPatternDiscoveryStudy(body);
  res.status(201).json(data);
});

router.get(
  "/backtests/pattern-discovery/:studyId",
  async (req, res): Promise<void> => {
    const studyId = z.string().uuid().parse(req.params.studyId);
    const horizonBars =
      req.query.horizonBars != null
        ? z.coerce.number().int().parse(req.query.horizonBars)
        : undefined;
    const data = await getPatternDiscoveryResults(studyId, horizonBars);
    if (!data) {
      res.status(404).json({ error: "study_not_found" });
      return;
    }
    res.json(data);
  },
);

router.get(
  "/backtests/pattern-discovery/:studyId/occurrences",
  async (req, res): Promise<void> => {
    const studyId = z.string().uuid().parse(req.params.studyId);
    const patternKey = z.string().min(1).parse(req.query.patternKey);
    const horizonBars = z.coerce.number().int().parse(req.query.horizonBars);
    const data = await getPatternOccurrences(studyId, patternKey, horizonBars);
    res.json(data);
  },
);

router.post(
  "/backtests/pattern-discovery/promote",
  async (req, res): Promise<void> => {
    await requireAdminCsrf(req);
    const body = z
      .object({
        deploymentId: z.string().min(1),
        patternKey: z.string().min(1),
      })
      .parse(req.body);
    const data = await promoteMtfPatternToDeployment(body);
    res.status(200).json(data);
  },
);

export default router;
