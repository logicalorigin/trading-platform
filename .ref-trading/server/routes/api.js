import crypto from "node:crypto";
import {
  buildOrderPreview,
  normalizeClosePayload,
  normalizeOrderPayload,
} from "../services/orderValidation.js";
import {
  buildOrderPreflight,
  isBlockingPreflight,
} from "../services/orderPreflight.js";
import {
  normalizeOptionContractPayload,
  parseOptionContractId,
} from "../services/optionContracts.js";
import {
  buildEtradeAuthorizeUrl,
  etDateKey,
  exchangeEtradeAccessToken,
  isLikelyExpiredByEtDate,
  renewEtradeAccessToken,
  requestEtradeRequestToken,
  resolveEtradeConsumerCredentials,
  revokeEtradeAccessToken,
} from "../services/etradeOAuth.js";
import {
  detectPlaywrightAvailability,
  runEtradeOAuthAutomation,
} from "../services/etradeAuthAutomation.js";
import {
  buildWebullConnectAuthorizeUrl,
  exchangeWebullConnectToken,
  refreshWebullConnectToken,
  resolveWebullConnectAuthorizeUrl,
  resolveWebullConnectCredentials,
  resolveWebullConnectApiBaseUrl,
} from "../services/webullConnectOAuth.js";
import { hydrateRuntimeEnvFromSnapshot } from "../services/runtimeEnv.js";
import {
  buildAccountPerformancePayload,
  buildBenchmarkSeriesFromBars,
} from "../services/performanceModel.js";
import {
  getMassiveCacheStats,
  resolveMassiveOptionReplayDataset,
  searchMassiveOptionContracts,
  getMassiveOptionsBarsWithCache,
  probeMassiveApi,
  resolveMassiveApiKey,
} from "../services/massiveClient.js";
import {
  runMassiveOptionReplayBacktest,
  streamMassiveOptionReplayBacktest,
} from "../services/researchBacktest.js";
import { resolveResearchSpotHistory } from "../services/researchSpotHistory.js";

import {
  getAccountHistoryDbStats,
  loadAccountEquityHistoryFromDb,
  loadAccountNativeHistoryRowsFromDb,
  normalizeAccountEquityHistorySources,
  upsertAccountEquityHistory,
  upsertAccountNativeHistoryRows,
} from "../services/accountHistoryDb.js";

hydrateRuntimeEnvFromSnapshot();
import {
  generateRayAlgoSignals,
  normalizeRayAlgoSignalPayload,
  normalizeRayAlgoSignalClass,
} from "../services/rayalgoCore.js";
import { computeRayAlgoParityReport } from "../services/rayalgoParity.js";

const ACCOUNT_AUTH_DISPLAY_REFRESH_TTL_MS = 60_000;
const POSITIONS_STALE_MAX_AGE_MS = 2 * 60_000;
const POSITIONS_STALE_MAX_FAILURES = 2;
const ACCOUNT_HISTORY_MAINTENANCE_HEADER = "x-maintenance-token";
const MASSIVE_BACKTEST_TIMEOUT_MS = 180_000;

const ENV_CREDENTIAL_KEYS_BY_BROKER = {
  etrade: [
    "ETRADE_PROD_KEY",
    "ETRADE_PROD_SECRET",
    "ETRADE_SB_KEY",
    "ETRADE_SB_SECRET",
    "ETRADE_ACCESS_TOKEN",
    "ETRADE_ACCESS_SECRET",
    "ETRADE_VERIFIER",
    "ETRADE_ACCOUNT_ID_KEY",
    "ETRADE_WEB_USERNAME",
    "ETRADE_WEB_PASSWORD",
    "ETRADE_TOTP_SECRET",
    "ETRADE_AUTH_CALLBACK_URL",
  ],
  webull: [
    "WEBULL_APP_KEY",
    "WEBULL_APP_SECRET",
    "WEBULL_CLIENT_ID",
    "WEBULL_CLIENT_SECRET",
    "WEBULL_OAUTH_SCOPE",
    "WEBULL_OAUTH_REDIRECT_URI",
    "WEBULL_ACCOUNT_ID",
    "WEBULL_REGION",
    "WEBULL_API_BASE_URL",
    "WEBULL_TRADE_PIN",
    "WEBULL_EMAIL",
    "WEBULL_PASSWORD",
  ],
  ibkr: [
    "IBKR_BASE_URL",
    "IBKR_ACCOUNT_ID",
    "IBKR_USERNAME",
    "IBKR_PASSWORD",
    "IBKR_ALLOW_INSECURE_TLS",
  ],
  data: [
    "MASSIVE_API_KEY",
    "POLYGON_API_KEY",
    "UW_API_KEY",
  ],
};

const ENV_CREDENTIAL_ALIASES = {
  ETRADE_PROD_KEY: [
    "ETRADE_PROD_KEY",
    "ETRADE_API_KEY",
    "ETRADE_CONSUMER_KEY",
    "ETRADE_CLIENT_KEY",
    "ETRADE_PRODUCTION_KEY",
    "ETRADE_KEY",
  ],
  ETRADE_PROD_SECRET: [
    "ETRADE_PROD_SECRET",
    "ETRADE_API_SECRET",
    "ETRADE_CONSUMER_SECRET",
    "ETRADE_CLIENT_SECRET",
    "ETRADE_PRODUCTION_SECRET",
    "ETRADE_SECRET",
  ],
  ETRADE_SB_KEY: [
    "ETRADE_SB_KEY",
    "ETRADE_SANDBOX_KEY",
    "ETRADE_SANDBOX_API_KEY",
  ],
  ETRADE_SB_SECRET: [
    "ETRADE_SB_SECRET",
    "ETRADE_SANDBOX_SECRET",
    "ETRADE_SANDBOX_API_SECRET",
  ],
  ETRADE_ACCESS_TOKEN: [
    "ETRADE_ACCESS_TOKEN",
    "ETRADE_ACCESSTOKEN",
    "ETRADE_OAUTH_TOKEN",
    "ETRADE_TOKEN",
  ],
  ETRADE_ACCESS_SECRET: [
    "ETRADE_ACCESS_SECRET",
    "ETRADE_ACCESS_TOKEN_SECRET",
    "ETRADE_OAUTH_TOKEN_SECRET",
    "ETRADE_TOKEN_SECRET",
  ],
  ETRADE_VERIFIER: [
    "ETRADE_VERIFIER",
    "ETRADE_VERIFICATION_CODE",
  ],
  ETRADE_ACCOUNT_ID_KEY: [
    "ETRADE_ACCOUNT_ID_KEY",
    "ETRADE_ACCOUNT_ID",
    "ETRADE_ACCOUNT",
  ],
  ETRADE_WEB_USERNAME: [
    "ETRADE_WEB_USERNAME",
    "ETRADE_USERNAME",
    "ETRADE_LOGIN_USERNAME",
    "ETRADE_USER",
  ],
  ETRADE_WEB_PASSWORD: [
    "ETRADE_WEB_PASSWORD",
    "ETRADE_PASSWORD",
    "ETRADE_LOGIN_PASSWORD",
    "ETRADE_PASS",
  ],
  ETRADE_TOTP_SECRET: [
    "ETRADE_TOTP_SECRET",
    "ETRADE_OTP_SECRET",
    "ETRADE_MFA_SECRET",
  ],
  ETRADE_AUTH_CALLBACK_URL: [
    "ETRADE_AUTH_CALLBACK_URL",
    "ETRADE_CALLBACK_URL",
  ],
  WEBULL_APP_KEY: [
    "WEBULL_APP_KEY",
    "WEBULL_APPLICATION_KEY",
    "WEBULL_API_KEY",
    "WEBULL_KEY",
  ],
  WEBULL_APP_SECRET: [
    "WEBULL_APP_SECRET",
    "WEBULL_APPLICATION_SECRET",
    "WEBULL_API_SECRET",
    "WEBULL_SECRET",
  ],
  WEBULL_CLIENT_ID: [
    "WEBULL_CLIENT_ID",
    "WEBULL_OAUTH_CLIENT_ID",
    "WEBULL_CONNECT_CLIENT_ID",
  ],
  WEBULL_CLIENT_SECRET: [
    "WEBULL_CLIENT_SECRET",
    "WEBULL_OAUTH_CLIENT_SECRET",
    "WEBULL_CONNECT_CLIENT_SECRET",
  ],
  WEBULL_OAUTH_SCOPE: [
    "WEBULL_OAUTH_SCOPE",
    "WEBULL_SCOPE",
    "WEBULL_CONNECT_SCOPE",
  ],
  WEBULL_OAUTH_REDIRECT_URI: [
    "WEBULL_OAUTH_REDIRECT_URI",
    "WEBULL_REDIRECT_URI",
    "WEBULL_CONNECT_REDIRECT_URI",
  ],
  WEBULL_ACCESS_TOKEN: [
    "WEBULL_ACCESS_TOKEN",
    "WEBULL_TOKEN",
    "WEBULL_OPENAPI_TOKEN",
  ],
  WEBULL_ACCOUNT_ID: [
    "WEBULL_ACCOUNT_ID",
    "WEBULL_ACCOUNT",
    "WEBULL_ACCOUNT_NO",
  ],
  WEBULL_REGION: [
    "WEBULL_REGION",
    "WEBULL_REGION_ID",
  ],
  WEBULL_API_BASE_URL: [
    "WEBULL_API_BASE_URL",
    "WEBULL_API_ENDPOINT",
    "WEBULL_ENDPOINT",
  ],
  WEBULL_TRADE_PIN: [
    "WEBULL_TRADE_PIN",
    "WEBULL_TRADING_PIN",
    "WEBULL_PIN_CODE",
    "WEBULL_PIN",
  ],
  WEBULL_EMAIL: [
    "WEBULL_EMAIL",
    "WEBULL_LOGIN_EMAIL",
    "WEBULL_USER_EMAIL",
    "WEBULL_USERNAME",
    "WEBULL_USER",
  ],
  WEBULL_PASSWORD: [
    "WEBULL_PASSWORD",
    "WEBULL_LOGIN_PASSWORD",
    "WEBULL_PASSCODE",
    "WEBULL_USER_PASSWORD",
    "WEBULL_PASS",
  ],
  IBKR_BASE_URL: [
    "IBKR_BASE_URL",
    "IBKR_GATEWAY_URL",
  ],
  IBKR_ACCOUNT_ID: [
    "IBKR_ACCOUNT_ID",
    "IBKR_ACCOUNT",
  ],
  IBKR_USERNAME: [
    "IBKR_USERNAME",
    "IBKR_USER",
  ],
  IBKR_PASSWORD: [
    "IBKR_PASSWORD",
    "IBKR_PASS",
  ],
  IBKR_ALLOW_INSECURE_TLS: [
    "IBKR_ALLOW_INSECURE_TLS",
    "IBKR_INSECURE_TLS",
    "IBKR_TLS_INSECURE",
  ],
  MASSIVE_API_KEY: [
    "MASSIVE_API_KEY",
    "POLYGON_API_KEY",
    "MASSIVE_KEY",
  ],
  POLYGON_API_KEY: [
    "POLYGON_API_KEY",
    "MASSIVE_API_KEY",
    "POLYGON_KEY",
  ],
  UW_API_KEY: [
    "UW_API_KEY",
    "UNUSUAL_WHALES_API_KEY",
    "UNUSUALWHALES_API_KEY",
    "UNUSUAL_WHALES_TOKEN",
    "UW_TOKEN",
  ],
};

const STRICT_LIVE_BLOCKED_SOURCE_MARKERS = [
  "synthetic",
  "fallback",
  "dry-run",
  "unavailable",
  "anchored",
];

