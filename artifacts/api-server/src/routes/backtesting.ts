import { Router, type IRouter } from "express";
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
  getBacktestRunChart,
  getBacktestRun,
  getBacktestStudy,
  getBacktestStudyPreviewChart,
  getBacktestSweep,
  listBacktestDraftStrategies,
  listBacktestJobs,
  listBacktestRuns,
  listBacktestStrategies,
  listBacktestStudies,
  promoteBacktestRun,
  resolveBacktestOptionContract,
} from "../services/backtesting";

const router: IRouter = Router();

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
  "/backtests/internal/resolve-option-contract",
  async (req, res): Promise<void> => {
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

export default router;