export function createApiHandler({
  store,
  adapters,
  aiFusion = null,
  researchSpotWarmWorker = null,
  massiveOptionsTracker = null,
  researchBacktestJobs = null,
  researchScoreStudies = null,
}) {
  return async function handleApiRequest(req, res) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = requestUrl.pathname;
    const method = (req.method || "GET").toUpperCase();

    if (method === "GET" && pathname === "/api/health") {
      const warmStatus = researchSpotWarmWorker?.getStatus?.() || null;
      const warmLastResult = warmStatus?.lastResult || null;
      const warmSkipped = String(warmLastResult?.skipped || "").trim().toLowerCase();
      const warmError = String(warmLastResult?.error || "").trim() || null;
      const warmStatusLevel = !warmStatus
        ? "unavailable"
        : !warmStatus.running
          ? "idle"
          : warmError && !["disabled", "db_unconfigured", "missing_api_key", "no_symbols", "not_leader", "in_flight"].includes(warmSkipped)
            ? "degraded"
            : "ok";
      return sendJson(res, 200, {
        ok: true,
        now: new Date().toISOString(),
        services: {
          researchSpotWarm: warmStatus
            ? {
                status: warmStatusLevel,
                running: Boolean(warmStatus.running),
                inFlight: Boolean(warmStatus.inFlight),
                nextRunAt: warmStatus.nextRunAt || null,
                lastResult: warmLastResult
                  ? {
                      ok: Boolean(warmLastResult.ok),
                      at: warmLastResult.at || null,
                      reason: warmLastResult.reason || null,
                      skipped: warmLastResult.skipped || null,
                      symbol: warmLastResult.symbol || null,
                      error: warmError,
                    }
                  : null,
              }
            : null,
        },
      });
    }

    if (method === "GET" && pathname === "/api/dashboard-layout") {
      const dashboardId = String(requestUrl.searchParams.get("dashboardId") || "market-dashboard");
      const layout = store.getDashboardLayout(dashboardId);
      return sendJson(res, 200, {
        dashboardId,
        layout,
      });
    }

    if (method === "PUT" && pathname === "/api/dashboard-layout") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const dashboardId = String(
        payload.dashboardId
        || requestUrl.searchParams.get("dashboardId")
        || "market-dashboard",
      );
      const layoutPayload = payload.layout && typeof payload.layout === "object"
        ? payload.layout
        : payload;
      const layout = await store.upsertDashboardLayout(dashboardId, {
        ...layoutPayload,
        dashboardId,
      });
      return sendJson(res, 200, {
        dashboardId,
        layout,
      });
    }

    if (method === "GET" && pathname === "/api/research/history") {
      const history = store.getResearchHistory();
      return sendJson(res, 200, {
        ok: true,
        history,
      });
    }

    if (method === "PUT" && pathname === "/api/research/history") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const historyPayload = payload?.history && typeof payload.history === "object"
        ? payload.history
        : payload;
      const history = await store.upsertResearchHistory(historyPayload);
      return sendJson(res, 200, {
        ok: true,
        history,
      });
    }

    if (method === "GET" && pathname === "/api/research/score-studies/runs") {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      await researchScoreStudies?.sweepExpiredJobs?.();
      const [runs, jobs, activeJob] = await Promise.all([
        researchScoreStudies.listRuns({ limit: 40 }),
        researchScoreStudies.listJobs({ limit: 18 }),
        researchScoreStudies.getLatestActiveJob(),
      ]);
      return sendJson(res, 200, {
        ok: true,
        runs,
        jobs,
        activeJob,
      });
    }

    if (method === "POST" && pathname === "/api/research/score-studies/runs") {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const run = await researchScoreStudies.saveRun({
        source: payload?.source || "local_ui",
        presetId: payload?.presetId || null,
        presetLabel: payload?.presetLabel || null,
        payload: payload?.payload || null,
        validityStatus: payload?.validityStatus || "valid",
        validityReason: payload?.validityReason || null,
        provenance: payload?.provenance || null,
        provenanceKey: payload?.provenanceKey || null,
      });
      return sendJson(res, 200, {
        ok: true,
        run,
      });
    }

    if (method === "GET" && pathname.startsWith("/api/research/score-studies/runs/")) {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      const runId = decodeURIComponent(pathname.split("/").pop() || "");
      const run = await researchScoreStudies.getRun(runId);
      if (!run) {
        return sendJson(res, 404, { error: "Score-study run not found" });
      }
      return sendJson(res, 200, {
        ok: true,
        run,
      });
    }

    if (method === "POST" && pathname === "/api/research/score-studies/jobs") {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      const job = await researchScoreStudies.createJob({
        requestPayload: payload?.payload || null,
        presetId: payload?.presetId || null,
        presetLabel: payload?.presetLabel || null,
        symbol: payload?.symbol || payload?.payload?.marketSymbol || "SPY",
        apiKey,
      });
      return sendJson(res, 200, {
        ok: true,
        job,
      });
    }

    if (method === "GET" && pathname.match(/^\/api\/research\/score-studies\/jobs\/[^/]+\/stream$/)) {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      await researchScoreStudies?.sweepExpiredJobs?.();
      const match = pathname.match(/^\/api\/research\/score-studies\/jobs\/([^/]+)\/stream$/);
      const jobId = decodeURIComponent(match?.[1] || "");
      const currentJob = await researchScoreStudies.getJob(jobId);
      if (!currentJob) {
        return sendJson(res, 404, { error: "Score-study job not found" });
      }

      let clientClosed = false;
      let unsubscribe = () => {};
      let heartbeatId = null;
      const closeStream = () => {
        clientClosed = true;
        if (heartbeatId != null) {
          clearInterval(heartbeatId);
          heartbeatId = null;
        }
        unsubscribe();
      };
      req.on("close", closeStream);
      res.on("close", closeStream);

      startNdjsonStream(res, 200);
      writeNdjsonEvent(res, {
        type: "job",
        job: currentJob,
      });
      if (["completed", "failed", "cancelled"].includes(String(currentJob.status || ""))) {
        res.end();
        return;
      }

      unsubscribe = researchScoreStudies.subscribeJob(jobId, (job) => {
        if (clientClosed) {
          return;
        }
        writeNdjsonEvent(res, {
          type: "job",
          job,
        });
        if (["completed", "failed", "cancelled"].includes(String(job?.status || ""))) {
          closeStream();
          if (!res.writableEnded) {
            res.end();
          }
        }
      });
      heartbeatId = setInterval(() => {
        if (clientClosed) {
          return;
        }
        writeNdjsonEvent(res, {
          type: "heartbeat",
          at: new Date().toISOString(),
        });
      }, 15000);
      return;
    }

    if (method === "GET" && pathname.match(/^\/api\/research\/score-studies\/jobs\/[^/]+\/events$/)) {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      await researchScoreStudies?.sweepExpiredJobs?.();
      const match = pathname.match(/^\/api\/research\/score-studies\/jobs\/([^/]+)\/events$/);
      const jobId = decodeURIComponent(match?.[1] || "");
      const currentJob = await researchScoreStudies.getJob(jobId);
      if (!currentJob) {
        return sendJson(res, 404, { error: "Score-study job not found" });
      }

      let clientClosed = false;
      let unsubscribe = () => {};
      let heartbeatId = null;
      const closeStream = () => {
        clientClosed = true;
        if (heartbeatId != null) {
          clearInterval(heartbeatId);
          heartbeatId = null;
        }
        unsubscribe();
      };
      req.on("close", closeStream);
      res.on("close", closeStream);

      startEventStream(res, 200);
      writeEventStreamEvent(res, {
        type: "job",
        job: currentJob,
      });
      if (["completed", "failed", "cancelled"].includes(String(currentJob.status || ""))) {
        res.end();
        return;
      }

      unsubscribe = researchScoreStudies.subscribeJob(jobId, (job) => {
        if (clientClosed) {
          return;
        }
        writeEventStreamEvent(res, {
          type: "job",
          job,
        });
        if (["completed", "failed", "cancelled"].includes(String(job?.status || ""))) {
          closeStream();
          if (!res.writableEnded) {
            res.end();
          }
        }
      });
      heartbeatId = setInterval(() => {
        if (clientClosed) {
          return;
        }
        writeEventStreamEvent(res, {
          type: "heartbeat",
          at: new Date().toISOString(),
        });
      }, 15000);
      return;
    }

    if (method === "GET" && pathname.startsWith("/api/research/score-studies/jobs/")) {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      await researchScoreStudies?.sweepExpiredJobs?.();
      const jobId = decodeURIComponent(pathname.split("/").pop() || "");
      const job = await researchScoreStudies.getJob(jobId);
      if (!job) {
        return sendJson(res, 404, { error: "Score-study job not found" });
      }
      return sendJson(res, 200, {
        ok: true,
        job,
      });
    }

    if (method === "POST" && pathname.match(/^\/api\/research\/score-studies\/jobs\/[^/]+\/cancel$/)) {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      const match = pathname.match(/^\/api\/research\/score-studies\/jobs\/([^/]+)\/cancel$/);
      const jobId = decodeURIComponent(match?.[1] || "");
      const job = await researchScoreStudies.cancelJob(jobId);
      if (!job) {
        return sendJson(res, 404, { error: "Score-study job not found" });
      }
      return sendJson(res, 200, {
        ok: true,
        job,
      });
    }

    if (method === "GET" && pathname === "/api/research/score-studies/artifacts/local") {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      const artifacts = await researchScoreStudies.listLocalArtifacts();
      return sendJson(res, 200, {
        ok: true,
        artifacts,
      });
    }

    if (method === "POST" && pathname === "/api/research/score-studies/import") {
      if (!researchScoreStudies?.isConfigured?.()) {
        return sendJson(res, 503, {
          error: researchScoreStudies?.getRequiredDbError?.()
            || "Score Testing requires Postgres.",
        });
      }
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const run = await researchScoreStudies.importLocalArtifact({
        relativePath: payload?.relativePath || null,
        fileName: payload?.fileName || null,
      });
      return sendJson(res, 200, {
        ok: true,
        run,
      });
    }

    if (method === "GET" && pathname === "/api/research/backtests") {
      await researchBacktestJobs?.sweepExpiredJobs?.();
      return sendJson(res, 200, {
        ok: true,
        jobs: researchBacktestJobs?.listJobs?.() || [],
        results: researchBacktestJobs?.listResults?.({ limit: 18 }) || [],
        activeJob: researchBacktestJobs?.getLatestActiveJob?.("backtest") || null,
        activeJobs: {
          backtest: researchBacktestJobs?.getLatestActiveJob?.("backtest") || null,
          optimizer: researchBacktestJobs?.getLatestActiveJob?.("optimizer") || null,
        },
        latestResult: researchBacktestJobs?.getLatestResult?.() || null,
      });
    }

    if (method === "POST" && pathname === "/api/research/backtests/jobs") {
      if (!researchBacktestJobs) {
        return sendJson(res, 503, { error: "Background backtest jobs unavailable" });
      }
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      if (!hasCredentialValue(apiKey)) {
        return sendJson(res, 400, {
          error: "Massive API key is required (x-massive-api-key header or MASSIVE_API_KEY env)",
        });
      }
      const job = await researchBacktestJobs.createJob({
        jobType: payload?.jobType || "backtest",
        payload: payload?.payload || null,
        draftSignature: payload?.draftSignature || null,
        setupSnapshot: payload?.setupSnapshot || null,
        resultMeta: payload?.resultMeta || {},
        apiKey,
      });
      return sendJson(res, 200, { ok: true, job });
    }

    if (method === "GET" && pathname.match(/^\/api\/research\/backtests\/jobs\/[^/]+\/stream$/)) {
      if (!researchBacktestJobs) {
        return sendJson(res, 503, { error: "Background backtest jobs unavailable" });
      }
      await researchBacktestJobs?.sweepExpiredJobs?.();
      const match = pathname.match(/^\/api\/research\/backtests\/jobs\/([^/]+)\/stream$/);
      const jobId = decodeURIComponent(match?.[1] || "");
      const currentJob = researchBacktestJobs.getJob(jobId);
      if (!currentJob) {
        return sendJson(res, 404, { error: "Backtest job not found" });
      }

      let clientClosed = false;
      let unsubscribe = () => {};
      let heartbeatId = null;
      const closeStream = () => {
        clientClosed = true;
        if (heartbeatId != null) {
          clearInterval(heartbeatId);
          heartbeatId = null;
        }
        unsubscribe();
      };
      req.on("close", closeStream);
      res.on("close", closeStream);

      startNdjsonStream(res, 200);
      writeNdjsonEvent(res, {
        type: "job",
        job: currentJob,
      });
      if (["completed", "failed", "cancelled"].includes(String(currentJob.status || ""))) {
        res.end();
        return;
      }

      unsubscribe = researchBacktestJobs.subscribeJob(jobId, (job) => {
        if (clientClosed) {
          return;
        }
        writeNdjsonEvent(res, {
          type: "job",
          job,
        });
        if (["completed", "failed", "cancelled"].includes(String(job?.status || ""))) {
          closeStream();
          if (!res.writableEnded) {
            res.end();
          }
        }
      });
      heartbeatId = setInterval(() => {
        if (clientClosed) {
          return;
        }
        writeNdjsonEvent(res, {
          type: "heartbeat",
          at: new Date().toISOString(),
        });
      }, 15000);
      return;
    }

    if (method === "GET" && pathname.match(/^\/api\/research\/backtests\/jobs\/[^/]+\/events$/)) {
      if (!researchBacktestJobs) {
        return sendJson(res, 503, { error: "Background backtest jobs unavailable" });
      }
      await researchBacktestJobs?.sweepExpiredJobs?.();
      const match = pathname.match(/^\/api\/research\/backtests\/jobs\/([^/]+)\/events$/);
      const jobId = decodeURIComponent(match?.[1] || "");
      const currentJob = researchBacktestJobs.getJob(jobId);
      if (!currentJob) {
        return sendJson(res, 404, { error: "Backtest job not found" });
      }

      let clientClosed = false;
      let unsubscribe = () => {};
      let heartbeatId = null;
      const closeStream = () => {
        clientClosed = true;
        if (heartbeatId != null) {
          clearInterval(heartbeatId);
          heartbeatId = null;
        }
        unsubscribe();
      };
      req.on("close", closeStream);
      res.on("close", closeStream);

      startEventStream(res, 200);
      writeEventStreamEvent(res, {
        type: "job",
        job: currentJob,
      });
      if (["completed", "failed", "cancelled"].includes(String(currentJob.status || ""))) {
        res.end();
        return;
      }

      unsubscribe = researchBacktestJobs.subscribeJob(jobId, (job) => {
        if (clientClosed) {
          return;
        }
        writeEventStreamEvent(res, {
          type: "job",
          job,
        });
        if (["completed", "failed", "cancelled"].includes(String(job?.status || ""))) {
          closeStream();
          if (!res.writableEnded) {
            res.end();
          }
        }
      });
      heartbeatId = setInterval(() => {
        if (clientClosed) {
          return;
        }
        writeEventStreamEvent(res, {
          type: "heartbeat",
          at: new Date().toISOString(),
        });
      }, 15000);
      return;
    }

    if (method === "GET" && pathname.startsWith("/api/research/backtests/jobs/")) {
      await researchBacktestJobs?.sweepExpiredJobs?.();
      const jobId = decodeURIComponent(pathname.split("/").pop() || "");
      const job = researchBacktestJobs?.getJob?.(jobId) || null;
      if (!job) {
        return sendJson(res, 404, { error: "Backtest job not found" });
      }
      return sendJson(res, 200, { ok: true, job });
    }

    if (method === "POST" && pathname.match(/^\/api\/research\/backtests\/jobs\/[^/]+\/cancel$/)) {
      if (!researchBacktestJobs) {
        return sendJson(res, 503, { error: "Background backtest jobs unavailable" });
      }
      const match = pathname.match(/^\/api\/research\/backtests\/jobs\/([^/]+)\/cancel$/);
      const jobId = decodeURIComponent(match?.[1] || "");
      const job = await researchBacktestJobs.cancelJob(jobId);
      if (!job) {
        return sendJson(res, 404, { error: "Backtest job not found" });
      }
      return sendJson(res, 200, { ok: true, job });
    }

    if (method === "GET" && pathname.startsWith("/api/research/backtests/results/")) {
      const resultId = decodeURIComponent(pathname.split("/").pop() || "");
      const result = researchBacktestJobs?.getResult?.(resultId) || null;
      if (!result) {
        return sendJson(res, 404, { error: "Backtest result not found" });
      }
      return sendJson(res, 200, { ok: true, result });
    }

    if (method === "POST" && pathname === "/api/research/backtests/results") {
      if (!researchBacktestJobs) {
        return sendJson(res, 503, { error: "Backtest result persistence unavailable" });
      }
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const result = await researchBacktestJobs.persistInteractiveResult({
        result: payload?.result || {},
        draftSignature: payload?.draftSignature || null,
        setupSnapshot: payload?.setupSnapshot || null,
        resultMeta: payload?.resultMeta || {},
      });
      return sendJson(res, 200, { ok: true, result });
    }

    if (method === "POST" && pathname.endsWith("/bookmark")) {
      if (!researchBacktestJobs) {
        return sendJson(res, 503, { error: "Backtest result persistence unavailable" });
      }
      const match = pathname.match(/^\/api\/research\/backtests\/results\/([^/]+)\/bookmark$/);
      if (match) {
        const resultId = decodeURIComponent(match[1] || "");
        const result = await researchBacktestJobs.bookmarkResult(resultId);
        if (!result) {
          return sendJson(res, 404, { error: "Backtest result not found" });
        }
        return sendJson(res, 200, { ok: true, result });
      }
    }

    if (method === "GET" && pathname === "/api/brokers/capabilities") {
      const brokerIds = [
        ...new Set([
          ...Object.keys(adapters || {}),
          ...store.listAccounts().map((account) => String(account?.broker || "").toLowerCase()).filter(Boolean),
        ]),
      ].sort();
      const brokers = brokerIds.map((brokerId) => {
        const adapter = adapters?.[brokerId];
        return {
          broker: brokerId,
          capabilities: adapter?.getCapabilities?.() || null,
          adapterAvailable: Boolean(adapter),
        };
      });
      const accounts = store.listAccounts().map((account) => {
        const adapter = adapters?.[account.broker];
        return {
          accountId: account.accountId,
          broker: account.broker,
          capabilities: adapter?.getCapabilities?.(account) || null,
        };
      });
      return sendJson(res, 200, {
        brokers,
        accounts,
      });
    }

    if (method === "GET" && pathname === "/api/ai/context") {
      const context = store.getAiFusionContext();
      const expiresMs = Date.parse(context?.expiresAt || "");
      const stale = !context || !Number.isFinite(expiresMs) || expiresMs <= Date.now();
      return sendJson(res, 200, {
        context,
        stale,
        runtime: store.getAiFusionRuntime(),
      });
    }

    if (method === "GET" && pathname === "/api/ai/fusion/status") {
      if (aiFusion?.getStatus) {
        return sendJson(res, 200, aiFusion.getStatus());
      }
      const context = store.getAiFusionContext();
      const expiresMs = Date.parse(context?.expiresAt || "");
      const stale = !context || !Number.isFinite(expiresMs) || expiresMs <= Date.now();
      return sendJson(res, 200, {
        running: false,
        nextRunAt: null,
        config: store.getAiFusionConfig(),
        runtime: store.getAiFusionRuntime(),
        context,
        contextStale: stale,
      });
    }

    if (method === "GET" && pathname === "/api/ai/fusion/history") {
      const history = store.listAiFusionHistory({
        limit: requestUrl.searchParams.get("limit"),
      });
      return sendJson(res, 200, {
        history,
        count: history.length,
      });
    }

    if (method === "PATCH" && pathname === "/api/ai/fusion/config") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const patch = normalizeAiFusionConfigPatch(payload);
      const config = await store.upsertAiFusionConfig(patch);
      if (aiFusion?.refreshSchedule) {
        aiFusion.refreshSchedule();
      }
      return sendJson(res, 200, { config });
    }

    if (method === "POST" && pathname === "/api/ai/fusion/run") {
      if (!aiFusion?.triggerNow) {
        return sendJson(res, 503, {
          error: "AI fusion worker is not available",
        });
      }
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const result = await aiFusion.triggerNow({
        reason: firstNonEmptyValue(payload.reason, "manual-api"),
        force: parseBoolean(payload.force),
      });
      return sendJson(res, 200, result);
    }

    if (method === "GET" && pathname === "/api/tradingview/alerts") {
      const alerts = store.listTradingViewAlerts({
        limit: requestUrl.searchParams.get("limit"),
        since: requestUrl.searchParams.get("since"),
      });
      return sendJson(res, 200, {
        alerts,
        count: alerts.length,
      });
    }

    if (method === "POST" && pathname === "/api/tradingview/alerts") {
      const parsedBody = await parseFlexibleRequestBody(req, res);
      if (parsedBody == null) {
        return;
      }

      const normalized = normalizeTradingViewAlertPayload(
        parsedBody.payload,
        parsedBody.raw,
      );
      const requiredSecret = readTradingViewWebhookSecret();
      if (requiredSecret) {
        const providedSecret = firstNonEmptyValue(
          requestUrl.searchParams.get("secret"),
          req.headers["x-tv-secret"],
          req.headers["x-webhook-secret"],
          normalized.secret,
        );
        if (!providedSecret || String(providedSecret) !== requiredSecret) {
          return sendJson(res, 401, { error: "Invalid webhook secret" });
        }
      }

      const alert = await store.appendTradingViewAlert(normalized);
      const maybePineSignal = buildRayAlgoSignalFromWebhookAlert(normalized, {
        timeframeFallback: requestUrl.searchParams.get("timeframe") || "5",
      });
      if (maybePineSignal && shouldIngestWebhookAsPineSignal(normalized)) {
        await store.appendRayAlgoSignal(maybePineSignal);
      }

      return sendJson(res, 200, {
        ok: true,
        alertId: alert.alertId,
        receivedAt: alert.receivedAt,
      });
    }

    if (method === "GET" && pathname === "/api/rayalgo/policy") {
      return sendJson(res, 200, {
        policy: store.getRayAlgoExecutionPolicy(),
      });
    }

    if (method === "PATCH" && pathname === "/api/rayalgo/policy") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const nextPolicy = await store.upsertRayAlgoExecutionPolicy(
        normalizeRayAlgoPolicyPatch(payload),
      );
      return sendJson(res, 200, {
        policy: nextPolicy,
      });
    }

    if (method === "GET" && pathname === "/api/rayalgo/signals") {
      const signals = store.listRayAlgoSignals({
        source: requestUrl.searchParams.get("source") || "all",
        symbol: requestUrl.searchParams.get("symbol"),
        timeframe: requestUrl.searchParams.get("timeframe"),
        from: requestUrl.searchParams.get("from"),
        to: requestUrl.searchParams.get("to"),
        limit: requestUrl.searchParams.get("limit"),
      });
      return sendJson(res, 200, {
        signals,
        count: signals.length,
      });
    }

    if (method === "POST" && pathname === "/api/rayalgo/signals") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const rows = Array.isArray(payload?.signals)
        ? payload.signals
        : Array.isArray(payload)
          ? payload
          : [payload];

      const inserted = [];
      const execution = [];
      for (const row of rows) {
        const normalizedSignal = normalizeRayAlgoSignalPayload(row, {
          source: "local",
        });
        if (!normalizedSignal) {
          continue;
        }
        const write = await store.appendRayAlgoSignal(normalizedSignal);
        if (!write.inserted) {
          continue;
        }
        inserted.push(write.signal);
        if (write.signal.source === "local") {
          const outcome = await handleRayAlgoSignalExecution({
            signal: write.signal,
            store,
            adapters,
          });
          execution.push({
            signalId: write.signal.signalId,
            ...outcome,
          });
        }
      }

      return sendJson(res, 200, {
        inserted,
        execution,
        count: inserted.length,
      });
    }

    if (method === "POST" && pathname === "/api/rayalgo/local/generate") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const account = resolveMarketAccount(store, payload.accountId || requestUrl.searchParams.get("accountId"));
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for local signal generation" });
      }
      const adapter = adapters[account.broker];
      if (!adapter?.getBars) {
        return sendJson(res, 400, { error: "Adapter does not support market bars" });
      }

      const symbol = payload.symbol || requestUrl.searchParams.get("symbol") || "SPY";
      const resolution = payload.resolution || requestUrl.searchParams.get("resolution") || "5";
      const countBack = payload.countBack || requestUrl.searchParams.get("countBack") || 260;
      const barsResponse = await adapter.getBars(account, {
        symbol,
        resolution,
        countBack,
      });
      const localSignals = generateRayAlgoSignals({
        bars: barsResponse?.bars || [],
        symbol: normalizeRayAlgoSymbol(symbol),
        timeframe: resolution,
        source: "local",
        minConviction: payload.minConviction,
        cooldownBars: payload.cooldownBars,
      });

      const inserted = [];
      const execution = [];
      for (const signal of localSignals) {
        const write = await store.appendRayAlgoSignal(signal);
        if (!write.inserted) {
          continue;
        }
        inserted.push(write.signal);
        const outcome = await handleRayAlgoSignalExecution({
          signal: write.signal,
          store,
          adapters,
        });
        execution.push({
          signalId: write.signal.signalId,
          ...outcome,
        });
      }

      return sendJson(res, 200, {
        generated: localSignals.length,
        inserted: inserted.length,
        signals: inserted,
        execution,
      });
    }

    if (method === "GET" && pathname === "/api/rayalgo/parity") {
      const symbol = normalizeRayAlgoSymbol(
        requestUrl.searchParams.get("symbol") || "SPY",
      );
      const timeframe = requestUrl.searchParams.get("timeframe") || "5";
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const limit = requestUrl.searchParams.get("limit") || 2000;
      const windowSec = requestUrl.searchParams.get("windowSec");

      const pineSignals = store.listRayAlgoSignals({
        source: "pine",
        symbol,
        timeframe,
        from,
        to,
        limit,
      });
      const localSignals = store.listRayAlgoSignals({
        source: "local",
        symbol,
        timeframe,
        from,
        to,
        limit,
      });

      const report = computeRayAlgoParityReport({
        symbol,
        timeframe,
        pineSignals,
        localSignals,
        windowSeconds: windowSec,
      });
      return sendJson(res, 200, report);
    }

    if (method === "GET" && pathname === "/api/rayalgo/approvals") {
      const approvals = store.listRayAlgoManualApprovals({
        status: requestUrl.searchParams.get("status") || "all",
        limit: requestUrl.searchParams.get("limit"),
      });
      return sendJson(res, 200, {
        approvals,
        count: approvals.length,
      });
    }

    const approvalExecuteMatch = pathname.match(/^\/api\/rayalgo\/approvals\/([^/]+)\/execute$/);
    if (method === "POST" && approvalExecuteMatch) {
      const approvalId = decodeURIComponent(approvalExecuteMatch[1]);
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const approval = store.getRayAlgoManualApproval(approvalId);
      if (!approval) {
        return sendJson(res, 404, { error: "Approval not found" });
      }
      if (approval.status !== "pending") {
        return sendJson(res, 409, { error: "Approval is no longer pending" });
      }

      const account = resolveRayAlgoExecutionAccount({
        store,
        preferredAccountId: payload.accountId || approval.orderDraft?.accountId,
        requireLive: true,
      });
      if (!account) {
        return sendJson(res, 404, { error: "Live account not found for execution" });
      }
      if (account.mode !== "live") {
        return sendJson(res, 409, { error: "Selected account is not in live mode" });
      }

      const adapter = adapters[account.broker];
      if (!adapter) {
        return sendJson(res, 400, { error: "Adapter not available for selected account" });
      }

      const order = normalizeOrderPayload({
        ...(approval.orderDraft || {}),
        accountId: account.accountId,
        executionMode: "live",
      });
      const liveExecutionGuard = getLiveExecutionGuardResponse({
        account,
        adapter,
        orderLike: order,
      });
      if (liveExecutionGuard) {
        return sendJson(res, liveExecutionGuard.status, liveExecutionGuard.body);
      }
      const execution = await adapter.placeOrder(account, order);
      await store.upsertAccount({
        accountId: account.accountId,
        broker: account.broker,
        lastSync: new Date().toISOString(),
        status: "connected",
      });

      const updated = await store.updateRayAlgoManualApproval(approvalId, {
        status: "approved",
        executionResult: execution,
      });

      return sendJson(res, 200, {
        approval: updated,
        order: execution,
      });
    }

    const approvalRejectMatch = pathname.match(/^\/api\/rayalgo\/approvals\/([^/]+)\/reject$/);
    if (method === "POST" && approvalRejectMatch) {
      const approvalId = decodeURIComponent(approvalRejectMatch[1]);
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const approval = store.getRayAlgoManualApproval(approvalId);
      if (!approval) {
        return sendJson(res, 404, { error: "Approval not found" });
      }
      if (approval.status !== "pending") {
        return sendJson(res, 409, { error: "Approval is no longer pending" });
      }
      const updated = await store.updateRayAlgoManualApproval(approvalId, {
        status: "rejected",
        reason: payload.reason || "Rejected by user",
      });
      return sendJson(res, 200, {
        approval: updated,
      });
    }

    if (method === "GET" && pathname === "/api/accounts") {
      await syncPositionsForRequest(store, adapters, "all");
      const displayAccounts = await hydrateAccountsForDisplay(store, store.listAccounts(), adapters);
      const enrichedAccounts = await enrichAccounts(store, displayAccounts, adapters);
      await Promise.all(
        enrichedAccounts.map(async (account) => {
          const adapter = adapters[account?.broker];
          const snapshot = await captureAccountEquitySnapshot({
            store,
            adapter,
            account,
            summaryHint: account?.summary,
          });
          if (snapshot) {
            await persistAccountEquityHistoryToDb({
              account,
              points: [snapshot],
            });
          }
        }),
      );
      const accounts = sanitizeAccountsForClient(enrichedAccounts);
      return sendJson(res, 200, { accounts });
    }

    if (method === "GET" && pathname === "/api/accounts/default-credentials") {
      return sendJson(res, 200, {
        credentialsByBroker: redactCredentialsByBroker(getEnvCredentialDefaultsByBroker()),
      });
    }

    if (method === "GET" && pathname === "/api/accounts/default-credentials/status") {
      return sendJson(res, 200, {
        statusByBroker: getEnvCredentialStatusByBroker(),
      });
    }

    if (method === "GET" && pathname === "/api/accounts/default-credentials/runtime") {
      const hydration = hydrateRuntimeEnvFromSnapshot({ force: true });
      return sendJson(res, 200, {
        hydration: {
          hydrated: Boolean(hydration?.hydrated),
          mergedCount: Number(hydration?.mergedCount || 0),
          sourcePath: hydration?.sourcePath || null,
        },
      });
    }

    if (method === "GET" && pathname === "/api/accounts/history/status") {
      const database = await getAccountHistoryDbStats();
      return sendJson(res, 200, {
        database,
      });
    }

    if (method === "POST" && pathname === "/api/accounts/history/normalize-sources") {
      const maintenanceIssue = getAccountHistoryMaintenanceIssue(req);
      if (maintenanceIssue) {
        return sendJson(res, maintenanceIssue.statusCode, {
          error: maintenanceIssue.message,
          code: maintenanceIssue.code,
        });
      }

      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const requestedAccountId = String(payload.accountId || "all");
      const dryRun = payload?.dryRun == null ? true : parseBoolean(payload.dryRun);
      const brokerByAccountId = Object.fromEntries(
        store.listAccounts().map((account) => [account.accountId, String(account?.broker || "").trim().toLowerCase()]),
      );
      const result = await normalizeAccountEquityHistorySources({
        accountIds: requestedAccountId === "all" ? [] : [requestedAccountId],
        brokerByAccountId,
        dryRun,
      });
      if (!result?.configured || !result?.ready) {
        return sendJson(res, 503, {
          accountId: requestedAccountId,
          dryRun,
          ...result,
          asOf: new Date().toISOString(),
        });
      }

      return sendJson(res, result.ok ? 200 : 500, {
        accountId: requestedAccountId,
        dryRun,
        ...result,
        asOf: new Date().toISOString(),
      });
    }

    if (method === "POST" && pathname === "/api/accounts/history/backfill") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const requestedAccountId = String(payload.accountId || "all");
      const from = payload.from ?? null;
      const to = payload.to ?? null;
      const days = payload.days ?? null;
      const limit = payload.limit ?? payload.maxRows ?? 5000;

      const targetAccounts = resolveRequestedAccounts(store, requestedAccountId);
      if (!targetAccounts.length) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      await syncPositionsForRequest(store, adapters, requestedAccountId);
      const pointsByAccount = await refreshEquityHistoryForAccounts({
        store,
        adapters,
        accounts: targetAccounts,
        from,
        to,
        days,
        limit,
        includeBackfill: true,
      });

      const nativeInputs = await collectPerformanceInputs({
        store,
        adapters,
        targetAccounts,
        from,
        to,
        days,
        limit,
        refreshNativeHistory: true,
      });

      const byAccount = Object.fromEntries(
        targetAccounts.map((account) => {
          const accountId = account.accountId;
          return [
            accountId,
            {
              equityPoints: Array.isArray(pointsByAccount?.[accountId])
                ? pointsByAccount[accountId].length
                : 0,
              closedTrades: Array.isArray(nativeInputs?.nativeClosedTradesByAccount?.[accountId])
                ? nativeInputs.nativeClosedTradesByAccount[accountId].length
                : 0,
              cashLedgerRows: Array.isArray(nativeInputs?.nativeCashLedgerByAccount?.[accountId])
                ? nativeInputs.nativeCashLedgerByAccount[accountId].length
                : 0,
            },
          ];
        }),
      );

      const database = await getAccountHistoryDbStats();
      return sendJson(res, 200, {
        accountId: requestedAccountId,
        refreshed: true,
        byAccount,
        database,
        asOf: new Date().toISOString(),
      });
    }

    if (method === "GET" && pathname === "/api/backtest/options/massive/status") {
      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      const ping = parseBoolean(requestUrl.searchParams.get("ping"));
      const includeDb = parseBoolean(requestUrl.searchParams.get("includeDb"));
      const probeTimeoutParam = requestUrl.searchParams.get("probeTimeoutMs");
      const probeTimeoutMs = probeTimeoutParam == null
        ? 5000
        : clampNumber(probeTimeoutParam, 1000, 30000, 5000);
      const cache = await getMassiveCacheStats({ includeDatabase: includeDb });
      const probe = ping ? await probeMassiveApi(apiKey, { timeoutMs: probeTimeoutMs }) : null;
      return sendJson(res, 200, {
        provider: "massive",
        configured: hasCredentialValue(apiKey),
        keySource: hasCredentialValue(headerKey)
          ? "header"
          : hasCredentialValue(apiKey)
            ? "env"
            : null,
        cache,
        probe,
      });
    }

    if (method === "GET" && pathname === "/api/backtest/spot-history") {
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const accountId = requestUrl.searchParams.get("accountId");
      const mode = requestUrl.searchParams.get("mode") || "full";
      const before = requestUrl.searchParams.get("before");
      const initialDays = clampNumber(requestUrl.searchParams.get("initialDays"), 1, 125, null);
      const preferredTf = requestUrl.searchParams.get("preferredTf") || null;
      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      const account = resolveMarketAccount(store, accountId);
      const adapter = account ? adapters[account.broker] : null;

      try {
        const payload = await resolveResearchSpotHistory({
          symbol,
          apiKey,
          account,
          adapter,
          mode,
          before,
          initialDays,
          preferredTf,
        });
        return sendJson(res, 200, payload);
      } catch (error) {
        return sendJson(res, 502, {
          status: "unavailable",
          dataSource: "error",
          intradayBars: [],
          dailyBars: [],
          meta: null,
          error: error?.message || "Failed to load backtest spot history",
          details: error?.payload || null,
        });
      }
    }

    if (method === "GET" && pathname === "/api/backtest/options/massive/contracts") {
      const underlyingTicker = requestUrl.searchParams.get("underlyingTicker");
      const contractType = requestUrl.searchParams.get("contractType");
      const expirationDate = requestUrl.searchParams.get("expirationDate");
      const asOf = requestUrl.searchParams.get("asOf");
      const targetStrike = requestUrl.searchParams.get("targetStrike");
      const limit = clampNumber(requestUrl.searchParams.get("limit"), 1, 1000, 250);
      const expiredParam = requestUrl.searchParams.get("expired");
      const expired = expiredParam == null ? undefined : parseBoolean(expiredParam);
      const sort = optionalString(requestUrl.searchParams.get("sort"), "strike_price");
      const order = optionalString(requestUrl.searchParams.get("order"), "asc").toLowerCase() === "desc"
        ? "desc"
        : "asc";

      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      if (!hasCredentialValue(apiKey)) {
        return sendJson(res, 400, {
          error: "Massive API key is required (x-massive-api-key header or MASSIVE_API_KEY env)",
        });
      }

      try {
        const payload = await searchMassiveOptionContracts(
          {
            underlyingTicker,
            contractType,
            expirationDate,
            asOf,
            targetStrike,
            limit,
            expired,
            sort,
            order,
          },
          {
            apiKey,
          },
        );
        return sendJson(res, 200, payload);
      } catch (error) {
        const status = Number(error?.status);
        const isValidationError = !Number.isFinite(status)
          && /(required|contractType|expirationDate|underlyingTicker)/i.test(String(error?.message || ""));
        return sendJson(
          res,
          isValidationError
            ? 400
            : (Number.isFinite(status) && status >= 400 && status < 600 ? status : 502),
          {
            error: error?.message || "Failed to resolve Massive option contracts",
            details: error?.payload || null,
          },
        );
      }
    }

    if (method === "POST" && pathname === "/api/backtest/options/massive/replay-dataset") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      if (!hasCredentialValue(apiKey)) {
        return sendJson(res, 400, {
          error: "Massive API key is required (x-massive-api-key header or MASSIVE_API_KEY env)",
        });
      }

      try {
        const replayDataset = await resolveMassiveOptionReplayDataset(payload, {
          apiKey,
          timeoutMs: 30000,
        });
        return sendJson(res, 200, replayDataset);
      } catch (error) {
        const status = Number(error?.status);
        const isValidationError = !Number.isFinite(status)
          && /(required|candidates|minDte|maxDte|targetDte|strikeSlot|moneyness|replayEndDate|underlyingTicker)/i.test(String(error?.message || ""));
        return sendJson(
          res,
          isValidationError
            ? 400
            : (Number.isFinite(status) && status >= 400 && status < 600 ? status : 502),
          {
            error: error?.message || "Failed to build Massive replay dataset",
            details: error?.payload || null,
          },
        );
      }
    }

    if (method === "POST" && pathname === "/api/backtest/options/massive/run") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      if (!hasCredentialValue(apiKey)) {
        return sendJson(res, 400, {
          error: "Massive API key is required (x-massive-api-key header or MASSIVE_API_KEY env)",
        });
      }

      try {
        const replayRun = await runMassiveOptionReplayBacktest(payload, {
          apiKey,
          timeoutMs: MASSIVE_BACKTEST_TIMEOUT_MS,
        });
        return sendJson(res, 200, replayRun);
      } catch (error) {
        const status = Number(error?.status);
        const isValidationError = !Number.isFinite(status)
          && /(required|bars|minDte|maxDte|targetDte|strikeSlot|moneyness|marketSymbol)/i.test(String(error?.message || ""));
        return sendJson(
          res,
          isValidationError
            ? 400
            : (Number.isFinite(status) && status >= 400 && status < 600 ? status : 502),
          {
            error: error?.message || "Failed to run Massive replay backtest",
            details: error?.payload || null,
          },
        );
      }
    }

    if (method === "POST" && pathname === "/api/backtest/options/massive/run/stream") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      if (!hasCredentialValue(apiKey)) {
        return sendJson(res, 400, {
          error: "Massive API key is required (x-massive-api-key header or MASSIVE_API_KEY env)",
        });
      }

      let clientClosed = false;
      const markClosed = () => {
        clientClosed = true;
      };
      req.on("close", markClosed);
      res.on("close", markClosed);

      try {
        startNdjsonStream(res, 200);
        await streamMassiveOptionReplayBacktest(payload, {
          apiKey,
          timeoutMs: MASSIVE_BACKTEST_TIMEOUT_MS,
          isCancelled: () => clientClosed,
          onEvent(event) {
            if (!clientClosed) {
              writeNdjsonEvent(res, event);
            }
          },
        });
        if (!clientClosed && !res.writableEnded) {
          res.end();
        }
        return;
      } catch (error) {
        const status = Number(error?.status);
        const isValidationError = !Number.isFinite(status)
          && /(required|bars|minDte|maxDte|targetDte|strikeSlot|moneyness|marketSymbol)/i.test(String(error?.message || ""));
        if (res.headersSent) {
          writeNdjsonEvent(res, {
            type: "error",
            error: error?.message || "Failed to stream Massive replay backtest",
            details: error?.payload || null,
          });
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }
        return sendJson(
          res,
          isValidationError
            ? 400
            : (Number.isFinite(status) && status >= 400 && status < 600 ? status : 502),
          {
            error: error?.message || "Failed to stream Massive replay backtest",
            details: error?.payload || null,
          },
        );
      }
    }

    if (method === "GET" && pathname === "/api/backtest/options/massive/bars") {
      const optionTicker = requestUrl.searchParams.get("optionTicker");
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      if (!optionTicker || !from || !to) {
        return sendJson(res, 400, {
          error: "optionTicker, from, and to are required",
        });
      }

      const multiplier = clampNumber(requestUrl.searchParams.get("multiplier"), 1, 1000, 1);
      const timespan = optionalString(requestUrl.searchParams.get("timespan"), "minute").toLowerCase();
      const adjustedParam = requestUrl.searchParams.get("adjusted");
      const adjusted = adjustedParam == null ? true : parseBoolean(adjustedParam);
      const sort = optionalString(requestUrl.searchParams.get("sort"), "asc").toLowerCase() === "desc"
        ? "desc"
        : "asc";
      const limit = clampNumber(requestUrl.searchParams.get("limit"), 1, 50000, 50000);
      const refresh = parseBoolean(requestUrl.searchParams.get("refresh"));

      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      if (!hasCredentialValue(apiKey)) {
        return sendJson(res, 400, {
          error: "Massive API key is required (x-massive-api-key header or MASSIVE_API_KEY env)",
        });
      }

      try {
        const payload = await getMassiveOptionsBarsWithCache(
          {
            optionTicker,
            multiplier,
            timespan,
            from,
            to,
            adjusted,
            sort,
            limit,
          },
          {
            apiKey,
            refresh,
            timeoutMs: 30000,
          },
        );
        return sendJson(res, 200, payload);
      } catch (error) {
        const status = Number(error?.status);
        const isValidationError = !Number.isFinite(status)
          && /(required|timespan)/i.test(String(error?.message || ""));
        return sendJson(
          res,
          isValidationError
            ? 400
            : (Number.isFinite(status) && status >= 400 && status < 600 ? status : 502),
          {
            error: error?.message || "Failed to load Massive option bars",
            details: error?.payload || null,
          },
        );
      }
    }

    if (method === "GET" && pathname === "/api/backtest/options/massive/tracking") {
      if (!massiveOptionsTracker) {
        return sendJson(res, 503, { error: "Massive options tracker unavailable" });
      }

      const trackingIds = Array.from(new Set(
        requestUrl.searchParams
          .getAll("trackingId")
          .flatMap((value) => String(value || "").split(","))
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ));
      const optionTickers = Array.from(new Set(
        requestUrl.searchParams
          .getAll("optionTicker")
          .flatMap((value) => String(value || "").split(","))
          .map((value) => String(value || "").trim().toUpperCase())
          .filter(Boolean),
      ));

      return sendJson(res, 200, {
        snapshots: massiveOptionsTracker.getTrackingSnapshots({
          trackingIds,
          optionTickers,
        }),
        service: massiveOptionsTracker.getServiceStatus(),
      });
    }

    if (method === "POST" && pathname === "/api/backtest/options/massive/tracking/track") {
      if (!massiveOptionsTracker) {
        return sendJson(res, 503, { error: "Massive options tracker unavailable" });
      }

      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const headerKey = req.headers["x-massive-api-key"] || req.headers["x-polygon-api-key"];
      const apiKey = resolveMassiveApiKey({ headerValue: headerKey });
      try {
        const snapshot = await massiveOptionsTracker.trackContract(payload, { apiKey });
        return sendJson(res, 200, {
          snapshot,
          service: massiveOptionsTracker.getServiceStatus(),
        });
      } catch (error) {
        const status = Number(error?.status);
        const isValidationError = !Number.isFinite(status)
          && /(required|trackingId|optionTicker)/i.test(String(error?.message || ""));
        return sendJson(
          res,
          isValidationError
            ? 400
            : (Number.isFinite(status) && status >= 400 && status < 600 ? status : 502),
          {
            error: error?.message || "Failed to start Massive option tracking",
            details: error?.payload || null,
          },
        );
      }
    }

    if (method === "POST" && pathname === "/api/backtest/options/massive/tracking/untrack") {
      if (!massiveOptionsTracker) {
        return sendJson(res, 503, { error: "Massive options tracker unavailable" });
      }

      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      try {
        const result = await massiveOptionsTracker.untrackContract(payload);
        return sendJson(res, 200, {
          result,
          service: massiveOptionsTracker.getServiceStatus(),
        });
      } catch (error) {
        const status = Number(error?.status);
        const isValidationError = !Number.isFinite(status)
          && /(required|trackingId)/i.test(String(error?.message || ""));
        return sendJson(
          res,
          isValidationError
            ? 400
            : (Number.isFinite(status) && status >= 400 && status < 600 ? status : 502),
          {
            error: error?.message || "Failed to stop Massive option tracking",
            details: error?.payload || null,
          },
        );
      }
    }

    const connectMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/connect$/);
    if (method === "POST" && connectMatch) {
      const accountId = decodeURIComponent(connectMatch[1]);
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const broker = String(payload.broker || "").trim().toLowerCase();

      if (!adapters[broker]) {
        return sendJson(res, 400, { error: `Unsupported broker: ${broker}` });
      }

      const existingAccount = store.getAccount(accountId);
      const resolvedCredentials = mergeCredentialsWithEnvDefaults(
        broker,
        payload.credentials,
      );
      const connectCredentials = normalizeConnectCredentialsForBroker({
        broker,
        currentCredentials: existingAccount?.credentials || {},
        incomingCredentials: resolvedCredentials,
        payloadCredentials: payload.credentials,
      });

      const upserted = await store.upsertAccount({
        accountId,
        broker,
        label: payload.label || accountId,
        mode: "live",
        status: "connecting",
        credentials: connectCredentials,
      });

      const adapter = adapters[broker];
      try {
        const connectResult = await adapter.connect(upserted, upserted.credentials);
        const connected = await store.upsertAccount({
          accountId,
          broker,
          label: payload.label || upserted.label,
          mode: upserted.mode,
          status: connectResult.status || "connected",
          connectionMessage: connectResult.message || null,
          credentials: {
            ...(upserted.credentials || {}),
            ...(connectResult.credentials || {}),
          },
          lastSync: new Date().toISOString(),
        });
        const shouldRefreshAuth = broker !== "webull";
        const authResult = await resolveAccountAuthStatus(store, adapter, connected, {
          refresh: shouldRefreshAuth,
        });
        const resolvedAccount = withMergedEnvCredentials(authResult.account);
        const summary = await resolveDisplaySummary(store, resolvedAccount, adapter);

        return sendJson(res, 200, {
          account: sanitizeAccountForClient({
            ...resolvedAccount,
            summary,
            auth: authResult.auth,
          }),
        });
      } catch (error) {
        const failed = await store.upsertAccount({
          accountId,
          broker,
          label: upserted.label,
          mode: upserted.mode,
          status: "error",
          connectionMessage: error.message,
          authState: "error",
          authMessage: error.message,
          authCheckedAt: new Date().toISOString(),
        });

        return sendJson(res, 400, {
          error: error.message,
          account: sanitizeAccountForClient(failed),
        });
      }
    }

    const modeMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/mode$/);
    if (method === "PATCH" && modeMatch) {
      const accountId = decodeURIComponent(modeMatch[1]);
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const requestedMode = String(payload.mode || "live").trim().toLowerCase();
      if (requestedMode !== "live") {
        return sendJson(res, 400, {
          error: "Paper mode is disabled. Account mode must be live.",
          code: "LIVE_MODE_ONLY",
        });
      }
      const account = await store.setAccountMode(accountId, "live");
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      return sendJson(res, 200, { account: sanitizeAccountForClient(account) });
    }

    const summaryMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/summary$/);
    if (method === "GET" && summaryMatch) {
      const accountId = decodeURIComponent(summaryMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      const resolvedAccount = withMergedEnvCredentials(account);
      const adapter = adapters[resolvedAccount.broker];
      if (!adapter) {
        return sendJson(res, 400, { error: "Adapter not available for account" });
      }

      const summary = await resolveDisplaySummary(store, resolvedAccount, adapter);
      const liveIssue = getStrictLiveSummaryIssue(resolvedAccount, summary);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live account summary unavailable without verified broker data",
          code: "LIVE_SUMMARY_UNAVAILABLE",
          issue: liveIssue,
          summary,
        });
      }
      return sendJson(res, 200, { summary });
    }

    if (method === "GET" && pathname === "/api/accounts/equity-history") {
      const requestedAccountId = requestUrl.searchParams.get("accountId") || "all";
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const days = requestUrl.searchParams.get("days");
      const limit = requestUrl.searchParams.get("limit");
      const refresh = parseBoolean(
        requestUrl.searchParams.get("refresh")
        ?? requestUrl.searchParams.get("backfill")
        ?? false,
      );

      const targetAccounts = resolveRequestedAccounts(store, requestedAccountId);
      if (!targetAccounts.length) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      if (refresh) {
        await syncPositionsForRequest(store, adapters, requestedAccountId);
      }
      await refreshEquityHistoryForAccounts({
        store,
        adapters,
        accounts: targetAccounts,
        from,
        to,
        days,
        limit,
        includeBackfill: refresh,
      });

      const pointsByAccount = {};
      for (const account of targetAccounts) {
        pointsByAccount[account.accountId] = sanitizeEquityRowsForAccount(
          account,
          store.listAccountEquityHistory(account.accountId, {
            from,
            to,
            limit,
          }),
        );
      }
      const points = requestedAccountId === "all"
        ? aggregateEquityHistorySeries(pointsByAccount, { limit })
        : (pointsByAccount[targetAccounts[0]?.accountId] || []);

      return sendJson(res, 200, {
        accountId: requestedAccountId,
        points,
        pointsByAccount,
        refreshed: refresh,
        asOf: new Date().toISOString(),
      });
    }

    if (method === "POST" && pathname === "/api/accounts/equity-history/refresh") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const requestedAccountId = String(payload.accountId || "all");
      const from = payload.from ?? null;
      const to = payload.to ?? null;
      const days = payload.days ?? null;
      const limit = payload.limit ?? null;

      const targetAccounts = resolveRequestedAccounts(store, requestedAccountId);
      if (!targetAccounts.length) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      await syncPositionsForRequest(store, adapters, requestedAccountId);
      const refreshedByAccount = await refreshEquityHistoryForAccounts({
        store,
        adapters,
        accounts: targetAccounts,
        from,
        to,
        days,
        limit,
        includeBackfill: true,
      });

      const points = requestedAccountId === "all"
        ? aggregateEquityHistorySeries(refreshedByAccount, { limit })
        : (refreshedByAccount[targetAccounts[0]?.accountId] || []);

      return sendJson(res, 200, {
        accountId: requestedAccountId,
        points,
        pointsByAccount: refreshedByAccount,
        refreshed: true,
        asOf: new Date().toISOString(),
      });
    }

    if (method === "GET" && pathname === "/api/accounts/performance") {
      const requestedAccountId = requestUrl.searchParams.get("accountId") || "all";
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const days = requestUrl.searchParams.get("days");
      const limit = requestUrl.searchParams.get("limit");
      const refresh = parseBoolean(
        requestUrl.searchParams.get("refresh")
        ?? requestUrl.searchParams.get("backfill")
        ?? false,
      );
      const includeBenchmark = parseBoolean(
        requestUrl.searchParams.get("benchmark")
        ?? requestUrl.searchParams.get("includeBenchmark")
        ?? false,
      );
      const benchmarkSymbol = String(
        requestUrl.searchParams.get("benchmarkSymbol")
        || requestUrl.searchParams.get("benchmarkTicker")
        || "SPY",
      ).trim().toUpperCase();

      const targetAccounts = resolveRequestedAccounts(store, requestedAccountId);
      if (!targetAccounts.length) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      if (refresh) {
        await syncPositionsForRequest(store, adapters, requestedAccountId);
      }
      await refreshEquityHistoryForAccounts({
        store,
        adapters,
        accounts: targetAccounts,
        from,
        to,
        days,
        limit,
        includeBackfill: refresh,
      });

      const {
        pointsByAccount,
        summariesByAccount,
        nativeClosedTradesByAccount,
        nativeCashLedgerByAccount,
      } = await collectPerformanceInputs({
        store,
        adapters,
        targetAccounts,
        from,
        to,
        days,
        limit,
        refreshNativeHistory: refresh,
      });

      const requestedSeries = requestedAccountId === "all"
        ? aggregateEquityHistorySeries(pointsByAccount, { limit })
        : (pointsByAccount[targetAccounts[0]?.accountId] || []);

      const benchmark = includeBenchmark
        ? await buildBenchmarkForPerformance({
          adapters,
          accounts: targetAccounts,
          symbol: benchmarkSymbol,
          from: requestedSeries[0]?.epochMs,
          to: requestedSeries[requestedSeries.length - 1]?.epochMs,
          baseEquity: requestedSeries[0]?.equity,
          limit,
        })
        : null;

      const payload = buildAccountPerformancePayload({
        requestedAccountId,
        accounts: targetAccounts,
        summariesByAccount,
        pointsByAccount,
        nativeClosedTradesByAccount,
        nativeCashLedgerByAccount,
        benchmark,
        maxRows: clampNumber(limit, 20, 50000, 5000),
      });

      const strictLiveIssues = getStrictLivePerformanceIssues({
        accounts: targetAccounts,
        summariesByAccount,
        pointsByAccount,
        nativeClosedTradesByAccount,
        nativeCashLedgerByAccount,
        benchmark,
        performance: payload,
      });
      const availability = buildPerformanceAvailability({
        issues: strictLiveIssues,
        performance: payload,
      });
      if (strictLiveIssues.length && availability.state === "unavailable") {
        return sendJson(res, 409, {
          error: "Live account performance unavailable without verified broker data",
          code: "LIVE_PERFORMANCE_UNAVAILABLE",
          issues: strictLiveIssues,
          availability,
          refreshed: refresh,
        });
      }

      return sendJson(res, 200, {
        ...payload,
        issues: strictLiveIssues,
        availability,
        refreshed: refresh,
      });
    }

    if (method === "POST" && pathname === "/api/accounts/performance/refresh") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const requestedAccountId = String(payload.accountId || "all");
      const from = payload.from ?? null;
      const to = payload.to ?? null;
      const days = payload.days ?? null;
      const limit = payload.limit ?? null;
      const includeBenchmark = payload.includeBenchmark !== false;
      const benchmarkSymbol = String(payload.benchmarkSymbol || "SPY").trim().toUpperCase();

      const targetAccounts = resolveRequestedAccounts(store, requestedAccountId);
      if (!targetAccounts.length) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      await syncPositionsForRequest(store, adapters, requestedAccountId);
      await refreshEquityHistoryForAccounts({
        store,
        adapters,
        accounts: targetAccounts,
        from,
        to,
        days,
        limit,
        includeBackfill: true,
      });

      const {
        pointsByAccount,
        summariesByAccount,
        nativeClosedTradesByAccount,
        nativeCashLedgerByAccount,
      } = await collectPerformanceInputs({
        store,
        adapters,
        targetAccounts,
        from,
        to,
        days,
        limit,
        refreshNativeHistory: true,
      });

      const requestedSeries = requestedAccountId === "all"
        ? aggregateEquityHistorySeries(pointsByAccount, { limit })
        : (pointsByAccount[targetAccounts[0]?.accountId] || []);

      const benchmark = includeBenchmark
        ? await buildBenchmarkForPerformance({
          adapters,
          accounts: targetAccounts,
          symbol: benchmarkSymbol,
          from: requestedSeries[0]?.epochMs,
          to: requestedSeries[requestedSeries.length - 1]?.epochMs,
          baseEquity: requestedSeries[0]?.equity,
          limit,
        })
        : null;

      const performance = buildAccountPerformancePayload({
        requestedAccountId,
        accounts: targetAccounts,
        summariesByAccount,
        pointsByAccount,
        nativeClosedTradesByAccount,
        nativeCashLedgerByAccount,
        benchmark,
        maxRows: clampNumber(limit, 20, 50000, 5000),
      });

      const strictLiveIssues = getStrictLivePerformanceIssues({
        accounts: targetAccounts,
        summariesByAccount,
        pointsByAccount,
        nativeClosedTradesByAccount,
        nativeCashLedgerByAccount,
        benchmark,
        performance,
      });
      const availability = buildPerformanceAvailability({
        issues: strictLiveIssues,
        performance,
      });
      if (strictLiveIssues.length && availability.state === "unavailable") {
        return sendJson(res, 409, {
          error: "Live account performance unavailable without verified broker data",
          code: "LIVE_PERFORMANCE_UNAVAILABLE",
          issues: strictLiveIssues,
          availability,
          refreshed: true,
        });
      }

      return sendJson(res, 200, {
        ...performance,
        issues: strictLiveIssues,
        availability,
        refreshed: true,
      });
    }

    const authMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/auth$/);
    if (method === "GET" && authMatch) {
      const accountId = decodeURIComponent(authMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      const adapter = adapters[account.broker];
      if (!adapter?.getAuthStatus) {
        return sendJson(res, 400, { error: "Adapter does not support auth status checks" });
      }

      const authResult = await resolveAccountAuthStatus(store, adapter, account, {
        refresh: false,
      });
      return sendJson(res, 200, {
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
      });
    }

    const authRefreshMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/auth\/refresh$/);
    if (method === "POST" && authRefreshMatch) {
      const accountId = decodeURIComponent(authRefreshMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      const adapter = adapters[account.broker];
      if (!adapter?.refreshAuthSession) {
        return sendJson(res, 400, { error: "Adapter does not support auth refresh" });
      }

      const authResult = await resolveAccountAuthStatus(store, adapter, account, {
        refresh: true,
      });
      return sendJson(res, 200, {
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
      });
    }

    const webullOAuthStatusMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/webull\/oauth\/status$/);
    if (method === "GET" && webullOAuthStatusMatch) {
      const accountId = decodeURIComponent(webullOAuthStatusMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "webull") {
        return sendJson(res, 400, { error: "OAuth status endpoint is only available for Webull accounts" });
      }

      const credentials = mergeCredentialsWithEnvDefaults("webull", account.credentials || {});
      const redirectUri = resolveWebullOAuthRedirectUri({
        req,
        accountId,
        credentials,
      });
      const authResult = await resolveAccountAuthStatus(store, adapters.webull, account, {
        refresh: false,
      });
      const connectStatus = describeWebullConnectOAuthStatus({
        account: authResult.account,
        auth: authResult.auth,
      });

      let clientConfigured = false;
      let apiBaseUrl = null;
      let authorizeUrl = null;
      let scope = null;
      try {
        const oauth = resolveWebullConnectCredentials(credentials);
        clientConfigured = true;
        apiBaseUrl = oauth.apiBaseUrl;
        authorizeUrl = oauth.authorizeUrl;
        scope = oauth.scope;
      } catch {
        // Leave unconfigured state in payload.
      }

      return sendJson(res, 200, {
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
        oauth: {
          clientConfigured,
          hasClientId: hasCredentialValue(credentials.WEBULL_CLIENT_ID),
          hasClientSecret: hasCredentialValue(credentials.WEBULL_CLIENT_SECRET),
          hasAccessToken: hasCredentialValue(credentials.WEBULL_OAUTH_ACCESS_TOKEN),
          hasRefreshToken: hasCredentialValue(credentials.WEBULL_OAUTH_REFRESH_TOKEN),
          accessTokenExpiresAt: credentials.WEBULL_OAUTH_ACCESS_EXPIRES_AT || null,
          refreshTokenExpiresAt: credentials.WEBULL_OAUTH_REFRESH_EXPIRES_AT || null,
          scope: scope || credentials.WEBULL_OAUTH_SCOPE || null,
          redirectUri,
          authorizeUrl,
          apiBaseUrl,
          statePending: hasCredentialValue(credentials.WEBULL_OAUTH_STATE),
          tradingState: connectStatus.tradingState,
          tradingLabel: connectStatus.tradingLabel,
          statusMessage: connectStatus.statusMessage,
        },
      });
    }

    const webullOAuthStartMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/webull\/oauth\/start$/);
    if (method === "POST" && webullOAuthStartMatch) {
      const accountId = decodeURIComponent(webullOAuthStartMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "webull") {
        return sendJson(res, 400, { error: "OAuth start endpoint is only available for Webull accounts" });
      }

      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const credentials = mergeCredentialsWithEnvDefaults("webull", account.credentials || {});
      let oauth;
      try {
        oauth = resolveWebullConnectCredentials(credentials);
      } catch (error) {
        return sendJson(res, 400, { error: error.message || "Webull Connect client id/secret not configured" });
      }
      const redirectUri = hasCredentialValue(payload.redirectUri)
        ? String(payload.redirectUri).trim()
        : resolveWebullOAuthRedirectUri({
          req,
          accountId,
          credentials,
        });
      const state = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString("hex");
      const authorizeUrl = buildWebullConnectAuthorizeUrl({
        clientId: oauth.clientId,
        redirectUri,
        scope: hasCredentialValue(payload.scope) ? payload.scope : oauth.scope,
        state,
        authorizeUrl: oauth.authorizeUrl,
      });

      await store.upsertAccount({
        accountId,
        broker: "webull",
        credentials: {
          WEBULL_OAUTH_SCOPE: hasCredentialValue(payload.scope) ? String(payload.scope).trim() : (oauth.scope || ""),
          WEBULL_OAUTH_REDIRECT_URI: redirectUri,
          WEBULL_OAUTH_STATE: state,
          WEBULL_OAUTH_STATE_CREATED_AT: new Date().toISOString(),
        },
      });

      return sendJson(res, 200, {
        authorizeUrl,
        redirectUri,
        state,
      });
    }

    const webullOAuthCallbackMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/webull\/oauth\/callback$/);
    if (method === "GET" && webullOAuthCallbackMatch) {
      const accountId = decodeURIComponent(webullOAuthCallbackMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "webull") {
        return sendJson(res, 400, { error: "OAuth callback endpoint is only available for Webull accounts" });
      }

      const code = firstNonEmptyValue(
        requestUrl.searchParams.get("code"),
        requestUrl.searchParams.get("authorization_code"),
      );
      const state = firstNonEmptyValue(
        requestUrl.searchParams.get("state"),
        requestUrl.searchParams.get("oauth_state"),
      );
      if (!code) {
        return sendJson(res, 400, { error: "Missing OAuth code query param" });
      }

      const credentials = mergeCredentialsWithEnvDefaults("webull", account.credentials || {});
      if (!hasCredentialValue(credentials.WEBULL_CLIENT_ID) || !hasCredentialValue(credentials.WEBULL_CLIENT_SECRET)) {
        return sendJson(res, 400, {
          error: "Webull Connect client id/secret not configured",
        });
      }
      const expectedState = firstNonEmptyValue(credentials.WEBULL_OAUTH_STATE);
      if (expectedState && state && String(expectedState) !== String(state)) {
        return sendJson(res, 400, { error: "OAuth state mismatch" });
      }

      let oauth;
      try {
        oauth = resolveWebullConnectCredentials(credentials);
      } catch (error) {
        return sendJson(res, 400, { error: error.message || "Webull Connect client id/secret not configured" });
      }
      const redirectUri = resolveWebullOAuthRedirectUri({
        req,
        accountId,
        credentials,
      });
      const token = await exchangeWebullConnectToken({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        code,
        redirectUri,
        apiBaseUrl: oauth.apiBaseUrl,
      });

      const updatedAccount = await store.upsertAccount({
        accountId,
        broker: "webull",
        credentials: {
          WEBULL_OAUTH_ACCESS_TOKEN: token.accessToken,
          WEBULL_OAUTH_REFRESH_TOKEN: token.refreshToken || "",
          WEBULL_OAUTH_ACCESS_EXPIRES_AT: token.accessExpiresAt || "",
          WEBULL_OAUTH_REFRESH_EXPIRES_AT: token.refreshExpiresAt || "",
          WEBULL_OAUTH_SCOPE: token.scope || credentials.WEBULL_OAUTH_SCOPE || "",
          WEBULL_OAUTH_STATE: "",
          WEBULL_OAUTH_STATE_CREATED_AT: "",
          WEBULL_OAUTH_REDIRECT_URI: redirectUri,
        },
      });
      const authResult = await resolveAccountAuthStatus(store, adapters.webull, updatedAccount, {
        refresh: false,
      });

      const prefersJson = requestUrl.searchParams.get("format") === "json"
        || String(req.headers.accept || "").includes("application/json");
      if (prefersJson) {
        return sendJson(res, 200, {
          ok: true,
          account: sanitizeAccountForClient(authResult.account),
          auth: authResult.auth,
          oauth: {
            accessTokenExpiresAt: token.accessExpiresAt || null,
            refreshTokenExpiresAt: token.refreshExpiresAt || null,
            scope: token.scope || null,
          },
        });
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>\n<html><head><meta charset=\"utf-8\"/><title>Webull OAuth Complete</title></head><body style=\"font-family: system-ui, sans-serif; padding: 24px; background: #ffffff; color: #0f172a;\"><h2>Webull OAuth complete</h2><p>Account <strong>${escapeHtml(accountId)}</strong> is linked for brokerage access. You can close this tab.</p></body></html>`);
      return;
    }

    const webullOAuthRefreshMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/webull\/oauth\/refresh$/);
    if (method === "POST" && webullOAuthRefreshMatch) {
      const accountId = decodeURIComponent(webullOAuthRefreshMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "webull") {
        return sendJson(res, 400, { error: "OAuth refresh endpoint is only available for Webull accounts" });
      }

      const credentials = mergeCredentialsWithEnvDefaults("webull", account.credentials || {});
      let oauth;
      try {
        oauth = resolveWebullConnectCredentials(credentials);
      } catch (error) {
        return sendJson(res, 400, { error: error.message || "Webull Connect client id/secret not configured" });
      }
      if (!hasCredentialValue(credentials.WEBULL_OAUTH_REFRESH_TOKEN)) {
        return sendJson(res, 409, {
          error: "Webull Connect OAuth refresh token is missing. Start OAuth again to relink brokerage access.",
        });
      }
      const refreshed = await refreshWebullConnectToken({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        refreshToken: credentials.WEBULL_OAUTH_REFRESH_TOKEN,
        apiBaseUrl: oauth.apiBaseUrl,
      });
      const updatedAccount = await store.upsertAccount({
        accountId,
        broker: "webull",
        credentials: {
          WEBULL_OAUTH_ACCESS_TOKEN: refreshed.accessToken,
          WEBULL_OAUTH_REFRESH_TOKEN: refreshed.refreshToken || credentials.WEBULL_OAUTH_REFRESH_TOKEN || "",
          WEBULL_OAUTH_ACCESS_EXPIRES_AT: refreshed.accessExpiresAt || "",
          WEBULL_OAUTH_REFRESH_EXPIRES_AT: refreshed.refreshExpiresAt || credentials.WEBULL_OAUTH_REFRESH_EXPIRES_AT || "",
          WEBULL_OAUTH_SCOPE: refreshed.scope || credentials.WEBULL_OAUTH_SCOPE || "",
        },
      });
      const authResult = await resolveAccountAuthStatus(store, adapters.webull, updatedAccount, {
        refresh: false,
      });

      return sendJson(res, 200, {
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
        oauth: {
          accessTokenExpiresAt: refreshed.accessExpiresAt || null,
          refreshTokenExpiresAt: refreshed.refreshExpiresAt || null,
          scope: refreshed.scope || null,
        },
      });
    }

    const webullOAuthRevokeMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/webull\/oauth\/revoke$/);
    if (method === "POST" && webullOAuthRevokeMatch) {
      const accountId = decodeURIComponent(webullOAuthRevokeMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "webull") {
        return sendJson(res, 400, { error: "OAuth revoke endpoint is only available for Webull accounts" });
      }

      const updatedAccount = await store.upsertAccount({
        accountId,
        broker: "webull",
        credentials: {
          WEBULL_OAUTH_ACCESS_TOKEN: "",
          WEBULL_OAUTH_REFRESH_TOKEN: "",
          WEBULL_OAUTH_ACCESS_EXPIRES_AT: "",
          WEBULL_OAUTH_REFRESH_EXPIRES_AT: "",
          WEBULL_OAUTH_STATE: "",
          WEBULL_OAUTH_STATE_CREATED_AT: "",
        },
      });
      const authResult = await resolveAccountAuthStatus(store, adapters.webull, updatedAccount, {
        refresh: false,
      });

      return sendJson(res, 200, {
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
        oauth: {
          revoked: true,
        },
      });
    }

    const etradeOAuthStatusMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/etrade\/oauth\/status$/);
    if (method === "GET" && etradeOAuthStatusMatch) {
      const accountId = decodeURIComponent(etradeOAuthStatusMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "etrade") {
        return sendJson(res, 400, { error: "OAuth status endpoint is only available for E*TRADE accounts" });
      }

      const credentials = mergeCredentialsWithEnvDefaults("etrade", account.credentials || {});
      const playwright = await detectPlaywrightAvailability();
      const issuedEtDate = credentials.ETRADE_OAUTH_ISSUED_ET_DATE || credentials.ETRADE_SESSION_ET_DATE || null;
      const callbackUrl = resolveEtradeOAuthCallbackUrl({
        req,
        credentials,
      });
      const requestTokenCreatedAt = firstNonEmptyValue(
        credentials.ETRADE_OAUTH_REQUEST_CREATED_AT,
        null,
      );
      const authResult = await resolveAccountAuthStatus(store, adapters.etrade, account, {
        refresh: false,
      });

      return sendJson(res, 200, {
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
        oauth: {
          hasConsumerKey: hasCredentialValue(credentials.ETRADE_PROD_KEY) || hasCredentialValue(credentials.ETRADE_SB_KEY),
          hasConsumerSecret: hasCredentialValue(credentials.ETRADE_PROD_SECRET) || hasCredentialValue(credentials.ETRADE_SB_SECRET),
          hasAccessToken: hasCredentialValue(credentials.ETRADE_ACCESS_TOKEN),
          hasAccessSecret: hasCredentialValue(credentials.ETRADE_ACCESS_SECRET),
          hasWebUsername: hasCredentialValue(credentials.ETRADE_WEB_USERNAME),
          hasWebPassword: hasCredentialValue(credentials.ETRADE_WEB_PASSWORD),
          callbackUrl,
          callbackMode: classifyEtradeOAuthCallbackUrl(callbackUrl),
          issuedEtDate,
          likelyExpiredByDate: isLikelyExpiredByEtDate(issuedEtDate),
          requestTokenPending: hasCredentialValue(credentials.ETRADE_OAUTH_REQUEST_TOKEN),
          requestTokenCreatedAt,
          requestTokenFresh: isLikelyFreshEtradeRequestToken(requestTokenCreatedAt),
          playwright,
        },
      });
    }

    const etradeOAuthStartMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/etrade\/oauth\/start$/);
    if (method === "POST" && etradeOAuthStartMatch) {
      const accountId = decodeURIComponent(etradeOAuthStartMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "etrade") {
        return sendJson(res, 400, { error: "OAuth start endpoint is only available for E*TRADE accounts" });
      }

      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const credentials = mergeCredentialsWithEnvDefaults("etrade", account.credentials || {});
      const consumer = resolveEtradeConsumerCredentials(credentials);
      const requestTokenResult = await requestEtradeRequestTokenWithFallback({
        req,
        credentials,
        consumer,
        requestedCallbackUrl: payload.callbackUrl,
      });
      const callbackUrl = requestTokenResult.callbackUrl;
      const token = requestTokenResult.token;
      const authorizeUrl = buildEtradeAuthorizeUrl({
        consumerKey: consumer.consumerKey,
        requestToken: token.requestToken,
      });

      await store.upsertAccount({
        accountId: account.accountId,
        broker: "etrade",
        credentials: {
          ETRADE_OAUTH_REQUEST_TOKEN: token.requestToken,
          ETRADE_OAUTH_REQUEST_SECRET: token.requestTokenSecret,
          ETRADE_OAUTH_REQUEST_CREATED_AT: new Date().toISOString(),
          ETRADE_AUTH_CALLBACK_URL: callbackUrl,
        },
        authState: "needs_token",
        authMessage: "E*TRADE authorization started",
        authCheckedAt: new Date().toISOString(),
      });

      return sendJson(res, 200, {
        ok: true,
        accountId: account.accountId,
        callbackUrl,
        callbackMode: requestTokenResult.callbackMode,
        fallbackUsed: requestTokenResult.fallbackUsed,
        fallbackReason: requestTokenResult.fallbackReason || null,
        requestToken: token.requestToken,
        expiresInSeconds: 300,
        authorizeUrl,
      });
    }

    const etradeOAuthCompleteMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/etrade\/oauth\/complete$/);
    if (method === "POST" && etradeOAuthCompleteMatch) {
      const accountId = decodeURIComponent(etradeOAuthCompleteMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "etrade") {
        return sendJson(res, 400, { error: "OAuth complete endpoint is only available for E*TRADE accounts" });
      }

      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const credentials = mergeCredentialsWithEnvDefaults("etrade", account.credentials || {});
      const consumer = resolveEtradeConsumerCredentials(credentials);
      const requestToken = firstNonEmptyValue(
        payload.requestToken,
        credentials.ETRADE_OAUTH_REQUEST_TOKEN,
      );
      const requestTokenSecret = firstNonEmptyValue(
        payload.requestTokenSecret,
        credentials.ETRADE_OAUTH_REQUEST_SECRET,
      );
      const verifier = firstNonEmptyValue(
        payload.verifier,
        payload.oauthVerifier,
        payload.oauth_verifier,
        credentials.ETRADE_VERIFIER,
      );

      const access = await exchangeEtradeAccessToken({
        consumerKey: consumer.consumerKey,
        consumerSecret: consumer.consumerSecret,
        useSandbox: consumer.useSandbox,
        requestToken,
        requestTokenSecret,
        verifier,
      });

      const updatedAccount = await store.upsertAccount({
        accountId: account.accountId,
        broker: "etrade",
        credentials: {
          ETRADE_ACCESS_TOKEN: access.accessToken,
          ETRADE_ACCESS_SECRET: access.accessSecret,
          ETRADE_VERIFIER: verifier,
          ETRADE_OAUTH_ISSUED_AT: access.issuedAt,
          ETRADE_OAUTH_ISSUED_ET_DATE: access.etradeSessionDate,
          ETRADE_OAUTH_LAST_RENEWED_AT: access.issuedAt,
          ETRADE_OAUTH_REQUEST_TOKEN: "",
          ETRADE_OAUTH_REQUEST_SECRET: "",
          ETRADE_OAUTH_REQUEST_CREATED_AT: "",
        },
      });

      const authResult = await resolveAccountAuthStatus(store, adapters.etrade, updatedAccount, {
        refresh: true,
      });

      return sendJson(res, 200, {
        ok: true,
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
        oauth: {
          issuedAt: access.issuedAt,
          issuedEtDate: access.etradeSessionDate,
        },
      });
    }

    const etradeOAuthAutomateMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/etrade\/oauth\/automate$/);
    if (method === "POST" && etradeOAuthAutomateMatch) {
      const accountId = decodeURIComponent(etradeOAuthAutomateMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "etrade") {
        return sendJson(res, 400, { error: "OAuth automate endpoint is only available for E*TRADE accounts" });
      }

      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const credentials = mergeCredentialsWithEnvDefaults("etrade", account.credentials || {});
      const consumer = resolveEtradeConsumerCredentials(credentials);
      const callbackUrl = firstNonEmptyValue(
        payload.callbackUrl,
        "oob",
      );

      const automation = await runEtradeOAuthAutomation({
        accountId,
        consumerKey: consumer.consumerKey,
        consumerSecret: consumer.consumerSecret,
        useSandbox: consumer.useSandbox,
        callbackUrl,
        username: firstNonEmptyValue(payload.username, credentials.ETRADE_WEB_USERNAME),
        password: firstNonEmptyValue(payload.password, credentials.ETRADE_WEB_PASSWORD),
        totpSecret: firstNonEmptyValue(payload.totpSecret, credentials.ETRADE_TOTP_SECRET),
        timeoutMs: Number(payload.timeoutMs || 120000),
        headless: payload.headless !== false,
      });

      if (automation.status === "authenticated") {
        const updatedAccount = await store.upsertAccount({
          accountId: account.accountId,
          broker: "etrade",
          credentials: {
            ETRADE_ACCESS_TOKEN: automation.accessToken,
            ETRADE_ACCESS_SECRET: automation.accessSecret,
            ETRADE_VERIFIER: automation.verifier,
            ETRADE_OAUTH_ISSUED_AT: automation.issuedAt,
            ETRADE_OAUTH_ISSUED_ET_DATE: automation.etradeSessionDate,
            ETRADE_OAUTH_LAST_RENEWED_AT: automation.issuedAt,
            ETRADE_OAUTH_REQUEST_TOKEN: "",
            ETRADE_OAUTH_REQUEST_SECRET: "",
            ETRADE_OAUTH_REQUEST_CREATED_AT: "",
            ...(hasCredentialValue(payload.callbackUrl) ? { ETRADE_AUTH_CALLBACK_URL: callbackUrl } : {}),
          },
        });
        const authResult = await resolveAccountAuthStatus(store, adapters.etrade, updatedAccount, {
          refresh: true,
        });

        return sendJson(res, 200, {
          ok: true,
          automated: true,
          account: sanitizeAccountForClient(authResult.account),
          auth: authResult.auth,
          oauth: {
            issuedAt: automation.issuedAt,
            issuedEtDate: automation.etradeSessionDate,
          },
        });
      }

      await store.upsertAccount({
        accountId: account.accountId,
        broker: "etrade",
        credentials: {
          ETRADE_OAUTH_REQUEST_TOKEN: automation.requestToken || "",
          ETRADE_OAUTH_REQUEST_SECRET: automation.requestTokenSecret || "",
          ETRADE_OAUTH_REQUEST_CREATED_AT: new Date().toISOString(),
          ...(hasCredentialValue(payload.callbackUrl) ? { ETRADE_AUTH_CALLBACK_URL: callbackUrl } : {}),
        },
        authState: "needs_token",
        authMessage: automation.reason || "Manual E*TRADE authorization required",
        authCheckedAt: new Date().toISOString(),
      });

      return sendJson(res, 202, {
        ok: true,
        automated: false,
        status: automation.status,
        reason: automation.reason,
        authorizeUrl: automation.authorizeUrl,
        callbackUrl,
      });
    }

    if (method === "GET" && pathname === "/api/integrations/etrade/callback") {
      const requestToken = firstNonEmptyValue(
        requestUrl.searchParams.get("oauth_token"),
        requestUrl.searchParams.get("token"),
      );
      const verifier = firstNonEmptyValue(
        requestUrl.searchParams.get("oauth_verifier"),
        requestUrl.searchParams.get("verifier"),
      );
      if (!requestToken || !verifier) {
        return sendJson(res, 400, { error: "Missing oauth_token or oauth_verifier query params" });
      }

      const matchedAccount = store.listAccounts().find((candidate) => {
        if (candidate?.broker !== "etrade") {
          return false;
        }
        const credentials = mergeCredentialsWithEnvDefaults("etrade", candidate.credentials || {});
        return String(credentials.ETRADE_OAUTH_REQUEST_TOKEN || "").trim() === requestToken;
      });
      if (!matchedAccount) {
        return sendJson(res, 404, { error: "No E*TRADE account found for callback token" });
      }

      const credentials = mergeCredentialsWithEnvDefaults("etrade", matchedAccount.credentials || {});
      const consumer = resolveEtradeConsumerCredentials(credentials);
      const access = await exchangeEtradeAccessToken({
        consumerKey: consumer.consumerKey,
        consumerSecret: consumer.consumerSecret,
        useSandbox: consumer.useSandbox,
        requestToken,
        requestTokenSecret: credentials.ETRADE_OAUTH_REQUEST_SECRET,
        verifier,
      });

      const updatedAccount = await store.upsertAccount({
        accountId: matchedAccount.accountId,
        broker: "etrade",
        credentials: {
          ETRADE_ACCESS_TOKEN: access.accessToken,
          ETRADE_ACCESS_SECRET: access.accessSecret,
          ETRADE_VERIFIER: verifier,
          ETRADE_OAUTH_ISSUED_AT: access.issuedAt,
          ETRADE_OAUTH_ISSUED_ET_DATE: access.etradeSessionDate,
          ETRADE_OAUTH_LAST_RENEWED_AT: access.issuedAt,
          ETRADE_OAUTH_REQUEST_TOKEN: "",
          ETRADE_OAUTH_REQUEST_SECRET: "",
          ETRADE_OAUTH_REQUEST_CREATED_AT: "",
        },
      });
      const authResult = await resolveAccountAuthStatus(store, adapters.etrade, updatedAccount, {
        refresh: true,
      });

      const prefersJson = requestUrl.searchParams.get("format") === "json"
        || String(req.headers.accept || "").includes("application/json");
      if (prefersJson) {
        return sendJson(res, 200, {
          ok: true,
          account: sanitizeAccountForClient(authResult.account),
          auth: authResult.auth,
          oauth: {
            issuedAt: access.issuedAt,
            issuedEtDate: access.etradeSessionDate,
          },
        });
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>\n<html><head><meta charset=\"utf-8\"/><title>E*TRADE OAuth Complete</title></head><body style=\"font-family: system-ui, sans-serif; padding: 24px; background: #ffffff; color: #0f172a;\"><h2>E*TRADE OAuth complete</h2><p>Account <strong>${escapeHtml(matchedAccount.accountId)}</strong> is connected. This window will close automatically when possible.</p><script>(function(){try{if(window.opener&&!window.opener.closed){window.opener.postMessage({type:\"etrade-oauth-complete\",accountId:${JSON.stringify(matchedAccount.accountId)}},window.location.origin);setTimeout(function(){window.close();},80);}}catch(_error){}})();</script></body></html>`);
      return;
    }

    const etradeOAuthRenewMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/etrade\/oauth\/renew$/);
    if (method === "POST" && etradeOAuthRenewMatch) {
      const accountId = decodeURIComponent(etradeOAuthRenewMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "etrade") {
        return sendJson(res, 400, { error: "OAuth renew endpoint is only available for E*TRADE accounts" });
      }

      const credentials = mergeCredentialsWithEnvDefaults("etrade", account.credentials || {});
      const issuedEtDate = firstNonEmptyValue(
        credentials.ETRADE_OAUTH_ISSUED_ET_DATE,
        credentials.ETRADE_SESSION_ET_DATE,
      );
      if (isLikelyExpiredByEtDate(issuedEtDate)) {
        return sendJson(res, 409, {
          error: "E*Trade OAuth session expired after the ET day rollover. Start a new login to get a fresh token.",
        });
      }
      const consumer = resolveEtradeConsumerCredentials(credentials);
      let result;
      try {
        result = await renewEtradeAccessToken({
          consumerKey: consumer.consumerKey,
          consumerSecret: consumer.consumerSecret,
          useSandbox: consumer.useSandbox,
          accessToken: credentials.ETRADE_ACCESS_TOKEN,
          accessSecret: credentials.ETRADE_ACCESS_SECRET,
        });
      } catch (error) {
        const unauthorized = isLikelyEtradeUnauthorizedMessage(error?.message);
        return sendJson(res, unauthorized ? 401 : 502, {
          error: unauthorized
            ? "E*Trade OAuth session was rejected by the API. Log in again for a new token."
            : (error?.message || "E*Trade token renew failed"),
        });
      }

      const updatedAccount = await store.upsertAccount({
        accountId: account.accountId,
        broker: "etrade",
        credentials: {
          ETRADE_OAUTH_LAST_RENEWED_AT: result.renewedAt,
          ETRADE_OAUTH_ISSUED_ET_DATE: result.etradeSessionDate || etDateKey(new Date()),
        },
      });
      const authResult = await resolveAccountAuthStatus(store, adapters.etrade, updatedAccount, {
        refresh: false,
      });

      return sendJson(res, 200, {
        ok: true,
        account: sanitizeAccountForClient(authResult.account),
        auth: authResult.auth,
        renewedAt: result.renewedAt,
      });
    }

    const etradeOAuthRevokeMatch = pathname.match(/^\/api\/accounts\/([^/]+)\/etrade\/oauth\/revoke$/);
    if (method === "POST" && etradeOAuthRevokeMatch) {
      const accountId = decodeURIComponent(etradeOAuthRevokeMatch[1]);
      const account = store.getAccount(accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }
      if (account.broker !== "etrade") {
        return sendJson(res, 400, { error: "OAuth revoke endpoint is only available for E*TRADE accounts" });
      }

      const credentials = mergeCredentialsWithEnvDefaults("etrade", account.credentials || {});
      const consumer = resolveEtradeConsumerCredentials(credentials);
      if (hasCredentialValue(credentials.ETRADE_ACCESS_TOKEN) && hasCredentialValue(credentials.ETRADE_ACCESS_SECRET)) {
        await revokeEtradeAccessToken({
          consumerKey: consumer.consumerKey,
          consumerSecret: consumer.consumerSecret,
          useSandbox: consumer.useSandbox,
          accessToken: credentials.ETRADE_ACCESS_TOKEN,
          accessSecret: credentials.ETRADE_ACCESS_SECRET,
        });
      }

      const updatedAccount = await store.upsertAccount({
        accountId: account.accountId,
        broker: "etrade",
        credentials: {
          ETRADE_ACCESS_TOKEN: "",
          ETRADE_ACCESS_SECRET: "",
          ETRADE_VERIFIER: "",
          ETRADE_OAUTH_ISSUED_AT: "",
          ETRADE_OAUTH_ISSUED_ET_DATE: "",
          ETRADE_OAUTH_LAST_RENEWED_AT: "",
          ETRADE_OAUTH_REQUEST_TOKEN: "",
          ETRADE_OAUTH_REQUEST_SECRET: "",
          ETRADE_OAUTH_REQUEST_CREATED_AT: "",
        },
        authState: "needs_token",
        authMessage: "E*TRADE token revoked",
        authCheckedAt: new Date().toISOString(),
      });

      return sendJson(res, 200, {
        ok: true,
        account: sanitizeAccountForClient(updatedAccount),
      });
    }

    if (method === "GET" && pathname === "/api/positions") {
      const accountId = requestUrl.searchParams.get("accountId") || "all";
      const syncStatusByAccount = await syncPositionsForRequest(store, adapters, accountId);
      const positionsPayload = buildPositionsPayload(store, accountId, syncStatusByAccount);
      return sendJson(res, 200, positionsPayload);
    }

    if (method === "GET" && pathname === "/api/market/spot") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for market request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getSpotQuote) {
        return sendJson(res, 400, { error: "Adapter does not support spot quotes" });
      }

      const quote = await adapter.getSpotQuote(account, symbol);
      const liveIssue = getStrictLiveMarketDataIssue(account, quote);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live market quote unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          quote,
        });
      }
      return sendJson(res, 200, { accountId: account.accountId, quote });
    }

    if (method === "GET" && pathname === "/api/market/bars") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const resolution = requestUrl.searchParams.get("resolution") || "5";
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const countBack = requestUrl.searchParams.get("countBack");
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for market request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getBars) {
        return sendJson(res, 400, { error: "Adapter does not support market bars" });
      }

      const bars = await adapter.getBars(account, {
        symbol,
        resolution,
        from,
        to,
        countBack,
      });
      const liveIssue = getStrictLiveMarketDataIssue(account, bars);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live market bars unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          bars,
        });
      }

      return sendJson(res, 200, {
        accountId: account.accountId,
        ...bars,
      });
    }

    if (method === "GET" && pathname === "/api/market/depth") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const levels = requestUrl.searchParams.get("levels")
        || requestUrl.searchParams.get("depthLevels");
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for market request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getMarketDepth) {
        return sendJson(res, 400, { error: "Adapter does not support market depth" });
      }

      const depth = await adapter.getMarketDepth(account, {
        symbol,
        levels,
      });
      const liveIssue = getStrictLiveMarketDataIssue(account, depth);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live market depth unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          depth,
        });
      }
      return sendJson(res, 200, { accountId: account.accountId, depth });
    }

    if (method === "GET" && pathname === "/api/market/ticks") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const limit = requestUrl.searchParams.get("limit")
        || requestUrl.searchParams.get("tickLimit");
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for market request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getMarketTicks) {
        return sendJson(res, 400, { error: "Adapter does not support market ticks" });
      }

      const ticks = await adapter.getMarketTicks(account, {
        symbol,
        limit,
      });
      const liveIssue = getStrictLiveMarketDataIssue(account, ticks);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live market ticks unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          ticks,
        });
      }
      return sendJson(res, 200, { accountId: account.accountId, ticks });
    }

    if (method === "GET" && pathname === "/api/market/footprint") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const resolution = requestUrl.searchParams.get("resolution") || "5";
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const countBack = requestUrl.searchParams.get("countBack");
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for market request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getMarketFootprint) {
        return sendJson(res, 400, { error: "Adapter does not support market footprint" });
      }

      const footprint = await adapter.getMarketFootprint(account, {
        symbol,
        resolution,
        from,
        to,
        countBack,
      });
      const liveIssue = getStrictLiveMarketDataIssue(account, footprint);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live market footprint unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          footprint,
        });
      }
      return sendJson(res, 200, { accountId: account.accountId, footprint });
    }

    if (method === "GET" && pathname === "/api/market/order-flow") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const resolution = requestUrl.searchParams.get("resolution") || "5";
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const countBack = requestUrl.searchParams.get("countBack");
      const levels = requestUrl.searchParams.get("levels")
        || requestUrl.searchParams.get("depthLevels");
      const limit = requestUrl.searchParams.get("limit")
        || requestUrl.searchParams.get("tickLimit");
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for market request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getOrderFlow) {
        return sendJson(res, 400, { error: "Adapter does not support order-flow distribution" });
      }

      const orderFlow = await adapter.getOrderFlow(account, {
        symbol,
        resolution,
        from,
        to,
        countBack,
        levels,
        limit,
      });
      const liveIssue = getStrictLiveMarketDataIssue(account, orderFlow, {
        nestedSources: ["depth", "ticks", "footprint"],
      });
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live order-flow unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          orderFlow,
        });
      }
      return sendJson(res, 200, { accountId: account.accountId, orderFlow });
    }

    if (method === "GET" && pathname === "/api/options/chain") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const expiry = requestUrl.searchParams.get("expiry");
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for options request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getOptionChain) {
        return sendJson(res, 400, { error: "Adapter does not support option chains" });
      }

      const chain = await adapter.getOptionChain(account, { symbol, expiry });
      const liveIssue = getStrictLiveMarketDataIssue(account, chain);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live option chain unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          chain,
        });
      }
      await store.upsertOptionContracts(chain?.rows || [], {
        broker: account.broker,
        accountId: account.accountId,
        source: chain?.source || null,
        stale: chain?.stale,
      });
      return sendJson(res, 200, { accountId: account.accountId, chain });
    }

    if (method === "GET" && pathname === "/api/options/ladder") {
      const accountId = requestUrl.searchParams.get("accountId");
      const symbol = requestUrl.searchParams.get("symbol") || "SPY";
      const expiry = requestUrl.searchParams.get("expiry");
      const right = requestUrl.searchParams.get("right") || "call";
      const window = requestUrl.searchParams.get("window");
      const account = resolveMarketAccount(store, accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found for options request" });
      }

      const adapter = adapters[account.broker];
      if (!adapter?.getOptionLadder) {
        return sendJson(res, 400, { error: "Adapter does not support option ladders" });
      }

      const ladder = await adapter.getOptionLadder(account, {
        symbol,
        expiry,
        right,
        window,
      });
      const liveIssue = getStrictLiveMarketDataIssue(account, ladder);
      if (liveIssue) {
        return sendJson(res, 409, {
          error: "Live option ladder unavailable without verified broker data",
          code: "LIVE_MARKET_DATA_UNAVAILABLE",
          issue: liveIssue,
          ladder,
        });
      }
      await store.upsertOptionContracts(ladder?.rows || [], {
        broker: account.broker,
        accountId: account.accountId,
        source: ladder?.source || null,
        stale: ladder?.stale,
      });
      return sendJson(res, 200, { accountId: account.accountId, ladder });
    }

    if (method === "GET" && pathname === "/api/options/contracts") {
      const contracts = store.listOptionContracts({
        symbol: requestUrl.searchParams.get("symbol"),
        expiry: requestUrl.searchParams.get("expiry"),
        right: requestUrl.searchParams.get("right"),
        broker: requestUrl.searchParams.get("broker"),
        accountId: requestUrl.searchParams.get("accountId"),
        query: requestUrl.searchParams.get("query"),
        limit: requestUrl.searchParams.get("limit"),
      });
      return sendJson(res, 200, {
        contracts,
        count: contracts.length,
      });
    }

    const optionContractMatch = pathname.match(/^\/api\/options\/contracts\/([^/]+)$/);
    if (method === "GET" && optionContractMatch) {
      const contractId = decodeURIComponent(optionContractMatch[1]);
      const contract = store.getOptionContract(contractId);
      if (!contract) {
        return sendJson(res, 404, { error: "Option contract not found" });
      }
      return sendJson(res, 200, { contract });
    }

    if (method === "POST" && pathname === "/api/orders/preflight") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const order = normalizeOrderPayloadOrSend(payload, res);
      if (!order) {
        return;
      }
      const account = store.getAccount(order.accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      await upsertOptionContractFromOrder(store, order, {
        broker: account.broker,
        accountId: account.accountId,
        source: "order-preflight",
      });

      const adapter = adapters[account.broker] || null;
      const commission = commissionForBroker(account.broker);
      const preflight = await buildOrderPreflight({
        order,
        payload,
        account,
        adapter,
        commissionPerContract: commission,
      });
      return sendJson(res, 200, {
        preflight,
        order,
      });
    }

    if (method === "POST" && pathname === "/api/orders/preview") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const order = normalizeOrderPayloadOrSend(payload, res);
      if (!order) {
        return;
      }
      const account = store.getAccount(order.accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      await upsertOptionContractFromOrder(store, order, {
        broker: account.broker,
        accountId: account.accountId,
        source: "order-preview",
      });

      const adapter = adapters[account.broker] || null;
      const commission = commissionForBroker(account.broker);
      const preview = buildOrderPreview(order, commission);
      const preflight = await buildOrderPreflight({
        order,
        payload,
        account,
        adapter,
        commissionPerContract: commission,
      });
      return sendJson(res, 200, { preview, preflight, order });
    }

    if (method === "POST" && pathname === "/api/orders") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const order = normalizeOrderPayloadOrSend(payload, res);
      if (!order) {
        return;
      }
      const account = store.getAccount(order.accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      await upsertOptionContractFromOrder(store, order, {
        broker: account.broker,
        accountId: account.accountId,
        source: "order-submit",
      });

      if (order.executionMode === "live" && account.mode !== "live") {
        return sendJson(res, 409, {
          error: "Account is not enabled for live mode",
        });
      }

      const adapter = adapters[account.broker];
      if (!adapter) {
        return sendJson(res, 400, { error: "Adapter not available for account" });
      }
      const liveExecutionGuard = getLiveExecutionGuardResponse({
        account,
        adapter,
        orderLike: order,
      });
      if (liveExecutionGuard) {
        return sendJson(res, liveExecutionGuard.status, liveExecutionGuard.body);
      }

      const preflight = await buildOrderPreflight({
        order,
        payload,
        account,
        adapter,
        commissionPerContract: commissionForBroker(account.broker),
      });
      if (isBlockingPreflight(preflight)) {
        return sendJson(res, 409, {
          error: "Order blocked by preflight checks",
          preflight,
          order,
        });
      }

      const result = await adapter.placeOrder(account, order);
      await store.upsertAccount({
        accountId: account.accountId,
        broker: account.broker,
        lastSync: new Date().toISOString(),
        status: "connected",
      });

      return sendJson(res, 200, { order: result, preflight });
    }

    if (method === "POST" && pathname === "/api/options/orders/rapid") {
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }

      const rapidOrder = normalizeRapidOptionOrderOrSend(payload, res);
      if (!rapidOrder) {
        return;
      }

      const account = store.getAccount(rapidOrder.order.accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      await upsertOptionContractFromOrder(store, rapidOrder.order, {
        broker: account.broker,
        accountId: account.accountId,
        source: "rapid-order",
      });

      if (rapidOrder.order.executionMode === "live" && account.mode !== "live") {
        return sendJson(res, 409, {
          error: "Account is not enabled for live mode",
        });
      }

      const adapter = adapters[account.broker];
      if (!adapter) {
        return sendJson(res, 400, { error: "Adapter not available for account" });
      }
      const liveExecutionGuard = getLiveExecutionGuardResponse({
        account,
        adapter,
        orderLike: rapidOrder.order,
      });
      if (liveExecutionGuard) {
        return sendJson(res, liveExecutionGuard.status, liveExecutionGuard.body);
      }

      const preflight = await buildOrderPreflight({
        order: rapidOrder.order,
        payload: rapidOrder.rawPayload,
        account,
        adapter,
        commissionPerContract: commissionForBroker(account.broker),
      });

      if (rapidOrder.previewOnly) {
        const commission = commissionForBroker(account.broker);
        const preview = buildOrderPreview(rapidOrder.order, commission);
        return sendJson(res, 200, {
          preview,
          preflight,
          order: rapidOrder.order,
          previewOnly: true,
        });
      }

      if (isBlockingPreflight(preflight)) {
        return sendJson(res, 409, {
          error: "Order blocked by preflight checks",
          preflight,
          order: rapidOrder.order,
          previewOnly: false,
        });
      }

      const result = await adapter.placeOrder(account, rapidOrder.order);
      await store.upsertAccount({
        accountId: account.accountId,
        broker: account.broker,
        lastSync: new Date().toISOString(),
        status: "connected",
      });

      return sendJson(res, 200, {
        previewOnly: false,
        order: result,
        preflight,
      });
    }

    const closeMatch = pathname.match(/^\/api\/positions\/([^/]+)\/close$/);
    if (method === "POST" && closeMatch) {
      const positionId = decodeURIComponent(closeMatch[1]);
      const payload = await parseRequestBody(req, res);
      if (payload == null) {
        return;
      }
      const closeRequest = normalizeClosePayloadOrSend(
        payload,
        payload.accountId || null,
        res,
      );
      if (!closeRequest) {
        return;
      }
      const account = store.getAccount(closeRequest.accountId);
      if (!account) {
        return sendJson(res, 404, { error: "Account not found" });
      }

      if (closeRequest.executionMode === "live" && account.mode !== "live") {
        return sendJson(res, 409, {
          error: "Account is not enabled for live mode",
        });
      }

      const adapter = adapters[account.broker];
      if (!adapter) {
        return sendJson(res, 400, { error: "Adapter not available for account" });
      }
      const liveExecutionGuard = getLiveExecutionGuardResponse({
        account,
        adapter,
        orderLike: closeRequest,
      });
      if (liveExecutionGuard) {
        return sendJson(res, liveExecutionGuard.status, liveExecutionGuard.body);
      }

      const result = await adapter.closePosition(account, positionId, closeRequest);
      await store.upsertAccount({
        accountId: account.accountId,
        broker: account.broker,
        lastSync: new Date().toISOString(),
        status: "connected",
      });

      return sendJson(res, 200, { order: result });
    }

    if (method === "GET" && pathname === "/api/orders") {
      const accountId = requestUrl.searchParams.get("accountId");
      const status = requestUrl.searchParams.get("status");
      const lifecycleState = requestUrl.searchParams.get("lifecycleState");
      const openOnly = requestUrl.searchParams.get("openOnly");
      const from = requestUrl.searchParams.get("from");
      const to = requestUrl.searchParams.get("to");
      const limit = requestUrl.searchParams.get("limit");
      const orders = store.listOrders({
        accountId,
        status,
        lifecycleState,
        openOnly,
        from,
        to,
        limit,
      });
      return sendJson(res, 200, {
        orders,
        count: orders.length,
      });
    }

    const orderEventsMatch = pathname.match(/^\/api\/orders\/([^/]+)\/events$/);
    if (method === "GET" && orderEventsMatch) {
      const orderId = decodeURIComponent(orderEventsMatch[1]);
      const order = store.getOrder(orderId);
      if (!order) {
        return sendJson(res, 404, { error: "Order not found" });
      }
      const events = Array.isArray(order.events) ? order.events : [];
      return sendJson(res, 200, {
        orderId,
        events,
        count: events.length,
      });
    }

    const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (method === "GET" && orderMatch) {
      const orderId = decodeURIComponent(orderMatch[1]);
      const order = store.getOrder(orderId);
      if (!order) {
        return sendJson(res, 404, { error: "Order not found" });
      }
      return sendJson(res, 200, { order });
    }

    return sendJson(res, 404, {
      error: `Not found: ${method} ${pathname}`,
      hint: "If this route was recently added, restart the dev server.",
    });
  };
}

function getEnvCredentialDefaultsByBroker() {
  const out = {};
  for (const [broker, keys] of Object.entries(ENV_CREDENTIAL_KEYS_BY_BROKER)) {
    const credentials = {};
    for (const key of keys) {
      const { value } = resolveEnvCredentialSource(key);
      if (value == null || String(value).trim() === "") {
        continue;
      }
      credentials[key] = String(value);
    }
    if (Object.keys(credentials).length > 0) {
      out[broker] = credentials;
    }
  }
  return out;
}

function getEnvCredentialStatusByBroker() {
  const out = {};
  for (const [broker, keys] of Object.entries(ENV_CREDENTIAL_KEYS_BY_BROKER)) {
    const statusByKey = {};
    for (const key of keys) {
      const resolved = resolveEnvCredentialSource(key);
      statusByKey[key] = {
        configured: hasCredentialValue(resolved.value),
        sourceEnvKey: resolved.source || null,
      };
    }
    out[broker] = statusByKey;
  }
  return out;
}

async function enrichAccounts(store, accounts, adapters) {
  const tasks = (Array.isArray(accounts) ? accounts : []).map(async (account) => {
    const resolvedAccount = withMergedEnvCredentials(account);
    const adapter = adapters[account.broker];
    const summary = await resolveDisplaySummary(store, resolvedAccount, adapter);
    return { ...resolvedAccount, summary };
  });
  return Promise.all(tasks);
}

async function hydrateAccountsForDisplay(store, accounts, adapters) {
  const tasks = (Array.isArray(accounts) ? accounts : []).map(async (account) => {
    const resolvedAccount = withMergedEnvCredentials(account);
    const adapter = adapters[resolvedAccount?.broker];
    if (!adapter?.getAuthStatus || !shouldRefreshAccountAuthForDisplay(resolvedAccount)) {
      return resolvedAccount;
    }
    const authResult = await resolveAccountAuthStatus(store, adapter, resolvedAccount, {
      refresh: false,
    });
    return withMergedEnvCredentials(authResult.account);
  });
  return Promise.all(tasks);
}

function shouldRefreshAccountAuthForDisplay(account) {
  if (!account || typeof account !== "object") {
    return false;
  }
  if (String(account?.mode || "live").toLowerCase() !== "live") {
    return false;
  }
  if (String(account?.broker || "").toLowerCase() === "etrade") {
    return true;
  }
  if (String(account?.broker || "").toLowerCase() === "webull") {
    const tokenState = firstNonEmptyValue(
      account?.credentials?.WEBULL_TOKEN_STATUS,
      account?.credentials?.WEBULL_TOKEN_STATE,
    );
    if (
      !hasCredentialValue(tokenState)
      || !hasCredentialValue(account?.credentials?.WEBULL_ACCESS_TOKEN)
    ) {
      return true;
    }
  }
  const checkedMs = Date.parse(String(account?.authCheckedAt || ""));
  if (!Number.isFinite(checkedMs)) {
    return true;
  }
  return Date.now() - checkedMs >= ACCOUNT_AUTH_DISPLAY_REFRESH_TTL_MS;
}

function resolveRequestedAccounts(store, requestedAccountId) {
  if (requestedAccountId && requestedAccountId !== "all") {
    const account = store.getAccount(requestedAccountId);
    return account ? [withMergedEnvCredentials(account)] : [];
  }
  return store.listAccounts().map(withMergedEnvCredentials);
}

async function refreshEquityHistoryForAccounts({
  store,
  adapters,
  accounts,
  from,
  to,
  days,
  limit,
  includeBackfill,
}) {
  const result = {};
  for (const account of accounts || []) {
    const resolvedAccount = withMergedEnvCredentials(account);
    const adapter = adapters[resolvedAccount.broker];
    const authState = String(resolvedAccount.authState || "").toLowerCase();
    const isLiveMode = String(resolvedAccount.mode || "live").toLowerCase() === "live";
    const allowExplicitBackfillAttempt = Boolean(includeBackfill) && typeof adapter?.getEquityHistory === "function";
    if (isLiveMode && authState !== "authenticated" && !allowExplicitBackfillAttempt) {
      await hydrateAccountEquityHistoryFromDb({
        store,
        account: resolvedAccount,
        from,
        to,
        limit,
      });
      result[resolvedAccount.accountId] = sanitizeEquityRowsForAccount(
        resolvedAccount,
        store.listAccountEquityHistory(resolvedAccount.accountId, {
          from,
          to,
          limit,
        }),
      );
      continue;
    }

    if (!adapter) {
      result[resolvedAccount.accountId] = sanitizeEquityRowsForAccount(
        resolvedAccount,
        store.listAccountEquityHistory(resolvedAccount.accountId, {
          from,
          to,
          limit,
        }),
      );
      continue;
    }

    const hasLocalHistory = Boolean(store.getLatestAccountEquityPoint(resolvedAccount.accountId));
    const shouldBackfill = Boolean(includeBackfill) || !hasLocalHistory;

    let mergedBackfill = false;
    if (shouldBackfill && typeof adapter.getEquityHistory === "function") {
      try {
        const rows = await withTimeout(
          adapter.getEquityHistory(resolvedAccount, {
            from,
            to,
            days,
            maxPoints: limit,
          }),
          10000,
        );
        if (Array.isArray(rows) && rows.length) {
          await store.mergeAccountEquityHistory(resolvedAccount.accountId, rows, {
            from,
            to,
            limit,
          });
          mergedBackfill = true;
          await persistAccountEquityHistoryToDb({
            account: resolvedAccount,
            points: rows,
          });
        }
      } catch {
        // Keep best-effort behavior when broker backfill endpoint is unavailable.
      }
    }

    if (!mergedBackfill) {
      await hydrateAccountEquityHistoryFromDb({
        store,
        account: resolvedAccount,
        from,
        to,
        limit,
      });
    }

    await captureAccountEquitySnapshot({
      store,
      adapter,
      account: resolvedAccount,
    });

    const latestPoint = store.getLatestAccountEquityPoint(resolvedAccount.accountId);
    if (latestPoint) {
      await persistAccountEquityHistoryToDb({
        account: resolvedAccount,
        points: [latestPoint],
      });
    }

    result[resolvedAccount.accountId] = sanitizeEquityRowsForAccount(
      resolvedAccount,
      store.listAccountEquityHistory(resolvedAccount.accountId, {
        from,
        to,
        limit,
      }),
    );
  }
  return result;
}

async function captureAccountEquitySnapshot({
  store,
  adapter,
  account,
  summaryHint,
}) {
  if (!account || !adapter) {
    return null;
  }
  const summary = summaryHint || await withTimeout(
    adapter.getAccountSummary(account),
    3500,
  ).catch(() => null);
  if (!summary || typeof summary !== "object") {
    return null;
  }
  const source = String(summary.source || "").toLowerCase();
  const authState = String(account?.authState || "").toLowerCase();
  const isLiveMode = String(account?.mode || "live").toLowerCase() === "live";
  if (isLiveMode && authState !== "authenticated") {
    return null;
  }
  if (isLiveMode && !isTrustedLiveSummarySource(account, source)) {
    return null;
  }
  if (account.broker === "etrade" && source === "etrade-live-summary") {
    const equity = Number(summary.equity);
    if (!Number.isFinite(equity) || equity <= 0) {
      return null;
    }
  }

  const latest = store.getLatestAccountEquityPoint(account.accountId);
  if (latest) {
    const prev = Number(latest.equity);
    const next = Number(summary.equity);
    const ageMs = Math.abs(Number(summary.epochMs || Date.parse(summary.lastSync || summary.ts || Date.now())) - Number(latest.epochMs || 0));
    if (
      Number.isFinite(prev)
      && Number.isFinite(next)
      && prev > 0
      && next > 0
      && ageMs <= 120000
      && Math.abs(next - prev) / prev > 0.6
    ) {
      return null;
    }
  }

  if (!Number.isFinite(Number(summary.equity))) {
    return null;
  }

  await store.appendAccountEquitySnapshot(account.accountId, {
    ...summary,
    ts: summary.lastSync || summary.ts || new Date().toISOString(),
    source: summary.source || `${account.broker}-summary`,
  });
  return summary;
}

function aggregateEquityHistorySeries(pointsByAccount, options = {}) {
  const accountSeries = Object.entries(pointsByAccount || {})
    .filter(([, rows]) => Array.isArray(rows) && rows.length);
  if (!accountSeries.length) {
    return [];
  }

  const events = [];
  for (const [accountId, rows] of accountSeries) {
    for (const row of rows) {
      const epochMs = Number(row?.epochMs);
      const equity = Number(row?.equity);
      if (!Number.isFinite(epochMs) || !Number.isFinite(equity)) {
        continue;
      }
      events.push({
        accountId,
        epochMs,
        equity,
      });
    }
  }
  if (!events.length) {
    return [];
  }
  events.sort((a, b) => Number(a.epochMs) - Number(b.epochMs));

  const latestByAccount = new Map();
  const aggregated = [];
  for (const event of events) {
    latestByAccount.set(event.accountId, Number(event.equity));
    let total = 0;
    for (const value of latestByAccount.values()) {
      total += Number(value || 0);
    }

    const last = aggregated[aggregated.length - 1];
    const point = {
      ts: new Date(event.epochMs).toISOString(),
      epochMs: Math.round(event.epochMs),
      equity: round2(total),
      source: "accounts-aggregate",
      stale: false,
    };
    if (last && Number(last.epochMs) === Number(point.epochMs)) {
      aggregated[aggregated.length - 1] = point;
    } else {
      aggregated.push(point);
    }
  }

  const limit = clampNumber(options.limit, 1, 50000, 5000);
  if (aggregated.length > limit) {
    return aggregated.slice(aggregated.length - limit);
  }
  return aggregated;
}

function sanitizeEquityRowsForAccount(account, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const authState = String(account?.authState || "").toLowerCase();
  const isLiveMode = String(account?.mode || "live").toLowerCase() === "live";
  const authUnavailable = isLiveMode && authState !== "authenticated";

  const filtered = list
    .filter((row) => {
      const source = String(row?.source || "").toLowerCase();
      if (!source) {
        return false;
      }
      if (isLiveMode && !isTrustedLiveHistorySource(account, source)) {
        return false;
      }
      if (account?.broker === "etrade") {
        if (source === "etrade-summary") {
          return false;
        }
        const equity = Number(row?.equity);
        if (source.endsWith("summary") && (!Number.isFinite(equity) || equity <= 0)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => Number(a?.epochMs) - Number(b?.epochMs));

  return collapseRapidEquitySpikeRuns(filtered, account)
    .map((row) => (
      authUnavailable
        ? {
          ...row,
          stale: true,
          liveReconnectRequired: true,
        }
        : row
    ));
}

function collapseRapidEquitySpikeRuns(rows, account) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length < 3) {
    return list;
  }

  const config = getRapidEquitySpikeConfig(account);
  if (!config) {
    return list;
  }

  const out = [];
  let index = 0;
  while (index < list.length) {
    const current = list[index];
    const prev = out[out.length - 1];
    if (!prev || !isRapidSpikeSource(current, config)) {
      out.push(current);
      index += 1;
      continue;
    }

    const prevEquity = Number(prev?.equity);
    const prevEpochMs = Number(prev?.epochMs);
    const currentEquity = Number(current?.equity);
    const currentEpochMs = Number(current?.epochMs);
    if (
      !Number.isFinite(prevEquity)
      || !Number.isFinite(prevEpochMs)
      || !Number.isFinite(currentEquity)
      || !Number.isFinite(currentEpochMs)
    ) {
      out.push(current);
      index += 1;
      continue;
    }

    const baseline = Math.max(Math.abs(prevEquity), 1);
    const excursionPct = Math.abs(currentEquity - prevEquity) / baseline;
    const gapFromPrevMs = currentEpochMs - prevEpochMs;
    if (excursionPct < config.minExcursionPct || gapFromPrevMs > config.maxStepGapMs) {
      out.push(current);
      index += 1;
      continue;
    }

    let runEnd = index;
    while (runEnd + 1 < list.length) {
      const candidate = list[runEnd + 1];
      const candidateEquity = Number(candidate?.equity);
      const candidateEpochMs = Number(candidate?.epochMs);
      const priorEpochMs = Number(list[runEnd]?.epochMs);
      if (
        !isRapidSpikeSource(candidate, config)
        || !Number.isFinite(candidateEquity)
        || !Number.isFinite(candidateEpochMs)
        || !Number.isFinite(priorEpochMs)
        || candidateEpochMs - priorEpochMs > config.maxStepGapMs
        || Math.abs(candidateEquity - prevEquity) / baseline < config.minExcursionPct
      ) {
        break;
      }
      runEnd += 1;
    }

    const next = list[runEnd + 1];
    const nextEquity = Number(next?.equity);
    const nextEpochMs = Number(next?.epochMs);
    const outlierEpochMs = Number(list[runEnd]?.epochMs);
    if (
      Number.isFinite(nextEquity)
      && Number.isFinite(nextEpochMs)
      && Number.isFinite(outlierEpochMs)
      && nextEpochMs - outlierEpochMs <= config.maxStepGapMs
      && Math.abs(nextEquity - prevEquity) / baseline <= config.maxReversionPct
    ) {
      index = runEnd + 1;
      continue;
    }

    out.push(current);
    index += 1;
  }

  return out;
}

function getRapidEquitySpikeConfig(account) {
  if (String(account?.broker || "").toLowerCase() === "etrade") {
    return {
      maxStepGapMs: 15000,
      maxReversionPct: 0.03,
      minExcursionPct: 0.2,
      sourceSuffix: "summary",
    };
  }
  return null;
}

function isRapidSpikeSource(row, config) {
  const suffix = String(config?.sourceSuffix || "").toLowerCase();
  const source = String(row?.source || "").toLowerCase();
  if (!suffix) {
    return false;
  }
  return source.endsWith(suffix);
}

async function buildBenchmarkForPerformance({
  adapters,
  accounts,
  symbol,
  from,
  to,
  baseEquity,
  limit,
}) {
  const safeAccounts = Array.isArray(accounts) ? accounts : [];
  if (!safeAccounts.length) {
    return null;
  }
  const fromMs = Number(from);
  const toMs = Number(to);
  const base = Number(baseEquity);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || !Number.isFinite(base) || base <= 0) {
    return null;
  }

  const account = safeAccounts.find((candidate) => {
    const adapter = adapters[candidate?.broker];
    return Boolean(adapter?.getBars);
  }) || safeAccounts[0];
  if (!account) {
    return null;
  }
  const adapter = adapters[account.broker];
  if (!adapter?.getBars) {
    return null;
  }

  try {
    const response = await adapter.getBars(account, {
      symbol: String(symbol || "SPY").trim().toUpperCase(),
      resolution: "D",
      from: Math.floor(fromMs / 1000),
      to: Math.floor(toMs / 1000),
      countBack: clampNumber(limit, 20, 5000, 800),
    });
    const series = buildBenchmarkSeriesFromBars(response?.bars || [], {
      baseEquity: base,
      limit: clampNumber(limit, 20, 50000, 5000),
    });
    if (!series.length) {
      return null;
    }
    return {
      symbol: String(symbol || "SPY").trim().toUpperCase(),
      source: response?.source || `${account.broker}-bars`,
      stale: response?.stale !== false,
      series,
    };
  } catch {
    return null;
  }
}

function mergeCredentialsWithEnvDefaults(broker, credentials = {}) {
  const keys = ENV_CREDENTIAL_KEYS_BY_BROKER[String(broker || "").toLowerCase()] || [];
  const merged = {
    ...(credentials && typeof credentials === "object" ? credentials : {}),
  };
  for (const key of keys) {
    if (hasCredentialValue(merged[key])) {
      continue;
    }
    const fromEnv = readEnvCredentialValue(key);
    if (!hasCredentialValue(fromEnv)) {
      continue;
    }
    merged[key] = String(fromEnv);
  }
  return merged;
}

async function syncPositionsForRequest(store, adapters, requestedAccountId) {
  const accounts = requestedAccountId && requestedAccountId !== "all"
    ? [store.getAccount(requestedAccountId)].filter(Boolean)
    : store.listAccounts();
  const SYNC_TIMEOUT_MS = 3500;
  const entries = await Promise.all(
    accounts.map(async (account) => {
      const resolvedAccount = withMergedEnvCredentials(account);
      const adapter = adapters[resolvedAccount.broker];
      const accountId = resolvedAccount.accountId;
      if (!adapter?.getPositions) {
        const availability = await updateAccountPositionsAvailability(store, resolvedAccount, {
          state: "unavailable",
          reason: "adapter_unavailable",
          message: "No broker position sync is available for this account.",
        });
        return [accountId, availability];
      }

      const authState = String(resolvedAccount.authState || "").toLowerCase();
      const isLiveMode = String(resolvedAccount.mode || "live").toLowerCase() === "live";
      if (isLiveMode && authState !== "authenticated") {
        const availability = await updateAccountPositionsAvailability(store, resolvedAccount, {
          state: "unavailable",
          reason: "auth_not_authenticated",
          message: "Broker auth is required before live positions can refresh.",
        });
        return [accountId, availability];
      }

      try {
        const remoteRows = await withTimeout(
          adapter.getPositions(resolvedAccount),
          SYNC_TIMEOUT_MS,
        );
        if (!Array.isArray(remoteRows)) {
          throw new Error("Broker positions response was not an array.");
        }

        const normalizedRows = remoteRows
          .map((row, index) => normalizePositionRow(resolvedAccount, row, index))
          .filter(Boolean);
        await store.setPositions(resolvedAccount.accountId, normalizedRows);
        const updatedAccount = await store.upsertAccount({
          accountId: resolvedAccount.accountId,
          broker: resolvedAccount.broker,
          lastSync: new Date().toISOString(),
          positionsSyncState: "live",
          positionsSyncReason: null,
          positionsSyncMessage: null,
          positionsSyncCheckedAt: new Date().toISOString(),
          positionsSyncFailureCount: 0,
          positionsSyncStaleSince: null,
          positionsSyncLastSuccessAt: new Date().toISOString(),
        });
        const summary = await withTimeout(
          adapter.getAccountSummary(resolvedAccount),
          SYNC_TIMEOUT_MS,
        ).catch(() => null);
        await captureAccountEquitySnapshot({
          store,
          adapter,
          account: resolvedAccount,
          summaryHint: summary,
        });
        return [
          accountId,
          buildPositionsAvailabilityForAccount(updatedAccount, normalizedRows.length),
        ];
      } catch {
        const availability = await updateAccountPositionsAvailability(store, resolvedAccount, {
          state: "stale_refreshing",
          reason: "sync_failed",
          message: "Showing the last saved positions while live broker sync retries.",
        });
        return [accountId, availability];
      }
    }),
  );
  return Object.fromEntries(entries.filter(Boolean));
}

async function updateAccountPositionsAvailability(store, account, options = {}) {
  const resolvedAccount = account && typeof account === "object"
    ? (store.getAccount(account.accountId) || account)
    : null;
  if (!resolvedAccount?.accountId) {
    return buildPositionsAvailabilityForAccount(account, 0);
  }

  const nowIso = new Date().toISOString();
  const existing = store.getAccount(resolvedAccount.accountId) || resolvedAccount;
  const existingRows = store.listPositions(resolvedAccount.accountId);
  const nextFailureCount = String(options.state || "") === "live"
    ? 0
    : Math.max(0, Number(existing.positionsSyncFailureCount || 0) + 1);
  const existingStaleSince = firstNonEmptyValue(existing.positionsSyncStaleSince, null);
  const nextStaleSince = String(options.state || "") === "stale_refreshing"
    ? (existingStaleSince || (existingRows.length ? nowIso : null))
    : null;
  const staleAgeMs = nextStaleSince ? Math.max(0, Date.now() - Date.parse(nextStaleSince)) : Number.POSITIVE_INFINITY;
  const withinStaleWindow = existingRows.length > 0
    && nextFailureCount < POSITIONS_STALE_MAX_FAILURES
    && staleAgeMs < POSITIONS_STALE_MAX_AGE_MS;
  const nextState = String(options.state || "") === "stale_refreshing" && !withinStaleWindow
    ? "unavailable"
    : String(options.state || "unavailable");
  const nextMessage = nextState === "stale_refreshing"
    ? "Showing the last saved positions while live broker sync retries."
    : (options.message || "Live positions are temporarily unavailable.");

  const updated = await store.upsertAccount({
    accountId: resolvedAccount.accountId,
    broker: resolvedAccount.broker,
    positionsSyncState: nextState,
    positionsSyncReason: options.reason || null,
    positionsSyncMessage: nextMessage,
    positionsSyncCheckedAt: nowIso,
    positionsSyncFailureCount: nextState === "live" ? 0 : nextFailureCount,
    positionsSyncStaleSince: nextState === "stale_refreshing" ? nextStaleSince : null,
    positionsSyncLastSuccessAt: nextState === "live"
      ? nowIso
      : firstNonEmptyValue(existing.positionsSyncLastSuccessAt, existing.lastSync, null),
  });
  return buildPositionsAvailabilityForAccount(updated, existingRows.length);
}

function buildPositionsPayload(store, requestedAccountId, syncStatusByAccount = {}) {
  const safeRequestedAccountId = String(requestedAccountId || "all");
  const accounts = safeRequestedAccountId !== "all"
    ? [store.getAccount(safeRequestedAccountId)].filter(Boolean)
    : store.listAccounts();
  const positionAccounts = accounts.filter((account) => String(account?.broker || "").trim().toLowerCase() !== "data");
  const byAccount = {};
  const positions = [];
  let liveCount = 0;
  let staleCount = 0;
  let unavailableCount = 0;

  for (const account of positionAccounts) {
    const accountId = String(account?.accountId || "");
    if (!accountId) {
      continue;
    }
    const availability = syncStatusByAccount?.[accountId]
      || buildPositionsAvailabilityForAccount(account, store.listPositions(accountId).length);
    byAccount[accountId] = availability;
    if (availability.state === "live") {
      liveCount += 1;
    } else if (availability.state === "stale_refreshing") {
      staleCount += 1;
    } else {
      unavailableCount += 1;
    }

    if (availability.state !== "unavailable") {
      positions.push(...store.listPositions(accountId));
    }
  }

  let overallState = "live";
  let message = null;
  if (unavailableCount === positionAccounts.length) {
    overallState = "unavailable";
    message = "Live broker positions are unavailable for the selected accounts.";
  } else if (staleCount > 0 && unavailableCount === 0) {
    overallState = "stale_refreshing";
    message = "Showing saved positions while broker sync retries.";
  } else if (staleCount > 0 || unavailableCount > 0) {
    overallState = "degraded";
    message = "Some accounts could not refresh live positions and are showing stale or unavailable data.";
  }

  if (safeRequestedAccountId !== "all" && positionAccounts[0]) {
    return {
      accountId: safeRequestedAccountId,
      positions,
      availability: byAccount[safeRequestedAccountId] || {
        state: overallState,
        liveDataReady: overallState === "live",
        message,
      },
    };
  }

  return {
    accountId: safeRequestedAccountId,
    positions,
    availability: {
      state: overallState,
      liveDataReady: overallState === "live",
      message,
      liveAccounts: liveCount,
      staleAccounts: staleCount,
      unavailableAccounts: unavailableCount,
      byAccount,
    },
  };
}

function buildPositionsAvailabilityForAccount(account, positionCount = 0) {
  const authState = String(account?.authState || "").toLowerCase();
  const isLiveMode = String(account?.mode || "live").toLowerCase() === "live";
  if (isLiveMode && authState !== "authenticated") {
    return {
      accountId: account?.accountId || null,
      state: "unavailable",
      liveDataReady: false,
      reason: "auth_not_authenticated",
      message: "Broker auth is required before live positions can refresh.",
      positionsCount: 0,
    };
  }

  const failureCount = Math.max(0, Number(account?.positionsSyncFailureCount || 0));
  const staleSince = firstNonEmptyValue(account?.positionsSyncStaleSince, null);
  const staleAgeMs = staleSince ? Math.max(0, Date.now() - Date.parse(staleSince)) : Number.POSITIVE_INFINITY;
  const withinStaleWindow = Number(positionCount || 0) > 0
    && failureCount < POSITIONS_STALE_MAX_FAILURES
    && staleAgeMs < POSITIONS_STALE_MAX_AGE_MS;
  const rawState = String(account?.positionsSyncState || "").toLowerCase();
  const state = rawState === "stale_refreshing" && !withinStaleWindow
    ? "unavailable"
    : (rawState || "live");
  const message = state === "stale_refreshing"
    ? firstNonEmptyValue(account?.positionsSyncMessage, "Showing the last saved positions while live broker sync retries.")
    : state === "unavailable"
      ? firstNonEmptyValue(account?.positionsSyncMessage, "Live positions are temporarily unavailable.")
      : null;

  return {
    accountId: account?.accountId || null,
    state,
    liveDataReady: state === "live",
    reason: firstNonEmptyValue(account?.positionsSyncReason, null),
    message,
    positionsCount: state === "unavailable" ? 0 : Math.max(0, Number(positionCount || 0)),
    staleSince: state === "stale_refreshing" ? staleSince : null,
    failedRefreshes: state === "live" ? 0 : failureCount,
  };
}

function getAccountHistoryMaintenanceIssue(req) {
  const configuredToken = String(process.env.ACCOUNT_HISTORY_MAINTENANCE_TOKEN || "").trim();
  if (!configuredToken) {
    return {
      statusCode: 503,
      code: "ACCOUNT_HISTORY_MAINTENANCE_TOKEN_UNAVAILABLE",
      message: "Account history maintenance token is not configured.",
    };
  }
  const providedToken = String(req.headers[ACCOUNT_HISTORY_MAINTENANCE_HEADER] || "").trim();
  if (!providedToken || providedToken !== configuredToken) {
    return {
      statusCode: 403,
      code: "ACCOUNT_HISTORY_MAINTENANCE_FORBIDDEN",
      message: "Invalid account history maintenance token.",
    };
  }
  return null;
}

function normalizePositionRow(account, row, index) {
  if (!row || typeof row !== "object") {
    return null;
  }
  const rawPositionId = String(row.positionId || row.id || "");
  if (rawPositionId.includes("-seed-") || rawPositionId.startsWith("seed-")) {
    return null;
  }

  const assetType = normalizeAssetType(row);
  const quantityRaw = firstFiniteNumber(
    row.qty,
    row.quantity,
    row.position,
    row.positionQty,
    row.positionQuantity,
    row.netQuantity,
  );
  const sideHint = String(row.side || "").toLowerCase();
  const side = sideHint === "short" || sideHint === "long"
    ? sideHint
    : Number(quantityRaw || 0) < 0
      ? "short"
      : "long";
  const qty = Math.abs(Number(quantityRaw || 0));
  if (!Number.isFinite(qty) || qty <= 0) {
    return null;
  }

  const option = normalizeOptionPayload(row);
  const symbol = String(
    row.symbol
      || row.ticker
      || row.underlying
      || row.underlyingSymbol
      || option?.symbol
      || "",
  ).trim().toUpperCase();
  if (!symbol) {
    return null;
  }

  const multiplier = assetType === "option" ? 100 : 1;
  const avgFallbackFromCostBasis = firstFiniteNumber(row.costBasis, row.costBasisMoney);
  const averagePrice = firstFiniteNumber(
    row.averagePrice,
    row.avgPrice,
    row.avgCost,
    row.costPerShare,
    Number.isFinite(avgFallbackFromCostBasis)
      ? avgFallbackFromCostBasis / Math.max(qty * multiplier, 1)
      : null,
    0,
  );
  const markPrice = firstFiniteNumber(
    row.markPrice,
    row.marketPrice,
    row.currentPrice,
    row.lastPrice,
    row.lastTrade,
    averagePrice,
    0,
  );
  const marketValue = firstFiniteNumber(
    row.marketValue,
    row.marketValueBase,
    markPrice * qty * multiplier,
    0,
  );

  const pnlFromSpread = (markPrice - averagePrice) * qty * multiplier;
  const unrealizedPnl = firstFiniteNumber(
    row.unrealizedPnl,
    row.unrealizedPnL,
    row.unrealized,
    row.totalGain,
    side === "short" ? -pnlFromSpread : pnlFromSpread,
    0,
  );

  const positionId = String(
    row.positionId
      || row.id
      || row.contractId
      || row.conid
      || row.conId
      || `${account.accountId}-${symbol}-${assetType}-${index}`,
  );

  return {
    positionId,
    accountId: account.accountId,
    symbol,
    underlyingSymbol: option?.symbol || symbol,
    assetType,
    side,
    qty: roundTo6(qty),
    averagePrice: round2(averagePrice),
    markPrice: round2(markPrice),
    marketValue: round2(marketValue),
    unrealizedPnl: round2(unrealizedPnl),
    currency: String(row.currency || "USD").toUpperCase(),
    option: option ? {
      symbol: option.symbol,
      expiry: option.expiry,
      strike: round2(option.strike),
      right: option.right,
    } : null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeAssetType(row) {
  const raw = String(
    row.assetType
      || row.securityType
      || row.secType
      || row.assetClass
      || "",
  ).toLowerCase();
  if (raw.includes("opt") || raw.includes("option")) {
    return "option";
  }
  if (row.option || row.expiry || row.strike || row.right) {
    return "option";
  }
  return "equity";
}

function normalizeOptionPayload(row) {
  const source = row.option && typeof row.option === "object" ? row.option : row;
  const expiryRaw = firstNonEmptyValue(
    source.expiry,
    source.expirationDate,
    source.expiration,
    source.expiryDate,
  );
  const expiry = normalizeIsoDate(expiryRaw);
  const strike = firstFiniteNumber(
    source.strike,
    source.strikePrice,
  );
  const rightRaw = String(
    source.right
      || source.callPut
      || source.putCall
      || source.optionType
      || "",
  ).toLowerCase();
  const right = rightRaw.startsWith("c")
    ? "call"
    : rightRaw.startsWith("p")
      ? "put"
      : null;
  const symbol = firstNonEmptyValue(
    source.symbol,
    source.underlying,
    source.underlyingSymbol,
  );

  if (!expiry || !Number.isFinite(strike) || !right) {
    return null;
  }

  return {
    symbol: symbol ? String(symbol).toUpperCase() : null,
    expiry,
    strike: Number(strike),
    right,
  };
}

function normalizeIsoDate(value) {
  if (!value) {
    return null;
  }
  const text = String(value).trim();
  if (text.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return text;
  }
  if (text.match(/^\d{8}$/)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  const timestamp = Number(text);
  if (Number.isFinite(timestamp)) {
    const ms = timestamp > 100000000000 ? timestamp : timestamp * 1000;
    const parsed = new Date(ms);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function roundTo6(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function readEnvCredentialValue(canonicalKey) {
  return resolveEnvCredentialSource(canonicalKey).value;
}

function resolveEnvCredentialSource(canonicalKey) {
  hydrateRuntimeEnvFromSnapshot();
  const candidates = ENV_CREDENTIAL_ALIASES[canonicalKey] || [canonicalKey];
  for (const name of candidates) {
    const value = process.env[name];
    if (hasCredentialValue(value)) {
      return {
        value: String(value),
        source: name,
      };
    }
  }

  const normalizedCandidates = candidates
    .map((name) => normalizeEnvKeyName(name))
    .filter(Boolean);

  if (!normalizedCandidates.length) {
    return { value: null, source: null };
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (!hasCredentialValue(value)) {
      continue;
    }
    const normalizedName = normalizeEnvKeyName(name);
    if (!normalizedName) {
      continue;
    }
    const matched = normalizedCandidates.some(
      (candidate) =>
        normalizedName === candidate
        || normalizedName.endsWith(`_${candidate}`),
    );
    if (matched) {
      return {
        value: String(value),
        source: name,
      };
    }
  }

  return { value: null, source: null };
}

function normalizeEnvKeyName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function hasCredentialValue(value) {
  if (value == null) {
    return false;
  }
  const text = String(value).trim();
  if (!text) {
    return false;
  }
  if (isMaskedCredentialPlaceholder(text)) {
    return false;
  }
  return true;
}

function isMaskedCredentialPlaceholder(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }
  if (/^(masked|redacted|hidden)$/i.test(text)) {
    return true;
  }
  return /^[*•xX#\-_.]{4,}$/.test(text);
}

function redactCredentialValue(value) {
  return hasCredentialValue(value) ? "redacted" : "";
}

function redactCredentialMap(credentials = {}) {
  if (!credentials || typeof credentials !== "object") {
    return {};
  }
  const out = {};
  for (const key of Object.keys(credentials)) {
    out[key] = redactCredentialValue(credentials[key]);
  }
  return out;
}

function redactCredentialsByBroker(credentialsByBroker = {}) {
  if (!credentialsByBroker || typeof credentialsByBroker !== "object") {
    return {};
  }
  const out = {};
  for (const [broker, credentials] of Object.entries(credentialsByBroker)) {
    out[broker] = redactCredentialMap(credentials);
  }
  return out;
}

function sanitizeAccountForClient(account) {
  if (!account || typeof account !== "object") {
    return account || null;
  }
  const lanes = deriveAccountOperationalLanes(account);
  const connectionState = deriveClientConnectionState(account, lanes);
  return {
    ...account,
    liveReady: Boolean(lanes.trading.ready),
    tradingReady: Boolean(lanes.trading.ready),
    tradingState: lanes.trading.state,
    tradingLabel: lanes.trading.label,
    marketDataReady: Boolean(lanes.marketData.ready),
    marketDataState: lanes.marketData.state,
    marketDataLabel: lanes.marketData.label,
    connectionState,
    connectionLabel: formatAccountConnectionLabel(connectionState),
    marketDataMessage: firstNonEmptyValue(
      account?.credentials?.WEBULL_MARKET_DATA_MESSAGE,
      null,
    ),
    credentials: redactCredentialMap(account.credentials || {}),
  };
}

function sanitizeAccountsForClient(accounts) {
  return (Array.isArray(accounts) ? accounts : []).map((account) => sanitizeAccountForClient(account));
}

function commissionForBroker(broker) {
  if (broker === "webull") return 0;
  if (broker === "ibkr") return 0.25;
  return 0.65;
}

function getLiveExecutionGuardResponse({ account, adapter, orderLike }) {
  const executionMode = String(orderLike?.executionMode || "paper").toLowerCase();
  if (executionMode !== "live") {
    return null;
  }
  if (!adapter) {
    return {
      status: 400,
      body: {
        error: "Adapter not available for account",
      },
    };
  }

  if (adapter.supportsNativeLiveExecution?.(account, orderLike)) {
    return null;
  }

  const brokerLabel = formatBrokerLabel(account?.broker || adapter?.brokerId || "broker");
  return {
    status: 409,
    body: {
      error: `${brokerLabel} live execution is not broker-routed yet`,
      hint: "Use paper mode for this broker, or switch live execution to an IBKR account.",
      broker: account?.broker || adapter?.brokerId || null,
      accountId: account?.accountId || null,
      capabilities: adapter.getCapabilities?.(account) || null,
    },
  };
}

function formatBrokerLabel(broker) {
  const normalized = String(broker || "").trim().toLowerCase();
  if (normalized === "etrade") return "E*Trade";
  if (normalized === "webull") return "Webull";
  if (normalized === "ibkr") return "IBKR";
  return normalized ? normalized.toUpperCase() : "Selected broker";
}

function resolveMarketAccount(store, requestedAccountId) {
  const accounts = store.listAccounts().map(withMergedEnvCredentials);
  if (!accounts.length) {
    return null;
  }

  if (requestedAccountId && requestedAccountId !== "all") {
    const requested = accounts.find((account) => account?.accountId === requestedAccountId) || null;
    if (!requested) {
      return null;
    }
    if (deriveAccountOperationalLanes(requested).marketData.ready) {
      return requested;
    }
    const fallback = pickPreferredMarketAccount(accounts, {
      requireReady: true,
      excludeAccountId: requested.accountId,
    });
    return fallback || requested;
  }

  const marketReady = pickPreferredMarketAccount(accounts, {
    requireReady: true,
  });
  if (marketReady) {
    return marketReady;
  }

  const tradingReady = pickPreferredMarketAccount(accounts, {
    requireTradingReady: true,
  });
  if (tradingReady) {
    return tradingReady;
  }

  const connected = pickPreferredMarketAccount(accounts, {
    requireConnected: true,
  });
  return connected || accounts[0];
}

function pickPreferredMarketAccount(accounts, options = {}) {
  const list = (Array.isArray(accounts) ? accounts : [])
    .filter(Boolean)
    .filter((account) => {
      if (!options.excludeAccountId) {
        return true;
      }
      return String(account?.accountId || "") !== String(options.excludeAccountId);
    });
  if (!list.length) {
    return null;
  }

  const preferredBrokers = ["etrade", "ibkr", "webull"];
  const filtered = list.filter((account) => {
    const lanes = deriveAccountOperationalLanes(account);
    if (options.requireReady) {
      return Boolean(lanes.marketData.ready);
    }
    if (options.requireTradingReady) {
      return Boolean(lanes.trading.ready);
    }
    if (options.requireConnected) {
      return String(account?.status || "").trim().toLowerCase() === "connected";
    }
    return true;
  });
  const pool = filtered.length ? filtered : list;
  const ranked = [...pool].sort((left, right) => {
    const leftIndex = preferredBrokers.indexOf(String(left?.broker || "").trim().toLowerCase());
    const rightIndex = preferredBrokers.indexOf(String(right?.broker || "").trim().toLowerCase());
    const safeLeftIndex = leftIndex === -1 ? preferredBrokers.length : leftIndex;
    const safeRightIndex = rightIndex === -1 ? preferredBrokers.length : rightIndex;
    if (safeLeftIndex !== safeRightIndex) {
      return safeLeftIndex - safeRightIndex;
    }
    return String(left?.accountId || "").localeCompare(String(right?.accountId || ""));
  });
  return ranked[0] || null;
}

function deriveAccountConnectionState(account) {
  const status = String(account?.status || "").trim().toLowerCase();
  const authState = String(account?.authState || "").trim().toLowerCase();

  if (status === "connecting") {
    return "connecting";
  }
  if (isAuthenticatedLiveAccount(account)) {
    return "live";
  }
  if (authState === "needs_refresh" || authState === "needs_token" || authState === "needs_login") {
    return authState;
  }
  if (authState === "configured") {
    return "configured";
  }
  if (authState === "missing_credentials" || authState === "degraded" || authState === "error") {
    return authState;
  }
  if (status === "error") {
    return "error";
  }
  if (status === "connected") {
    return "configured";
  }
  if (status === "disconnected") {
    return "disconnected";
  }
  return authState || status || "disconnected";
}

function deriveAccountOperationalLanes(account) {
  const broker = String(account?.broker || "").trim().toLowerCase();
  if (broker === "webull") {
    return deriveWebullOperationalLanes(account);
  }
  return deriveDefaultOperationalLanes(account);
}

function deriveDefaultOperationalLanes(account) {
  const state = deriveAccountConnectionState(account);
  const label = formatAccountConnectionLabel(state);
  const ready = isAuthenticatedLiveAccount(account);
  return {
    trading: {
      ready,
      state: ready ? "live" : state,
      label: ready ? "Live" : label,
    },
    marketData: {
      ready,
      state: ready ? "live" : state,
      label: ready ? "Live" : label,
    },
  };
}

function deriveWebullOperationalLanes(account) {
  const credentials = account?.credentials || {};
  const authState = String(account?.authState || "").trim().toLowerCase();
  const liveMode = isLiveModeAccount(account);
  const oauthFlow = hasCredentialValue(credentials.WEBULL_CLIENT_ID)
    && hasCredentialValue(credentials.WEBULL_CLIENT_SECRET);
  const hasOAuthAccessToken = hasCredentialValue(credentials.WEBULL_OAUTH_ACCESS_TOKEN);
  const hasOAuthRefreshToken = hasCredentialValue(credentials.WEBULL_OAUTH_REFRESH_TOKEN);
  const appFlow = hasCredentialValue(credentials.WEBULL_APP_KEY)
    && hasCredentialValue(credentials.WEBULL_APP_SECRET);
  const loginFlow = hasCredentialValue(credentials.WEBULL_EMAIL)
    && hasCredentialValue(credentials.WEBULL_PASSWORD);
  const tokenStatus = normalizeWebullCredentialTokenStatus(firstNonEmptyValue(
    credentials.WEBULL_TOKEN_STATUS,
    credentials.WEBULL_TOKEN_STATE,
  ));
  const marketDataStatus = String(credentials.WEBULL_MARKET_DATA_STATUS || "").trim().toLowerCase();
  const hasToken = hasCredentialValue(credentials.WEBULL_ACCESS_TOKEN);
  const hasAccountId = hasCredentialValue(firstNonEmptyValue(
    credentials.WEBULL_ACCOUNT_ID,
    credentials.WEBULL_ACCOUNT,
    credentials.WEBULL_ACCOUNT_NO,
  ));

  let tradingState = deriveAccountConnectionState(account);
  if (!oauthFlow) {
    tradingState = "missing_credentials";
  } else if (liveMode && authState === "authenticated") {
    tradingState = "live";
  } else if (oauthFlow && !hasOAuthAccessToken && !hasOAuthRefreshToken) {
    tradingState = "needs_login";
  } else if (oauthFlow && (authState === "needs_login" || authState === "needs_token")) {
    tradingState = "needs_login";
  } else if (oauthFlow && authState === "degraded") {
    tradingState = "degraded";
  } else if (oauthFlow || authState === "configured") {
    tradingState = "configured";
  }

  let marketDataState = tradingState;
  if (!appFlow && !loginFlow) {
    marketDataState = "missing_credentials";
  } else if (marketDataStatus === "subscription_required") {
    marketDataState = "subscription_required";
  } else if (liveMode && marketDataStatus === "live") {
    marketDataState = "live";
  } else if (liveMode && appFlow && (tokenStatus === "NORMAL" || (hasToken && !tokenStatus))) {
    marketDataState = "live";
  } else if (appFlow && (
    authState === "needs_token"
    || tokenStatus === "PENDING"
    || tokenStatus === "INVALID"
    || tokenStatus === "EXPIRED"
    || !hasToken
  )) {
    marketDataState = "needs_token";
  } else if (loginFlow && !appFlow) {
    marketDataState = "configured";
  }

  return {
    trading: {
      ready: tradingState === "live",
      state: tradingState,
      label: formatOperationalLaneLabel(tradingState),
    },
    marketData: {
      ready: marketDataState === "live",
      state: marketDataState,
      label: formatOperationalLaneLabel(marketDataState),
    },
  };
}

function deriveClientConnectionState(account, lanes = null) {
  const broker = String(account?.broker || "").trim().toLowerCase();
  if (broker !== "webull") {
    return deriveAccountConnectionState(account);
  }

  const effectiveLanes = lanes || deriveAccountOperationalLanes(account);
  const tradingState = String(effectiveLanes?.trading?.state || "").trim().toLowerCase();
  const marketDataState = String(effectiveLanes?.marketData?.state || "").trim().toLowerCase();
  const tradingReady = Boolean(effectiveLanes?.trading?.ready);
  const marketDataReady = Boolean(effectiveLanes?.marketData?.ready);

  if (tradingReady && marketDataReady) {
    return "live";
  }
  if (tradingReady || marketDataReady) {
    return "configured";
  }
  if (tradingState === "needs_login") {
    return "needs_login";
  }
  if (marketDataState === "subscription_required") {
    return "subscription_required";
  }
  if (marketDataState === "needs_token") {
    return "needs_token";
  }
  if (tradingState === "missing_credentials" && marketDataState === "missing_credentials") {
    return "missing_credentials";
  }
  if (tradingState === "configured" || marketDataState === "configured") {
    return "configured";
  }
  if (tradingState === "degraded" || marketDataState === "degraded") {
    return "degraded";
  }
  return deriveAccountConnectionState(account);
}

function formatAccountConnectionLabel(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "live") return "Live";
  if (normalized === "configured") return "Configured";
  if (normalized === "needs_refresh") return "Refresh Required";
  if (normalized === "needs_token") return "Needs Token";
  if (normalized === "subscription_required") return "Needs Subscription";
  if (normalized === "needs_login") return "Needs Login";
  if (normalized === "missing_credentials") return "Missing Creds";
  if (normalized === "degraded") return "Degraded";
  if (normalized === "error") return "Error";
  if (normalized === "connecting") return "Connecting";
  return "Disconnected";
}

function formatOperationalLaneLabel(state) {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "live") return "Live";
  return formatAccountConnectionLabel(normalized);
}

function normalizeWebullCredentialTokenStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "NORMAL" || normalized === "PENDING" || normalized === "INVALID" || normalized === "EXPIRED") {
    return normalized;
  }
  return "";
}

function describeWebullConnectOAuthStatus({ account, auth }) {
  const credentials = account?.credentials || {};
  const hasClientId = hasCredentialValue(credentials.WEBULL_CLIENT_ID);
  const hasClientSecret = hasCredentialValue(credentials.WEBULL_CLIENT_SECRET);
  const hasAccessToken = hasCredentialValue(credentials.WEBULL_OAUTH_ACCESS_TOKEN);
  const hasRefreshToken = hasCredentialValue(credentials.WEBULL_OAUTH_REFRESH_TOKEN);
  const lanes = deriveAccountOperationalLanes(account);
  const tradingState = String(lanes?.trading?.state || "").trim().toLowerCase() || "missing_credentials";
  const tradingLabel = lanes?.trading?.label || formatOperationalLaneLabel(tradingState);

  if (!hasClientId || !hasClientSecret) {
    return {
      tradingState,
      tradingLabel,
      statusMessage: "Configure Webull Connect client credentials to link brokerage trading access.",
    };
  }
  if (!hasAccessToken && !hasRefreshToken) {
    return {
      tradingState,
      tradingLabel,
      statusMessage: "Webull Connect OAuth login required for brokerage access.",
    };
  }

  return {
    tradingState,
    tradingLabel,
    statusMessage: auth?.message || "Webull Connect session present. Refresh or re-run OAuth if brokerage access is still unavailable.",
  };
}

function resolveEtradeOAuthCallbackUrl({
  req,
  credentials,
  forceOutOfBand = false,
}) {
  const explicit = firstNonEmptyValue(credentials?.ETRADE_AUTH_CALLBACK_URL);
  if (hasCredentialValue(explicit)) {
    return String(explicit).trim();
  }
  if (forceOutOfBand) {
    return "oob";
  }
  return `${getRequestOrigin(req)}/api/integrations/etrade/callback`;
}

function classifyEtradeOAuthCallbackUrl(callbackUrl) {
  const normalized = String(callbackUrl || "").trim().toLowerCase();
  if (!normalized || normalized === "oob" || normalized === "urn:ietf:wg:oauth:1.0:oob") {
    return "oob";
  }
  return "redirect";
}

function isLikelyFreshEtradeRequestToken(createdAt, ttlMs = 6 * 60 * 1000) {
  if (!hasCredentialValue(createdAt)) {
    return false;
  }
  const timestamp = Date.parse(String(createdAt));
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return (Date.now() - timestamp) <= ttlMs;
}

async function requestEtradeRequestTokenWithFallback({
  req,
  credentials,
  consumer,
  requestedCallbackUrl,
}) {
  const explicitCallbackUrl = firstNonEmptyValue(
    requestedCallbackUrl,
    credentials?.ETRADE_AUTH_CALLBACK_URL,
  );
  const preferredCallbackUrl = hasCredentialValue(explicitCallbackUrl)
    ? String(explicitCallbackUrl).trim()
    : resolveEtradeOAuthCallbackUrl({ req, credentials });

  try {
    const token = await requestEtradeRequestToken({
      consumerKey: consumer.consumerKey,
      consumerSecret: consumer.consumerSecret,
      useSandbox: consumer.useSandbox,
      callbackUrl: preferredCallbackUrl,
    });
    return {
      token,
      callbackUrl: preferredCallbackUrl,
      callbackMode: classifyEtradeOAuthCallbackUrl(preferredCallbackUrl),
      fallbackUsed: false,
      fallbackReason: null,
    };
  } catch (error) {
    if (hasCredentialValue(explicitCallbackUrl) || classifyEtradeOAuthCallbackUrl(preferredCallbackUrl) === "oob") {
      throw error;
    }

    const fallbackCallbackUrl = "oob";
    const token = await requestEtradeRequestToken({
      consumerKey: consumer.consumerKey,
      consumerSecret: consumer.consumerSecret,
      useSandbox: consumer.useSandbox,
      callbackUrl: fallbackCallbackUrl,
    });
    return {
      token,
      callbackUrl: fallbackCallbackUrl,
      callbackMode: "oob",
      fallbackUsed: true,
      fallbackReason: firstNonEmptyValue(error?.message, "Redirect callback unavailable; falling back to verifier mode."),
    };
  }
}

function resolveWebullOAuthRedirectUri({
  req,
  accountId,
  credentials,
}) {
  const explicit = firstNonEmptyValue(
    credentials?.WEBULL_OAUTH_REDIRECT_URI,
    credentials?.WEBULL_REDIRECT_URI,
  );
  if (hasCredentialValue(explicit)) {
    return String(explicit).trim();
  }
  const origin = getRequestOrigin(req);
  return `${origin}/api/accounts/${encodeURIComponent(String(accountId || "").trim())}/webull/oauth/callback`;
}

function getRequestOrigin(req) {
  const forwardedProto = firstNonEmptyValue(
    req?.headers?.["x-forwarded-proto"],
    req?.headers?.["x-forwarded-protocol"],
  );
  const proto = String(forwardedProto || (req?.socket?.encrypted ? "https" : "http"))
    .split(",")[0]
    .trim()
    .toLowerCase() || "http";
  const host = String(
    firstNonEmptyValue(
      req?.headers?.["x-forwarded-host"],
      req?.headers?.host,
      "127.0.0.1:5000",
    ),
  ).split(",")[0].trim();
  return `${proto}://${host}`;
}

function isLikelyEtradeUnauthorizedMessage(message) {
  const lower = String(message || "").toLowerCase();
  return lower.includes("http status 401")
    || lower.includes("unauthorized")
    || lower.includes("oauth_problem=token_rejected");
}

async function resolveAccountAuthStatus(store, adapter, account, options = {}) {
  const checkedAt = new Date().toISOString();
  const resolvedAccount = withMergedEnvCredentials(account);

  try {
    const raw = options.refresh
      ? await adapter.refreshAuthSession(resolvedAccount)
      : await adapter.getAuthStatus(resolvedAccount);
    const auth = normalizeAuthStatus(raw, adapter.brokerId, checkedAt);
    const updatedAccount = await store.upsertAccount({
      accountId: account.accountId,
      broker: account.broker,
      authState: auth.state,
      authMessage: auth.message,
      authCheckedAt: auth.checkedAt,
    });
    return { account: updatedAccount, auth };
  } catch (error) {
    const auth = normalizeAuthStatus({
      broker: adapter.brokerId,
      state: "degraded",
      live: false,
      message: error?.message || "Auth status check failed",
      checkedAt,
    }, adapter.brokerId, checkedAt);

    const updatedAccount = await store.upsertAccount({
      accountId: account.accountId,
      broker: account.broker,
      authState: auth.state,
      authMessage: auth.message,
      authCheckedAt: auth.checkedAt,
    });
    return { account: updatedAccount, auth };
  }
}

function withMergedEnvCredentials(account) {
  if (!account || typeof account !== "object") {
    return account || null;
  }
  return {
    ...account,
    credentials: mergeCredentialsWithEnvDefaults(
      account.broker,
      account.credentials || {},
    ),
  };
}

function normalizeConnectCredentialsForBroker({
  broker,
  currentCredentials,
  incomingCredentials,
  payloadCredentials,
}) {
  const normalizedBroker = String(broker || "").trim().toLowerCase();
  const next = {
    ...(incomingCredentials && typeof incomingCredentials === "object" ? incomingCredentials : {}),
  };
  if (normalizedBroker !== "webull") {
    return next;
  }

  const current = currentCredentials && typeof currentCredentials === "object"
    ? currentCredentials
    : {};
  const payload = payloadCredentials && typeof payloadCredentials === "object"
    ? payloadCredentials
    : {};
  const nextAppKey = String(next.WEBULL_APP_KEY || "").trim();
  const nextAppSecret = String(next.WEBULL_APP_SECRET || "").trim();
  const currentAppKey = String(current.WEBULL_APP_KEY || "").trim();
  const currentAppSecret = String(current.WEBULL_APP_SECRET || "").trim();
  const nextClientId = String(next.WEBULL_CLIENT_ID || "").trim();
  const nextClientSecret = String(next.WEBULL_CLIENT_SECRET || "").trim();
  const currentClientId = String(current.WEBULL_CLIENT_ID || "").trim();
  const currentClientSecret = String(current.WEBULL_CLIENT_SECRET || "").trim();
  const appCredentialsChanged = (
    hasCredentialValue(nextAppKey)
    || hasCredentialValue(nextAppSecret)
  ) && (
    nextAppKey !== currentAppKey
    || nextAppSecret !== currentAppSecret
  );
  const oauthCredentialsChanged = (
    hasCredentialValue(nextClientId)
    || hasCredentialValue(nextClientSecret)
  ) && (
    nextClientId !== currentClientId
    || nextClientSecret !== currentClientSecret
  );
  const payloadIncludesToken = (
    Object.prototype.hasOwnProperty.call(payload, "WEBULL_ACCESS_TOKEN")
    && hasCredentialValue(payload.WEBULL_ACCESS_TOKEN)
  );
  const tokenStatus = String(
    firstNonEmptyValue(
      current.WEBULL_TOKEN_STATUS,
      current.WEBULL_TOKEN_STATE,
      "",
    ),
  ).trim().toUpperCase();
  const hasStalePersistedToken = hasCredentialValue(current.WEBULL_ACCESS_TOKEN)
    && (tokenStatus === "EXPIRED" || tokenStatus === "INVALID");
  if (!payloadIncludesToken && (appCredentialsChanged || hasStalePersistedToken)) {
    next.WEBULL_ACCESS_TOKEN = "";
    next.WEBULL_TOKEN_STATUS = "";
    next.WEBULL_TOKEN_EXPIRES = "";
    next.WEBULL_ACCOUNT_ID = "";
    next.WEBULL_MARKET_DATA_STATUS = "";
    next.WEBULL_MARKET_DATA_MESSAGE = "";
    next.WEBULL_MARKET_DATA_CHECKED_AT = "";
  }
  if (oauthCredentialsChanged) {
    next.WEBULL_OAUTH_ACCESS_TOKEN = "";
    next.WEBULL_OAUTH_REFRESH_TOKEN = "";
    next.WEBULL_OAUTH_ACCESS_EXPIRES_AT = "";
    next.WEBULL_OAUTH_REFRESH_EXPIRES_AT = "";
    next.WEBULL_OAUTH_STATE = "";
    next.WEBULL_OAUTH_STATE_CREATED_AT = "";
    next.WEBULL_ACCOUNT_ID = "";
  }
  return next;
}

function isLiveModeAccount(account) {
  return String(account?.mode || "live").toLowerCase() === "live";
}

function isAuthenticatedLiveAccount(account) {
  return isLiveModeAccount(account)
    && String(account?.authState || "").toLowerCase() === "authenticated";
}

function isAuthenticatedLiveTradingAccount(account) {
  return isLiveModeAccount(account)
    && Boolean(deriveAccountOperationalLanes(account)?.trading?.ready);
}

function isAuthenticatedLiveMarketDataAccount(account) {
  return isLiveModeAccount(account)
    && Boolean(deriveAccountOperationalLanes(account)?.marketData?.ready);
}

function hasBlockedLiveSourceMarker(source) {
  const normalized = String(source || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return STRICT_LIVE_BLOCKED_SOURCE_MARKERS.some((marker) => normalized.includes(marker));
}

function isTrustedLiveSummarySource(account, source) {
  const normalized = String(source || "").trim().toLowerCase();
  const broker = String(account?.broker || "").trim().toLowerCase();
  if (!broker || hasBlockedLiveSourceMarker(normalized)) {
    return false;
  }
  return normalized.startsWith(`${broker}-live`) || normalized.startsWith(`${broker}-stream`);
}

function isTrustedLiveHistorySource(account, source) {
  const normalized = String(source || "").trim().toLowerCase();
  const broker = String(account?.broker || "").trim().toLowerCase();
  if (!broker || hasBlockedLiveSourceMarker(normalized)) {
    return false;
  }
  if (normalized.startsWith(`${broker}-live`) || normalized.startsWith(`${broker}-stream`)) {
    return true;
  }
  if (broker === "etrade" && normalized.startsWith("etrade-transactions")) {
    return true;
  }
  if (
    broker === "webull"
    && (
      normalized.startsWith("webull-balance-history")
      || normalized.startsWith("webull-order-history")
      || normalized.startsWith("webull-realized-history")
      || normalized.startsWith("webull-cashflow-history")
    )
  ) {
    return true;
  }
  return false;
}

function getStrictLiveSummaryIssue(account, summary) {
  if (!isLiveModeAccount(account)) {
    return null;
  }
  const accountId = String(account?.accountId || "");
  const authState = String(account?.authState || "").toLowerCase();
  if (!isAuthenticatedLiveTradingAccount(account)) {
    return {
      accountId,
      reason: "auth_not_authenticated",
      authState,
    };
  }
  if (!summary || typeof summary !== "object") {
    return {
      accountId,
      reason: "summary_missing",
    };
  }
  const source = String(summary.source || "").trim().toLowerCase();
  if (!isTrustedLiveSummarySource(account, source)) {
    return {
      accountId,
      reason: "summary_untrusted_source",
      source: source || null,
    };
  }
  const equity = Number(summary.equity);
  if (!Number.isFinite(equity)) {
    return {
      accountId,
      reason: "summary_equity_missing",
      source: source || null,
    };
  }
  return null;
}

function hasBlockedLiveQualityMarker(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return STRICT_LIVE_BLOCKED_SOURCE_MARKERS.some((marker) => normalized.includes(marker));
}

function getStrictLiveMarketDataIssue(account, payload, options = {}) {
  if (!isLiveModeAccount(account)) {
    return null;
  }

  const accountId = String(account?.accountId || "");
  const authState = String(account?.authState || "").toLowerCase();
  if (!isAuthenticatedLiveMarketDataAccount(account)) {
    return {
      accountId,
      reason: "auth_not_authenticated",
      authState,
    };
  }
  if (!payload || typeof payload !== "object") {
    return {
      accountId,
      reason: "market_payload_missing",
    };
  }

  const source = String(payload.source || "").trim().toLowerCase();
  if (!isTrustedLiveSummarySource(account, source)) {
    return {
      accountId,
      reason: "market_untrusted_source",
      source: source || null,
    };
  }

  const dataQuality = String(payload.dataQuality || "").trim().toLowerCase();
  if (hasBlockedLiveQualityMarker(dataQuality)) {
    return {
      accountId,
      reason: "market_untrusted_quality",
      source: source || null,
      dataQuality: dataQuality || null,
    };
  }

  const nestedSources = Array.isArray(options.nestedSources) ? options.nestedSources : [];
  for (const key of nestedSources) {
    const nested = payload?.[key];
    if (!nested || typeof nested !== "object") {
      return {
        accountId,
        reason: "market_component_missing",
        component: key,
      };
    }
    const nestedSource = String(nested.source || "").trim().toLowerCase();
    if (!isTrustedLiveSummarySource(account, nestedSource)) {
      return {
        accountId,
        reason: "market_component_untrusted_source",
        component: key,
        source: nestedSource || null,
      };
    }
    const nestedQuality = String(nested.dataQuality || "").trim().toLowerCase();
    if (hasBlockedLiveQualityMarker(nestedQuality)) {
      return {
        accountId,
        reason: "market_component_untrusted_quality",
        component: key,
        source: nestedSource || null,
        dataQuality: nestedQuality || null,
      };
    }
  }

  return null;
}

function getStrictLivePerformanceIssues({
  accounts,
  summariesByAccount,
  pointsByAccount,
  nativeClosedTradesByAccount,
  nativeCashLedgerByAccount,
  benchmark,
  performance,
}) {
  const issues = [];
  const liveAccounts = (Array.isArray(accounts) ? accounts : []).filter((account) => isLiveModeAccount(account));
  if (!liveAccounts.length) {
    return issues;
  }

  for (const account of liveAccounts) {
    const accountId = String(account?.accountId || "");
    const summaryIssue = getStrictLiveSummaryIssue(account, summariesByAccount?.[accountId]);
    if (summaryIssue) {
      issues.push(summaryIssue);
    }

    const rows = Array.isArray(pointsByAccount?.[accountId]) ? pointsByAccount[accountId] : [];
    for (const row of rows) {
      const source = String(row?.source || "").trim().toLowerCase();
      if (!isTrustedLiveHistorySource(account, source)) {
        issues.push({
          accountId,
          reason: "history_untrusted_source",
          source: source || null,
          ts: row?.ts || null,
        });
        break;
      }
    }
  }

  const hasAnyNativeClosedTrades = Object.values(nativeClosedTradesByAccount || {}).some(
    (rows) => Array.isArray(rows) && rows.length > 0,
  );
  const hasAnyNativeCashLedger = Object.values(nativeCashLedgerByAccount || {}).some(
    (rows) => Array.isArray(rows) && rows.length > 0,
  );
  const closedTradeRows = Array.isArray(performance?.ledgers?.closedTrades)
    ? performance.ledgers.closedTrades.length
    : 0;
  const cashLedgerRows = Array.isArray(performance?.ledgers?.cash)
    ? performance.ledgers.cash.length
    : 0;
  if (liveAccounts.length > 0 && !hasAnyNativeClosedTrades) {
    issues.push({
      reason: "closed_trades_missing_native_source",
      rows: closedTradeRows,
    });
  }
  if (liveAccounts.length > 0 && !hasAnyNativeCashLedger) {
    issues.push({
      reason: "cash_ledger_missing_native_source",
      rows: cashLedgerRows,
    });
  }

  if (benchmark && typeof benchmark === "object") {
    const source = String(benchmark.source || "").trim().toLowerCase();
    if (hasBlockedLiveSourceMarker(source) || source.includes("anchored")) {
      issues.push({
        reason: "benchmark_untrusted_source",
        source: source || null,
      });
    }
  }

  return issues;
}

function hasRenderablePerformancePayload(performance) {
  if (!performance || typeof performance !== "object") {
    return false;
  }

  const single = Array.isArray(performance?.chart?.single)
    ? performance.chart.single.length
    : 0;
  const layered = Array.isArray(performance?.chart?.layered?.total)
    ? performance.chart.layered.total.length
    : 0;
  const closedTrades = Array.isArray(performance?.ledgers?.closedTrades)
    ? performance.ledgers.closedTrades.length
    : 0;
  const cashLedger = Array.isArray(performance?.ledgers?.cash)
    ? performance.ledgers.cash.length
    : 0;
  const accountRows = Array.isArray(performance?.accounts) ? performance.accounts : [];
  const accountHistoryPoints = accountRows.reduce(
    (sum, row) => sum + Number(row?.historyPoints || 0),
    0,
  );

  return single > 0
    || layered > 0
    || closedTrades > 0
    || cashLedger > 0
    || accountHistoryPoints > 0;
}

function buildPerformanceAvailability({ issues, performance }) {
  const safeIssues = Array.isArray(issues) ? issues : [];
  const hasHistory = hasRenderablePerformancePayload(performance);
  if (!safeIssues.length) {
    return {
      state: "live",
      liveDataReady: true,
      hasHistory,
      message: null,
    };
  }

  const authIssue = safeIssues.some((issue) => issue?.reason === "auth_not_authenticated");
  if (hasHistory && authIssue) {
    return {
      state: "history_only",
      liveDataReady: false,
      hasHistory: true,
      message: "Live broker auth is unavailable. Showing the last verified equity history only.",
    };
  }
  if (hasHistory) {
    return {
      state: "degraded",
      liveDataReady: false,
      hasHistory: true,
      message: "Live broker data is partially unavailable. Showing the last verified equity history that is still trusted.",
    };
  }
  return {
    state: "unavailable",
    liveDataReady: false,
    hasHistory: false,
    message: "No verified equity history is available yet. Reconnect the broker, then run backfill.",
  };
}

async function resolveDisplaySummary(store, account, adapter) {
  if (!account || !adapter) {
    return null;
  }

  const authState = String(account.authState || "").toLowerCase();
  const isLiveMode = String(account.mode || "live").toLowerCase() === "live";
  if (isLiveMode && authState !== "authenticated") {
    return buildUnavailableAccountSummary(store, account, {
      reason: `auth:${authState}`,
    });
  }

  try {
    const summary = await withTimeout(adapter.getAccountSummary(account), 3500);
    if (!summary || typeof summary !== "object") {
      return buildUnavailableAccountSummary(store, account, {
        reason: "summary-unavailable",
      });
    }

    const source = String(summary.source || "").toLowerCase();
    const equity = Number(summary.equity);
    if (isLiveMode && !isTrustedLiveSummarySource(account, source)) {
      return buildUnavailableAccountSummary(store, account, {
        reason: `non-live-source:${source || "missing"}`,
      });
    }
    if (account.broker === "etrade" && isLiveMode && Number.isFinite(equity) && equity <= 0) {
      return buildUnavailableAccountSummary(store, account, {
        reason: "invalid-live-equity",
      });
    }

    return summary;
  } catch {
    return buildUnavailableAccountSummary(store, account, {
      reason: "summary-timeout",
    });
  }
}

function buildUnavailableAccountSummary(store, account, options = {}) {
  const latest = store?.getLatestAccountEquityPoint?.(account.accountId);
  const latestSource = String(latest?.source || "").toLowerCase();
  const canUseLatest = isTrustedLiveHistorySource(account, latestSource);
  const latestEquity = Number(latest?.equity);
  const latestMarketValue = Number(latest?.marketValue);
  const latestUnrealized = Number(latest?.unrealizedPnl);
  const positionCount = store?.listPositions?.(account.accountId)?.length || 0;
  return {
    accountId: account.accountId,
    marketValue: canUseLatest && Number.isFinite(latestMarketValue) ? round2(latestMarketValue) : null,
    unrealizedPnl: canUseLatest && Number.isFinite(latestUnrealized) ? round2(latestUnrealized) : null,
    equity: canUseLatest && Number.isFinite(latestEquity) ? round2(latestEquity) : null,
    buyingPower: null,
    cash: null,
    positions: positionCount,
    source: `${account.broker}-unavailable-summary`,
    stale: true,
    unavailableReason: options.reason || "unavailable",
    lastSync: latest?.ts || latest?.lastSync || null,
  };
}

function withTimeout(promise, timeoutMs) {
  const waitMs = Math.max(250, Number(timeoutMs) || 0);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${waitMs}ms`));
    }, waitMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function collectPerformanceInputs({
  store,
  adapters,
  targetAccounts,
  from,
  to,
  days,
  limit,
  refreshNativeHistory = false,
}) {
  const pointsByAccount = {};
  const summariesByAccount = {};
  const nativeClosedTradesByAccount = {};
  const nativeCashLedgerByAccount = {};

  const closedTradesLimit = clampNumber(limit, 20, 5000, 1200);
  const cashLedgerLimit = clampNumber(limit, 20, 6000, 2000);

  await Promise.all(
    (Array.isArray(targetAccounts) ? targetAccounts : []).map(async (account) => {
      const resolvedAccount = withMergedEnvCredentials(account);
      const accountId = resolvedAccount.accountId;
      const adapter = adapters[resolvedAccount.broker];
      const authState = String(resolvedAccount.authState || "").toLowerCase();
      const isLiveMode = String(resolvedAccount.mode || "live").toLowerCase() === "live";
      const canFetchFromBroker = Boolean(adapter) && (
        !isLiveMode
        || authState === "authenticated"
        || Boolean(refreshNativeHistory)
      );

      summariesByAccount[accountId] = await resolveDisplaySummary(
        store,
        resolvedAccount,
        adapter,
      );
      pointsByAccount[accountId] = sanitizeEquityRowsForAccount(
        resolvedAccount,
        store.listAccountEquityHistory(accountId, {
          from,
          to,
          limit,
        }),
      );

      const cachedClosedTrades = await loadAccountNativeHistoryFromDb({
        account: resolvedAccount,
        historyType: "closed_trades",
        from,
        to,
        limit: closedTradesLimit,
      });
      if (cachedClosedTrades.length) {
        nativeClosedTradesByAccount[accountId] = cachedClosedTrades;
      }

      const shouldFetchClosedTrades = canFetchFromBroker
        && typeof adapter?.getClosedTrades === "function"
        && (refreshNativeHistory || !cachedClosedTrades.length);
      if (shouldFetchClosedTrades) {
        const trades = await withTimeout(
          adapter.getClosedTrades(resolvedAccount, {
            from,
            to,
            days,
            limit: closedTradesLimit,
          }),
          8000,
        ).catch(() => []);
        if (Array.isArray(trades) && trades.length) {
          nativeClosedTradesByAccount[accountId] = trades;
          await persistAccountNativeHistoryToDb({
            account: resolvedAccount,
            historyType: "closed_trades",
            rows: trades,
            defaultSource: String(resolvedAccount.broker || "") + "-closed-trades",
          });
        }
      }

      const cachedCashLedger = await loadAccountNativeHistoryFromDb({
        account: resolvedAccount,
        historyType: "cash_ledger",
        from,
        to,
        limit: cashLedgerLimit,
      });
      if (cachedCashLedger.length) {
        nativeCashLedgerByAccount[accountId] = cachedCashLedger;
      }

      const shouldFetchCashLedger = canFetchFromBroker
        && typeof adapter?.getCashLedger === "function"
        && (refreshNativeHistory || !cachedCashLedger.length);
      if (shouldFetchCashLedger) {
        const ledger = await withTimeout(
          adapter.getCashLedger(resolvedAccount, {
            from,
            to,
            days,
            limit: cashLedgerLimit,
          }),
          8000,
        ).catch(() => []);
        if (Array.isArray(ledger) && ledger.length) {
          nativeCashLedgerByAccount[accountId] = ledger;
          await persistAccountNativeHistoryToDb({
            account: resolvedAccount,
            historyType: "cash_ledger",
            rows: ledger,
            defaultSource: String(resolvedAccount.broker || "") + "-cash-ledger",
          });
        }
      }
    }),
  );

  return {
    pointsByAccount,
    summariesByAccount,
    nativeClosedTradesByAccount,
    nativeCashLedgerByAccount,
  };
}

async function loadAccountNativeHistoryFromDb({
  account,
  historyType,
  from,
  to,
  limit,
}) {
  try {
    const accountId = String(account?.accountId || "").trim();
    if (!accountId) {
      return [];
    }
    const rows = await loadAccountNativeHistoryRowsFromDb({
      accountId,
      historyType,
      from,
      to,
      limit,
    });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.warn("[account-history-db] Failed to load native history:", error?.message || error);
    return [];
  }
}

async function persistAccountEquityHistoryToDb({ account, points }) {
  try {
    await upsertAccountEquityHistory({
      accountId: account?.accountId,
      points,
    });
  } catch (error) {
    console.warn("[account-history-db] Failed to persist equity history:", error?.message || error);
  }
}

async function hydrateAccountEquityHistoryFromDb({
  store,
  account,
  from,
  to,
  limit,
}) {
  try {
    const accountId = String(account?.accountId || "").trim();
    if (!accountId) {
      return;
    }

    const dbRows = await loadAccountEquityHistoryFromDb({
      accountId,
      from,
      to,
      limit,
    });
    if (!Array.isArray(dbRows) || !dbRows.length) {
      return;
    }

    await store.mergeAccountEquityHistory(accountId, dbRows, {
      from,
      to,
      limit,
    });
  } catch (error) {
    console.warn("[account-history-db] Failed to hydrate equity history:", error?.message || error);
  }
}

async function persistAccountNativeHistoryToDb({
  account,
  historyType,
  rows,
  defaultSource,
}) {
  try {
    await upsertAccountNativeHistoryRows({
      accountId: account?.accountId,
      broker: account?.broker,
      historyType,
      rows,
      defaultSource,
    });
  } catch (error) {
    console.warn("[account-history-db] Failed to persist native history:", error?.message || error);
  }
}

function normalizeAuthStatus(raw, broker, fallbackCheckedAt) {
  const checkedAt = raw?.checkedAt || fallbackCheckedAt || new Date().toISOString();
  return {
    broker: String(raw?.broker || broker || "").toLowerCase(),
    state: String(raw?.state || "unknown").toLowerCase(),
    live: Boolean(raw?.live),
    message: raw?.message ? String(raw.message) : null,
    checkedAt,
  };
}

function normalizeRapidOptionOrderOrSend(payload, res) {
  try {
    const accountId = requiredString(payload.accountId, "accountId");
    const fromContract = parseOptionContractId(payload.contractId);
    if (payload.contractId && !fromContract) {
      throw new Error("contractId must match SYMBOL-YYYY-MM-DD-STRIKE-call|put");
    }
    const symbol = optionalString(payload.symbol, fromContract?.symbol || "SPY").toUpperCase();
    const side = optionalString(payload.side, "buy").toLowerCase();
    const quantity = Number(payload.quantity ?? 1);
    const executionMode = optionalString(payload.executionMode, "live").toLowerCase();
    const timeInForce = optionalString(payload.timeInForce, "day").toLowerCase();
    const orderType = optionalString(payload.orderType, payload.limitPrice != null ? "limit" : "market").toLowerCase();
    const limitPrice =
      payload.limitPrice == null || payload.limitPrice === ""
        ? null
        : Number(payload.limitPrice);
    const expiry = payload.expiry || fromContract?.expiry;
    const strike = payload.strike ?? fromContract?.strike;
    const right = payload.right || fromContract?.right;

    const order = normalizeOrderPayload({
      accountId,
      symbol,
      assetType: "option",
      side,
      quantity,
      orderType,
      limitPrice,
      executionMode,
      timeInForce,
      expiry,
      strike,
      right,
    });
    const enrichedOrder = enrichOrderWithCanonicalOptionContract(order, {
      ...(payload && typeof payload === "object" ? payload : {}),
      symbol,
      expiry,
      strike,
      right,
    });

    return {
      previewOnly: parseBoolean(payload.previewOnly),
      order: enrichedOrder,
      rawPayload: payload,
    };
  } catch (error) {
    sendJson(res, 400, {
      error: error?.message || "Invalid rapid options order payload",
    });
    return null;
  }
}

function requiredString(value, key) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== "string") {
    return String(value);
  }
  return value.trim() || fallback;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "n") {
      return false;
    }
  }
  return false;
}

function normalizeRayAlgoPolicyPatch(payload = {}) {
  const patch = {};
  if ("enabled" in payload) {
    patch.enabled = parseBoolean(payload.enabled);
  }
  if ("liveAuto" in payload || "paperAuto" in payload) {
    patch.liveAuto = parseBoolean(
      Object.prototype.hasOwnProperty.call(payload, "liveAuto")
        ? payload.liveAuto
        : payload.paperAuto,
    );
  }
  if ("liveManual" in payload) {
    patch.liveManual = parseBoolean(payload.liveManual);
  }
  if ("quantity" in payload || "paperQuantity" in payload) {
    const raw = Object.prototype.hasOwnProperty.call(payload, "quantity")
      ? payload.quantity
      : payload.paperQuantity;
    patch.quantity = Math.max(1, Math.round(Number(raw) || 1));
  }
  if ("autoAccountId" in payload || "paperAccountId" in payload) {
    const raw = Object.prototype.hasOwnProperty.call(payload, "autoAccountId")
      ? payload.autoAccountId
      : payload.paperAccountId;
    patch.autoAccountId = raw ? String(raw) : null;
  }
  if ("liveAccountId" in payload) {
    patch.liveAccountId = payload.liveAccountId ? String(payload.liveAccountId) : null;
  }
  if ("maxSignalsPerSymbolPerDay" in payload) {
    patch.maxSignalsPerSymbolPerDay = Math.max(
      1,
      Math.round(Number(payload.maxSignalsPerSymbolPerDay) || 1),
    );
  }
  if ("cooldownBars" in payload) {
    patch.cooldownBars = Math.max(0, Math.round(Number(payload.cooldownBars) || 0));
  }
  if ("tradingStart" in payload) {
    patch.tradingStart = String(payload.tradingStart || "09:30");
  }
  if ("tradingEnd" in payload) {
    patch.tradingEnd = String(payload.tradingEnd || "16:00");
  }
  if ("timezone" in payload) {
    patch.timezone = String(payload.timezone || "America/New_York");
  }
  return patch;
}

function normalizeAiFusionConfigPatch(payload = {}) {
  const safePayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};
  const patch = {};

  if ("enabled" in safePayload) {
    patch.enabled = parseBoolean(safePayload.enabled);
  }
  if ("dryRun" in safePayload) {
    patch.dryRun = parseBoolean(safePayload.dryRun);
  }
  if ("provider" in safePayload) {
    const provider = String(safePayload.provider || "").trim().toLowerCase();
    if (provider === "openai" || provider === "dry-run") {
      patch.provider = provider;
    }
  }
  if ("model" in safePayload) {
    patch.model = String(safePayload.model || "").trim() || "gpt-5-mini";
  }
  if ("intervalSec" in safePayload) {
    patch.intervalSec = clampNumber(safePayload.intervalSec, 1, 3600, 60);
  }
  if ("timeoutMs" in safePayload) {
    patch.timeoutMs = clampNumber(safePayload.timeoutMs, 500, 30000, 4500);
  }
  if ("ttlSec" in safePayload) {
    patch.ttlSec = clampNumber(safePayload.ttlSec, 10, 24 * 60 * 60, 180);
  }
  if ("maxHistory" in safePayload) {
    patch.maxHistory = clampNumber(safePayload.maxHistory, 10, 5000, 500);
  }
  if ("failureThreshold" in safePayload) {
    patch.failureThreshold = clampNumber(safePayload.failureThreshold, 1, 20, 3);
  }
  if ("circuitOpenSec" in safePayload) {
    patch.circuitOpenSec = clampNumber(safePayload.circuitOpenSec, 5, 3600, 120);
  }
  if ("openaiFallbackToDryRun" in safePayload) {
    patch.openaiFallbackToDryRun = parseBoolean(safePayload.openaiFallbackToDryRun);
  }
  if ("runOnStart" in safePayload) {
    patch.runOnStart = parseBoolean(safePayload.runOnStart);
  }
  if ("lookbackMinutes" in safePayload) {
    patch.lookbackMinutes = clampNumber(safePayload.lookbackMinutes, 5, 24 * 60, 240);
  }

  return patch;
}

function normalizeRayAlgoSymbol(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) {
    return "AMEX:SPY";
  }
  return text.includes(":") ? text : `AMEX:${text}`;
}

async function handleRayAlgoSignalExecution({ signal, store, adapters }) {
  const signalClass = normalizeRayAlgoSignalClass(
    signal?.signalClass || signal?.eventType || signal?.meta?.signalClass || signal?.meta?.eventType || null,
    null,
  );
  if (signalClass && signalClass !== "trend_change") {
    return { status: "skipped", reason: "signal_class_not_executable" };
  }

  const policy = store.getRayAlgoExecutionPolicy();
  if (!policy?.enabled) {
    return { status: "skipped", reason: "policy_disabled" };
  }
  if (String(signal.source || "").toLowerCase() !== "local") {
    return { status: "skipped", reason: "source_not_local" };
  }
  if (!isRayAlgoWithinTradingWindow(signal.ts, policy)) {
    return { status: "skipped", reason: "outside_trading_window" };
  }
  if (hasReachedRayAlgoDailyLimit({ store, signal, policy })) {
    return { status: "skipped", reason: "daily_limit_reached" };
  }

  let autoOrder = null;
  let autoOrderBlocked = null;
  let approval = null;
  const side = signal.direction === "sell" ? "sell" : "buy";
  const symbol = extractRayAlgoMarketSymbol(signal.symbol);
  const quantity = Math.max(1, Math.round(Number(policy.quantity ?? policy.paperQuantity) || 1));
  const liveAuto = Boolean(policy.liveAuto ?? policy.paperAuto);
  const autoAccountId = policy.autoAccountId ?? policy.paperAccountId ?? null;

    if (liveAuto) {
      const liveAutoAccount = resolveRayAlgoExecutionAccount({
        store,
        preferredAccountId: autoAccountId,
        requireLive: true,
      });
      if (liveAutoAccount) {
        const adapter = adapters[liveAutoAccount.broker];
        if (adapter) {
          const order = normalizeOrderPayload({
            accountId: liveAutoAccount.accountId,
            symbol,
            assetType: "equity",
            side,
            quantity,
            orderType: "market",
            executionMode: "live",
            timeInForce: "day",
          });
          const liveExecutionGuard = getLiveExecutionGuardResponse({
            account: liveAutoAccount,
            adapter,
            orderLike: order,
          });
          if (!liveExecutionGuard) {
            autoOrder = await adapter.placeOrder(liveAutoAccount, order);
            await store.upsertAccount({
              accountId: liveAutoAccount.accountId,
              broker: liveAutoAccount.broker,
              lastSync: new Date().toISOString(),
              status: "connected",
            });
          } else {
            autoOrderBlocked = liveExecutionGuard.body;
          }
        }
      }
    }

  if (policy.liveManual) {
    const liveAccount = resolveRayAlgoExecutionAccount({
      store,
      preferredAccountId: policy.liveAccountId,
      requireLive: true,
    });
    const orderDraft = {
      accountId: liveAccount?.accountId || policy.liveAccountId || null,
      symbol,
      assetType: "equity",
      side,
      quantity,
      orderType: "market",
      executionMode: "live",
      timeInForce: "day",
    };
    approval = await store.appendRayAlgoManualApproval({
      signalId: signal.signalId,
      symbol: signal.symbol,
      direction: signal.direction,
      status: "pending",
      orderDraft,
    });
  }

  return {
    status: "processed",
    autoOrderId: autoOrder?.orderId || null,
    autoOrderBlocked,
    approvalId: approval?.approvalId || null,
  };
}

function resolveRayAlgoExecutionAccount({ store, preferredAccountId, requireLive }) {
  const preferred = preferredAccountId ? store.getAccount(preferredAccountId) : null;
  if (preferred) {
    if (!requireLive || isAuthenticatedLiveTradingAccount(preferred)) {
      return preferred;
    }
  }

  const accounts = store.listAccounts();
  const liveReady = accounts.filter((account) => isAuthenticatedLiveTradingAccount(account));
  const connected = accounts.filter((account) => account.status === "connected");
  const pool = liveReady.length ? liveReady : (connected.length ? connected : accounts);
  if (!pool.length) {
    return null;
  }
  if (requireLive) {
    const live = pool.find((account) => isAuthenticatedLiveTradingAccount(account));
    return live || null;
  }
  return pool[0];
}

function hasReachedRayAlgoDailyLimit({ store, signal, policy }) {
  const limit = Math.max(1, Number(policy.maxSignalsPerSymbolPerDay) || 1);
  const dayKey = rayAlgoDayKey(signal.ts, policy.timezone || "America/New_York");
  const sourceRows = store.listRayAlgoSignals({
    source: "local",
    symbol: signal.symbol,
    limit: 5000,
  });
  const sameDay = sourceRows.filter((row) => {
    const rowDay = rayAlgoDayKey(row.ts || row.barTime, policy.timezone || "America/New_York");
    return rowDay === dayKey;
  });
  return sameDay.length > limit;
}

function isRayAlgoWithinTradingWindow(timestamp, policy) {
  const start = parseClock(policy.tradingStart || "09:30");
  const end = parseClock(policy.tradingEnd || "16:00");
  if (!start || !end) {
    return true;
  }
  const parts = getTimePartsInTimezone(timestamp, policy.timezone || "America/New_York");
  if (!parts) {
    return true;
  }
  const currentMins = parts.hours * 60 + parts.minutes;
  const startMins = start.hours * 60 + start.minutes;
  const endMins = end.hours * 60 + end.minutes;
  return currentMins >= startMins && currentMins <= endMins;
}

function parseClock(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return { hours, minutes };
}

function getTimePartsInTimezone(timestamp, timezone) {
  const parsed = Date.parse(String(timestamp || ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(parsed));
  const map = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hours: Number(map.hour),
    minutes: Number(map.minute),
  };
}

function rayAlgoDayKey(timestamp, timezone) {
  const parts = getTimePartsInTimezone(timestamp, timezone);
  if (!parts) {
    return "unknown";
  }
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function extractRayAlgoMarketSymbol(symbol) {
  const value = String(symbol || "").trim().toUpperCase();
  if (!value) return "SPY";
  return value.includes(":") ? value.split(":").pop() : value;
}

function readTradingViewWebhookSecret() {
  return String(
    process.env.TRADINGVIEW_WEBHOOK_SECRET ||
      process.env.TV_WEBHOOK_SECRET ||
      "",
  ).trim();
}

function normalizeTradingViewAlertPayload(payload, rawBody) {
  const objectPayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload
      : {};
  const nestedPayload = firstObjectValue(
    objectPayload.signal,
    objectPayload.data,
    objectPayload.payload,
  );

  const symbol = firstNonEmptyValue(
    objectPayload.symbol,
    objectPayload.ticker,
    objectPayload.instrument,
    objectPayload.syminfo_tickerid,
    objectPayload.syminfo_ticker,
    nestedPayload?.symbol,
    nestedPayload?.ticker,
  );
  const timeframe = normalizeWebhookTimeframe(firstNonEmptyValue(
    objectPayload.timeframe,
    objectPayload.interval,
    objectPayload.resolution,
    objectPayload.tf,
    nestedPayload?.timeframe,
    nestedPayload?.interval,
    nestedPayload?.resolution,
  ));
  const scriptName = firstNonEmptyValue(
    objectPayload.scriptName,
    objectPayload.script,
    objectPayload.indicator,
    objectPayload.alert_name,
    objectPayload.title,
    nestedPayload?.scriptName,
    nestedPayload?.script,
  );
  const strategy = firstNonEmptyValue(
    objectPayload.strategyName,
    objectPayload.strategy,
    objectPayload.algo,
    nestedPayload?.strategyName,
    nestedPayload?.strategy,
    scriptName,
  );
  const action = normalizeWebhookDirection(firstNonEmptyValue(
    objectPayload.action,
    objectPayload.side,
    objectPayload.signal,
    objectPayload.direction,
    objectPayload.order_action,
    objectPayload.orderAction,
    nestedPayload?.action,
    nestedPayload?.side,
    nestedPayload?.signal,
    nestedPayload?.direction,
  ));
  const eventType = normalizeWebhookEventType(firstNonEmptyValue(
    objectPayload.eventType,
    objectPayload.event,
    objectPayload.type,
    objectPayload.phase,
    nestedPayload?.eventType,
    nestedPayload?.event,
    nestedPayload?.type,
    nestedPayload?.phase,
  ));
  const signalClass = normalizeRayAlgoSignalClass(firstNonEmptyValue(
    objectPayload.signalClass,
    objectPayload.signal_class,
    objectPayload.eventClass,
    objectPayload.event_class,
    nestedPayload?.signalClass,
    nestedPayload?.signal_class,
    nestedPayload?.eventClass,
    nestedPayload?.event_class,
  ));
  const message = firstNonEmptyValue(
    objectPayload.message,
    objectPayload.text,
    objectPayload.note,
    nestedPayload?.message,
    nestedPayload?.text,
  );
  const price = firstNonEmptyValue(
    objectPayload.price,
    objectPayload.close,
    objectPayload.last,
    objectPayload.value,
    objectPayload.entry_price,
    objectPayload.entryPrice,
    objectPayload.fill_price,
    objectPayload.fillPrice,
    nestedPayload?.price,
    nestedPayload?.close,
  );
  const signalTs = firstNonEmptyValue(
    objectPayload.ts,
    objectPayload.time,
    objectPayload.timestamp,
    objectPayload.barTime,
    objectPayload.bar_time,
    objectPayload.signalTs,
    objectPayload.signal_ts,
    objectPayload.alert_time,
    nestedPayload?.ts,
    nestedPayload?.time,
    nestedPayload?.timestamp,
    nestedPayload?.barTime,
  );
  const conviction = firstNonEmptyValue(
    objectPayload.conviction,
    objectPayload.confidence,
    objectPayload.score,
    objectPayload.strength,
    nestedPayload?.conviction,
    nestedPayload?.confidence,
    nestedPayload?.score,
  );
  const regime = firstNonEmptyValue(
    objectPayload.regime,
    objectPayload.market_regime,
    objectPayload.marketRegime,
    nestedPayload?.regime,
    nestedPayload?.market_regime,
    nestedPayload?.marketRegime,
  );
  const components = extractWebhookComponents(objectPayload, nestedPayload);
  const meta = extractWebhookMeta(objectPayload, nestedPayload);

  return {
    alertId: firstNonEmptyValue(
      objectPayload.alertId,
      objectPayload.id,
      objectPayload.uuid,
      objectPayload.signalId,
      nestedPayload?.signalId,
    ),
    scriptName,
    strategy,
    symbol,
    timeframe,
    eventType,
    signalClass,
    action,
    direction: action,
    signalTs,
    price,
    conviction,
    regime,
    components,
    meta,
    message: message || (rawBody ? String(rawBody).slice(0, 1000) : null),
    source: "tradingview-webhook",
    raw: objectPayload && Object.keys(objectPayload).length ? objectPayload : rawBody,
    secret: firstNonEmptyValue(
      objectPayload.secret,
      objectPayload.webhookSecret,
      objectPayload.passphrase,
    ),
    receivedAt: new Date().toISOString(),
  };
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const text = String(value).trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function firstObjectValue(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function normalizeWebhookDirection(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  if (
    text === "buy" ||
    text === "long" ||
    text === "entry_long" ||
    text === "open_long"
  ) {
    return "buy";
  }
  if (
    text === "sell" ||
    text === "short" ||
    text === "entry_short" ||
    text === "open_short"
  ) {
    return "sell";
  }
  if (text.startsWith("b")) return "buy";
  if (text.startsWith("s")) return "sell";
  return null;
}

function normalizeWebhookEventType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text === "entry_long" || text === "entry_short" || text === "entry") return "entry";
  if (
    text === "exit" ||
    text === "close" ||
    text === "take_profit" ||
    text === "stop_loss" ||
    text === "tp" ||
    text === "sl"
  ) {
    return "exit";
  }
  if (text === "signal" || text === "trigger" || text === "flip") return "signal";
  if (text === "heartbeat" || text === "status" || text === "debug") return text;
  return text;
}

function normalizeWebhookTimeframe(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) {
    return null;
  }
  if (text === "D" || text === "1D") return "1D";
  if (text === "W" || text === "1W") return "1W";
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return String(Math.round(numeric));
  }
  return text;
}

function extractWebhookComponents(objectPayload, nestedPayload) {
  const fromPayload = firstObjectValue(
    objectPayload.components,
    objectPayload.signalComponents,
    nestedPayload?.components,
    nestedPayload?.signalComponents,
  ) || {};

  return {
    emaCross: normalizeWebhookSignedValue(
      firstNonEmptyValue(
        fromPayload.emaCross,
        fromPayload.ema_cross,
        objectPayload.emaCross,
        objectPayload.ema_cross,
        nestedPayload?.emaCross,
        nestedPayload?.ema_cross,
      ),
    ),
    bosRecent: normalizeWebhookSignedValue(
      firstNonEmptyValue(
        fromPayload.bosRecent,
        fromPayload.bos_recent,
        objectPayload.bosRecent,
        objectPayload.bos_recent,
        objectPayload.bos,
        nestedPayload?.bosRecent,
        nestedPayload?.bos_recent,
        nestedPayload?.bos,
      ),
    ),
    chochRecent: normalizeWebhookSignedValue(
      firstNonEmptyValue(
        fromPayload.chochRecent,
        fromPayload.choch_recent,
        objectPayload.chochRecent,
        objectPayload.choch_recent,
        objectPayload.choch,
        nestedPayload?.chochRecent,
        nestedPayload?.choch_recent,
        nestedPayload?.choch,
      ),
    ),
    obDir: normalizeWebhookSignedValue(
      firstNonEmptyValue(
        fromPayload.obDir,
        fromPayload.ob_dir,
        objectPayload.obDir,
        objectPayload.ob_dir,
        objectPayload.orderBlockDir,
        nestedPayload?.obDir,
        nestedPayload?.ob_dir,
      ),
    ),
    sweepDir: normalizeWebhookSignedValue(
      firstNonEmptyValue(
        fromPayload.sweepDir,
        fromPayload.sweep_dir,
        objectPayload.sweepDir,
        objectPayload.sweep_dir,
        objectPayload.sweep,
        nestedPayload?.sweepDir,
        nestedPayload?.sweep_dir,
        nestedPayload?.sweep,
      ),
    ),
  };
}

function extractWebhookMeta(objectPayload, nestedPayload) {
  const meta = firstObjectValue(
    objectPayload.meta,
    objectPayload.context,
    nestedPayload?.meta,
    nestedPayload?.context,
  ) || {};

  return {
    ...meta,
    externalSignalId: firstNonEmptyValue(
      objectPayload.signalId,
      nestedPayload?.signalId,
      objectPayload.externalId,
      nestedPayload?.externalId,
    ),
    externalOrderId: firstNonEmptyValue(
      objectPayload.orderId,
      objectPayload.order_id,
      nestedPayload?.orderId,
      nestedPayload?.order_id,
    ),
  };
}

function normalizeWebhookSignedValue(value) {
  if (value == null || value === "") {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 0) return 1;
    if (numeric < 0) return -1;
    return 0;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) return 0;
  if (
    text === "bull" ||
    text === "bullish" ||
    text === "up" ||
    text === "long" ||
    text === "buy" ||
    text === "true"
  ) {
    return 1;
  }
  if (
    text === "bear" ||
    text === "bearish" ||
    text === "down" ||
    text === "short" ||
    text === "sell" ||
    text === "false"
  ) {
    return -1;
  }
  return 0;
}

function buildRayAlgoSignalFromWebhookAlert(alert, options = {}) {
  return normalizeRayAlgoSignalPayload({
    signalId: firstNonEmptyValue(
      alert.alertId,
      alert.meta?.externalSignalId,
    ),
    source: "pine",
    strategy: alert.strategy || "rayalgo",
    symbol: alert.symbol || "AMEX:SPY",
    timeframe: alert.timeframe || options.timeframeFallback || "5",
    eventType: alert.eventType || null,
    signalClass: alert.signalClass || null,
    direction: alert.direction || alert.action,
    ts: alert.signalTs || alert.receivedAt,
    price: alert.price,
    conviction: alert.conviction,
    regime: alert.regime || "unknown",
    components: alert.components,
    meta: {
      ...(alert.meta || {}),
      scriptName: alert.scriptName || null,
      eventType: alert.eventType || null,
      signalClass: alert.signalClass || null,
      message: alert.message || null,
      alertId: alert.alertId || null,
      source: "tradingview-webhook",
    },
  });
}

function shouldIngestWebhookAsPineSignal(alert) {
  const eventType = String(alert?.eventType || "").trim().toLowerCase();
  if (!eventType) {
    return true;
  }
  if (
    eventType === "heartbeat" ||
    eventType === "status" ||
    eventType === "debug" ||
    eventType === "info"
  ) {
    return false;
  }
  if (eventType === "exit" || eventType === "close") {
    return false;
  }
  return true;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function parseRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function parseJsonBody(req) {
  const raw = await parseRawBody(req);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

async function parseFlexibleRequestBody(req, res) {
  try {
    const raw = await parseRawBody(req);
    if (!raw) {
      return { raw: "", payload: {} };
    }
    try {
      return { raw, payload: JSON.parse(raw) };
    } catch {
      return {
        raw,
        payload: {
          message: raw,
        },
      };
    }
  } catch (error) {
    sendJson(res, 400, {
      error: error?.message || "Invalid body",
    });
    return null;
  }
}

function startNdjsonStream(res, status = 200) {
  res.writeHead(status, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
}

function writeNdjsonEvent(res, payload) {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  res.write(`${JSON.stringify(payload)}\n`);
}

function startEventStream(res, status = 200) {
  res.writeHead(status, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  res.write("retry: 1000\n\n");
}

function writeEventStreamEvent(res, payload) {
  if (res.writableEnded || res.destroyed) {
    return;
  }
  const data = JSON.stringify(payload);
  res.write(`data: ${data}\n\n`);
}

async function parseRequestBody(req, res) {
  try {
    return await parseJsonBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: error?.message || "Invalid JSON body",
    });
    return null;
  }
}

function normalizeOrderPayloadOrSend(payload, res) {
  try {
    const normalized = normalizeOrderPayload(payload);
    return enrichOrderWithCanonicalOptionContract(normalized, payload);
  } catch (error) {
    sendJson(res, 400, {
      error: error?.message || "Invalid order payload",
    });
    return null;
  }
}

function normalizeClosePayloadOrSend(payload, fallbackAccountId, res) {
  try {
    return normalizeClosePayload(payload, fallbackAccountId);
  } catch (error) {
    sendJson(res, 400, {
      error: error?.message || "Invalid close payload",
    });
    return null;
  }
}

function enrichOrderWithCanonicalOptionContract(order, payload = {}) {
  if (!order || order.assetType !== "option") {
    return order;
  }

  const contract = normalizeOptionContractPayload(payload, {
    symbol: order.symbol,
    expiry: order.option?.expiry,
    strike: order.option?.strike,
    right: order.option?.right,
    contractId: order.optionContractId || order.optionContract?.contractId,
  });
  if (!contract) {
    return order;
  }

  return {
    ...order,
    symbol: contract.symbol,
    option: {
      expiry: contract.expiry,
      strike: round2(contract.strike),
      right: contract.right,
    },
    expiry: contract.expiry,
    strike: round2(contract.strike),
    right: contract.right,
    optionContractId: contract.contractId,
    optionContract: contract,
  };
}

async function upsertOptionContractFromOrder(store, order, context = {}) {
  if (!order || order.assetType !== "option") {
    return null;
  }
  const contract = normalizeOptionContractPayload({
    contractId: order.optionContractId || order.optionContract?.contractId,
    symbol: order.symbol,
    expiry: order.option?.expiry || order.expiry,
    strike: order.option?.strike || order.strike,
    right: order.option?.right || order.right,
  });
  if (!contract) {
    return null;
  }
  return store.upsertOptionContract(contract, context);
}
