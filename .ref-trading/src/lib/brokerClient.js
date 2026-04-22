const API_BASE = import.meta.env.VITE_API_BASE_URL || "";
const REQUEST_TIMEOUT_MS = parsePositiveNumber(import.meta.env.VITE_API_TIMEOUT_MS, 12000);
const BACKTEST_REQUEST_TIMEOUT_MS = Math.max(
  REQUEST_TIMEOUT_MS,
  parsePositiveNumber(import.meta.env.VITE_BACKTEST_API_TIMEOUT_MS, 30000),
);
const BACKTEST_LONG_REQUEST_TIMEOUT_MS = Math.max(
  BACKTEST_REQUEST_TIMEOUT_MS,
  parsePositiveNumber(import.meta.env.VITE_BACKTEST_LONG_TIMEOUT_MS, 180000),
);
const BACKTEST_STREAM_TIMEOUT_MS = Math.max(
  BACKTEST_LONG_REQUEST_TIMEOUT_MS,
  parsePositiveNumber(import.meta.env.VITE_BACKTEST_STREAM_TIMEOUT_MS, 300000),
);
const SAFE_METHOD_RETRY_COUNT = parsePositiveNumber(import.meta.env.VITE_API_RETRY_COUNT, 2);
const BACKTEST_STREAM_UNAVAILABLE_ERROR_CODE = "BACKTEST_STREAM_UNAVAILABLE";
const GET_RESPONSE_CACHE_TTL_MS = parsePositiveNumber(
  import.meta.env.VITE_API_GET_CACHE_TTL_MS,
  1500,
);
const GET_RESPONSE_CACHE_TTL_FAST_MS = parsePositiveNumber(
  import.meta.env.VITE_API_GET_CACHE_TTL_FAST_MS,
  500,
);
const GET_RESPONSE_CACHE_TTL_SLOW_MS = parsePositiveNumber(
  import.meta.env.VITE_API_GET_CACHE_TTL_SLOW_MS,
  4000,
);
const GET_RESPONSE_CACHE_MAX_ENTRIES = parsePositiveNumber(
  import.meta.env.VITE_API_GET_CACHE_MAX_ENTRIES,
  250,
);
const GET_RESPONSE_CACHE = new Map();
const INFLIGHT_GET_REQUESTS = new Map();
let GET_CACHE_EPOCH = 0;
const FAST_CACHE_PREFIXES = [
  "/api/market/spot",
  "/api/market/order-flow",
  "/api/market/ticks",
  "/api/tradingview/alerts",
  "/api/rayalgo/signals",
];
const SLOW_CACHE_PREFIXES = [
  "/api/brokers/capabilities",
  "/api/dashboard-layout",
];

export async function getAccounts() {
  const response = await request("/api/accounts", { method: "GET" });
  return response.accounts || [];
}

export async function getBrokerCapabilities() {
  return request("/api/brokers/capabilities", { method: "GET" });
}

export async function getApiHealth() {
  return request("/api/health", { method: "GET" });
}

export async function getDashboardLayout({ dashboardId = "market-dashboard" } = {}) {
  const response = await request(
    `/api/dashboard-layout${toQueryString({ dashboardId })}`,
    { method: "GET" },
  );
  return response.layout || null;
}

export async function saveDashboardLayout({
  dashboardId = "market-dashboard",
  layout,
} = {}) {
  const response = await request("/api/dashboard-layout", {
    method: "PUT",
    body: {
      dashboardId,
      layout,
    },
  });
  return response.layout || null;
}

export async function getResearchHistory() {
  const response = await request("/api/research/history", { method: "GET" });
  return response?.history || { runHistory: [], optimizerHistory: [] };
}

export async function saveResearchHistory(history = {}) {
  const response = await request("/api/research/history", {
    method: "PUT",
    body: {
      history,
    },
  });
  return response?.history || { runHistory: [], optimizerHistory: [] };
}

export async function getResearchBacktests() {
  return request("/api/research/backtests", { method: "GET", disableMemoryCache: true });
}

export async function getResearchScoreStudyRuns() {
  return request("/api/research/score-studies/runs", {
    method: "GET",
    disableMemoryCache: true,
    cacheTtlMs: 0,
    timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
  });
}

export async function getResearchScoreStudyRun(runId) {
  return request(`/api/research/score-studies/runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    disableMemoryCache: true,
    cacheTtlMs: 0,
    timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
  });
}

export async function saveResearchScoreStudyRun(payload = {}) {
  return request("/api/research/score-studies/runs", {
    method: "POST",
    timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
    body: payload,
  });
}

export async function createResearchScoreStudyJob(payload = {}, { apiKey } = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey ? { "x-massive-api-key": normalizedKey } : undefined;
  return request("/api/research/score-studies/jobs", {
    method: "POST",
    headers,
    timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
    body: payload,
  });
}

export async function getResearchScoreStudyJob(jobId) {
  return request(`/api/research/score-studies/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    disableMemoryCache: true,
    cacheTtlMs: 0,
    timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
  });
}

export async function cancelResearchScoreStudyJob(jobId) {
  return request(`/api/research/score-studies/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
  });
}

export async function getResearchScoreStudyLocalArtifacts() {
  return request("/api/research/score-studies/artifacts/local", {
    method: "GET",
    disableMemoryCache: true,
    cacheTtlMs: 0,
    timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
  });
}

export async function importResearchScoreStudyArtifact(payload = {}) {
  return request("/api/research/score-studies/import", {
    method: "POST",
    timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
    body: payload,
  });
}

export async function createResearchBacktestJob(payload = {}, { apiKey } = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey ? { "x-massive-api-key": normalizedKey } : undefined;
  return request("/api/research/backtests/jobs", {
    method: "POST",
    headers,
    timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
    body: payload,
  });
}

export async function getResearchBacktestJob(jobId) {
  return request(`/api/research/backtests/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
    disableMemoryCache: true,
    cacheTtlMs: 0,
  });
}

export async function cancelResearchBacktestJob(jobId) {
  return request(`/api/research/backtests/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
    timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
  });
}

export async function getResearchBacktestResult(resultId) {
  return request(`/api/research/backtests/results/${encodeURIComponent(resultId)}`, {
    method: "GET",
    disableMemoryCache: true,
    cacheTtlMs: 0,
  });
}

export async function saveResearchBacktestResult(payload = {}) {
  return request("/api/research/backtests/results", {
    method: "POST",
    timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
    body: payload,
  });
}

export async function bookmarkResearchBacktestResult(resultId) {
  return request(`/api/research/backtests/results/${encodeURIComponent(resultId)}/bookmark`, {
    method: "POST",
    timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
  });
}

export async function getDefaultCredentialStatus() {
  const response = await request("/api/accounts/default-credentials/status", {
    method: "GET",
  });
  return response.statusByBroker || {};
}

export async function getDefaultCredentials() {
  const response = await request("/api/accounts/default-credentials", {
    method: "GET",
  });
  return response.credentialsByBroker || {};
}

export async function refreshRuntimeCredentials() {
  const response = await request("/api/accounts/default-credentials/runtime", {
    method: "GET",
  });
  return response.hydration || null;
}

export async function connectAccount(accountId, payload) {
  const response = await request(`/api/accounts/${encodeURIComponent(accountId)}/connect`, {
    method: "POST",
    body: payload,
  });
  return response.account;
}

export async function setAccountMode(accountId, mode) {
  const response = await request(`/api/accounts/${encodeURIComponent(accountId)}/mode`, {
    method: "PATCH",
    body: { mode },
  });
  return response.account;
}

export async function getAccountAuthStatus(accountId) {
  const response = await request(`/api/accounts/${encodeURIComponent(accountId)}/auth`, {
    method: "GET",
  });
  return response;
}

export async function refreshAccountAuth(accountId) {
  const response = await request(`/api/accounts/${encodeURIComponent(accountId)}/auth/refresh`, {
    method: "POST",
  });
  return response;
}

export async function getEtradeOAuthStatus(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/etrade/oauth/status`, {
    method: "GET",
  });
}

export async function startEtradeOAuth(accountId, payload = {}) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/etrade/oauth/start`, {
    method: "POST",
    body: payload,
  });
}

export async function completeEtradeOAuth(accountId, payload = {}) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/etrade/oauth/complete`, {
    method: "POST",
    body: payload,
  });
}

export async function automateEtradeOAuth(accountId, payload = {}) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/etrade/oauth/automate`, {
    method: "POST",
    body: payload,
  });
}

export async function renewEtradeOAuth(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/etrade/oauth/renew`, {
    method: "POST",
  });
}

export async function revokeEtradeOAuth(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/etrade/oauth/revoke`, {
    method: "POST",
  });
}

export async function getWebullOAuthStatus(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/webull/oauth/status`, {
    method: "GET",
  });
}

export async function startWebullOAuth(accountId, payload = {}) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/webull/oauth/start`, {
    method: "POST",
    body: payload,
  });
}

export async function refreshWebullOAuth(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/webull/oauth/refresh`, {
    method: "POST",
  });
}

export async function revokeWebullOAuth(accountId) {
  return request(`/api/accounts/${encodeURIComponent(accountId)}/webull/oauth/revoke`, {
    method: "POST",
  });
}

export async function getPositions(accountId = "all") {
  const query = accountId && accountId !== "all" ? `?accountId=${encodeURIComponent(accountId)}` : "";
  const response = await request(`/api/positions${query}`, { method: "GET" });
  return {
    positions: response.positions || [],
    availability: response.availability || null,
  };
}

export async function getAccountEquityHistory({
  accountId = "all",
  from,
  to,
  days,
  limit,
  refresh = false,
} = {}) {
  const response = await request(
    `/api/accounts/equity-history${toQueryString({
      accountId,
      from,
      to,
      days,
      limit,
      refresh: refresh ? "true" : null,
    })}`,
    { method: "GET" },
  );
  return response;
}

export async function refreshAccountEquityHistory({
  accountId = "all",
  from,
  to,
  days,
  limit,
} = {}) {
  return request("/api/accounts/equity-history/refresh", {
    method: "POST",
    body: {
      accountId,
      from,
      to,
      days,
      limit,
    },
  });
}

export async function getAccountPerformance({
  accountId = "all",
  from,
  to,
  days,
  limit,
  refresh = false,
  includeBenchmark = false,
  benchmarkSymbol = "SPY",
} = {}) {
  return request(
    `/api/accounts/performance${toQueryString({
      accountId,
      from,
      to,
      days,
      limit,
      refresh: refresh ? "true" : null,
      benchmark: includeBenchmark ? "true" : null,
      benchmarkSymbol: includeBenchmark ? benchmarkSymbol : null,
    })}`,
    { method: "GET" },
  );
}

export async function refreshAccountPerformance({
  accountId = "all",
  from,
  to,
  days,
  limit,
  includeBenchmark = true,
  benchmarkSymbol = "SPY",
} = {}) {
  return request("/api/accounts/performance/refresh", {
    method: "POST",
    body: {
      accountId,
      from,
      to,
      days,
      limit,
      includeBenchmark,
      benchmarkSymbol,
    },
  });
}

export async function getSpotQuote({ accountId, symbol }) {
  const response = await request(
    `/api/market/spot${toQueryString({ accountId, symbol })}`,
    { method: "GET" },
  );
  return response.quote || null;
}

export async function getMarketBars({ accountId, symbol, resolution, from, to, countBack }) {
  const response = await request(
    `/api/market/bars${toQueryString({ accountId, symbol, resolution, from, to, countBack })}`,
    { method: "GET" },
  );
  return response;
}

export async function getBacktestSpotHistory({ accountId, symbol, mode, before, initialDays, preferredTf, apiKey } = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  return request(
    `/api/backtest/spot-history${toQueryString({ accountId, symbol, mode, before, initialDays, preferredTf })}`,
    {
      method: "GET",
      timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
      disableMemoryCache: true,
      headers,
    },
  );
}

export async function getMarketDepth({ accountId, symbol, levels, depthLevels } = {}) {
  const response = await request(
    `/api/market/depth${toQueryString({ accountId, symbol, levels, depthLevels })}`,
    { method: "GET" },
  );
  return response.depth || null;
}

export async function getMarketTicks({ accountId, symbol, limit, tickLimit } = {}) {
  const response = await request(
    `/api/market/ticks${toQueryString({ accountId, symbol, limit, tickLimit })}`,
    { method: "GET" },
  );
  return response.ticks || null;
}

export async function getMarketFootprint({
  accountId,
  symbol,
  resolution,
  from,
  to,
  countBack,
} = {}) {
  const response = await request(
    `/api/market/footprint${toQueryString({ accountId, symbol, resolution, from, to, countBack })}`,
    { method: "GET" },
  );
  return response.footprint || null;
}

export async function getMarketOrderFlow({
  accountId,
  symbol,
  resolution,
  from,
  to,
  countBack,
  levels,
  depthLevels,
  limit,
  tickLimit,
} = {}) {
  const response = await request(
    `/api/market/order-flow${toQueryString({
      accountId,
      symbol,
      resolution,
      from,
      to,
      countBack,
      levels,
      depthLevels,
      limit,
      tickLimit,
    })}`,
    { method: "GET" },
  );
  return response.orderFlow || null;
}

export async function getTradingViewAlerts({ limit, since } = {}) {
  const response = await request(
    `/api/tradingview/alerts${toQueryString({ limit, since })}`,
    { method: "GET" },
  );
  return response.alerts || [];
}

export async function getRayAlgoSignals({ source, symbol, timeframe, from, to, limit } = {}) {
  const response = await request(
    `/api/rayalgo/signals${toQueryString({ source, symbol, timeframe, from, to, limit })}`,
    { method: "GET" },
  );
  return response.signals || [];
}

export async function getAiFusionStatus() {
  return request("/api/ai/fusion/status", { method: "GET" });
}

export async function updateAiFusionConfig(patch) {
  const response = await request("/api/ai/fusion/config", {
    method: "PATCH",
    body: patch,
  });
  return response.config || null;
}

export async function runAiFusionNow(payload = {}) {
  return request("/api/ai/fusion/run", {
    method: "POST",
    body: payload,
  });
}

export async function submitRayAlgoSignals(signals) {
  const response = await request("/api/rayalgo/signals", {
    method: "POST",
    body: Array.isArray(signals) ? { signals } : signals,
  });
  return response;
}

export async function generateLocalRayAlgoSignals(payload) {
  const response = await request("/api/rayalgo/local/generate", {
    method: "POST",
    body: payload,
  });
  return response;
}

export async function getRayAlgoParity({ symbol, timeframe, from, to, windowSec, limit } = {}) {
  const response = await request(
    `/api/rayalgo/parity${toQueryString({ symbol, timeframe, from, to, windowSec, limit })}`,
    { method: "GET" },
  );
  return response;
}

export async function getRayAlgoPolicy() {
  const response = await request("/api/rayalgo/policy", { method: "GET" });
  return response.policy || null;
}

export async function updateRayAlgoPolicy(patch) {
  const response = await request("/api/rayalgo/policy", {
    method: "PATCH",
    body: patch,
  });
  return response.policy || null;
}

export async function getRayAlgoApprovals({ status, limit } = {}) {
  const response = await request(
    `/api/rayalgo/approvals${toQueryString({ status, limit })}`,
    { method: "GET" },
  );
  return response.approvals || [];
}

export async function executeRayAlgoApproval(approvalId, payload = {}) {
  const response = await request(
    `/api/rayalgo/approvals/${encodeURIComponent(approvalId)}/execute`,
    {
      method: "POST",
      body: payload,
    },
  );
  return response;
}

export async function rejectRayAlgoApproval(approvalId, payload = {}) {
  const response = await request(
    `/api/rayalgo/approvals/${encodeURIComponent(approvalId)}/reject`,
    {
      method: "POST",
      body: payload,
    },
  );
  return response;
}

export async function getOptionChain({ accountId, symbol, expiry }) {
  const response = await request(
    `/api/options/chain${toQueryString({ accountId, symbol, expiry })}`,
    { method: "GET" },
  );
  return response.chain || null;
}

export async function getOptionLadder({ accountId, symbol, expiry, right, window }) {
  const response = await request(
    `/api/options/ladder${toQueryString({ accountId, symbol, expiry, right, window })}`,
    { method: "GET" },
  );
  return response.ladder || null;
}

export async function getOptionContracts({
  symbol,
  expiry,
  right,
  broker,
  accountId,
  query,
  limit,
} = {}) {
  const response = await request(
    `/api/options/contracts${toQueryString({
      symbol,
      expiry,
      right,
      broker,
      accountId,
      query,
      limit,
    })}`,
    { method: "GET" },
  );
  return response.contracts || [];
}

export async function getOptionContract(contractId) {
  const response = await request(`/api/options/contracts/${encodeURIComponent(contractId)}`, {
    method: "GET",
  });
  return response.contract || null;
}

export async function getMassiveBacktestStatus({ apiKey, ping = false } = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  const response = await request(
    "/api/backtest/options/massive/status" + toQueryString({ ping: ping ? true : undefined }),
    {
      method: "GET",
      headers,
    },
  );
  return response;
}

export async function getMassiveOptionContracts({
  underlyingTicker,
  contractType,
  expirationDate,
  expirationDateGte,
  expirationDateLte,
  asOf,
  targetStrike,
  strikePrice,
  strikePriceGte,
  strikePriceLte,
  limit = 250,
  expired,
  sort = "strike_price",
  order = "asc",
  apiKey,
} = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  return request(
    "/api/backtest/options/massive/contracts" + toQueryString({
      underlyingTicker,
      contractType,
      expirationDate,
      expirationDateGte,
      expirationDateLte,
      asOf,
      targetStrike,
      strikePrice,
      strikePriceGte,
      strikePriceLte,
      limit,
      expired,
      sort,
      order,
    }),
    {
      method: "GET",
      headers,
    },
  );
}

export async function getMassiveOptionReplayDataset({
  underlyingTicker,
  replayEndDate,
  selectionSpec,
  candidates = [],
  apiKey,
} = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  return request(
    "/api/backtest/options/massive/replay-dataset",
    {
      method: "POST",
      headers,
      timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
      body: {
        underlyingTicker,
        replayEndDate,
        candidates,
        minDte: selectionSpec?.minDte,
        maxDte: selectionSpec?.maxDte,
        strikeSlot: selectionSpec?.strikeSlot,
        moneyness: selectionSpec?.moneyness,
        strikeSteps: selectionSpec?.strikeSteps,
      },
    },
  );
}

export async function runMassiveOptionReplayBacktest({
  marketSymbol,
  bars = [],
  capital,
  executionFidelity,
  strategy,
  dte,
  iv,
  slPct,
  tpPct,
  trailStartPct,
  trailPct,
  zombieBars,
  minConviction,
  allowShorts,
  kellyFrac,
  regimeFilter,
  maxPositions,
  sessionBlocks,
  regimeAdapt,
  commPerContract,
  slipBps,
  tradeDays,
  signalTimeframe,
  rayalgoSettings,
  rayalgoScoringConfig,
  riskStopPolicy,
  optionSelectionSpec,
  backtestV2StageConfig,
  backtestV2RuntimeBridge,
  apiKey,
} = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  return request(
    "/api/backtest/options/massive/run",
    {
      method: "POST",
      headers,
      timeoutMs: BACKTEST_LONG_REQUEST_TIMEOUT_MS,
      body: {
        marketSymbol,
        bars,
        capital,
        executionFidelity,
        strategy,
        dte,
        iv,
        slPct,
        tpPct,
        trailStartPct,
        trailPct,
        zombieBars,
        minConviction,
        allowShorts,
        kellyFrac,
        regimeFilter,
        maxPositions,
        sessionBlocks,
        regimeAdapt,
        commPerContract,
        slipBps,
        tradeDays,
        signalTimeframe,
        rayalgoSettings,
        rayalgoScoringConfig,
        riskStopPolicy,
        optionSelectionSpec,
        backtestV2StageConfig,
        backtestV2RuntimeBridge,
      },
    },
  );
}

function createStreamUnavailableError(message) {
  const error = new Error(message);
  error.code = BACKTEST_STREAM_UNAVAILABLE_ERROR_CODE;
  return error;
}

function processNdjsonBuffer(buffer, onMessage) {
  let remaining = buffer;
  while (remaining.includes("\n")) {
    const newlineIndex = remaining.indexOf("\n");
    const rawLine = remaining.slice(0, newlineIndex).trim();
    remaining = remaining.slice(newlineIndex + 1);
    if (!rawLine) {
      continue;
    }
    const message = safeJson(rawLine);
    if (!message || typeof message !== "object") {
      throw new Error("Invalid stream event.");
    }
    if (typeof onMessage === "function") {
      onMessage(message);
    }
  }
  return remaining;
}

function processBacktestStreamBuffer(buffer, onEvent, finalResultRef) {
  let remaining = buffer;
  while (remaining.includes("\n")) {
    const newlineIndex = remaining.indexOf("\n");
    const rawLine = remaining.slice(0, newlineIndex).trim();
    remaining = remaining.slice(newlineIndex + 1);
    if (!rawLine) {
      continue;
    }
    const event = safeJson(rawLine);
    if (!event?.type) {
      throw new Error("Invalid backtest stream event.");
    }
    if (event.type === "error") {
      const streamError = new Error(event.error || "Backtest stream failed");
      streamError.payload = event.details || null;
      throw streamError;
    }
    if (event.type === "result") {
      finalResultRef.current = event.result || null;
      continue;
    }
    if (typeof onEvent === "function") {
      onEvent(event);
    }
  }
  return remaining;
}

function subscribeEventSource(url, {
  onEvent,
  onError,
  signal,
} = {}) {
  if (typeof EventSource !== "function") {
    return null;
  }

  let closed = false;
  let source = null;
  const abortFromExternalSignal = () => {
    close();
  };
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (signal) {
      signal.removeEventListener("abort", abortFromExternalSignal);
    }
    source?.close?.();
    source = null;
  };

  if (signal) {
    if (signal.aborted) {
      close();
      return null;
    }
    signal.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  source = new EventSource(url);
  source.onmessage = (message) => {
    if (closed) {
      return;
    }
    const payload = safeJson(message?.data || "");
    if (!payload || typeof payload !== "object") {
      close();
      onError?.(new Error("Invalid stream event."));
      return;
    }
    onEvent?.(payload);
  };
  source.onerror = () => {
    if (closed) {
      return;
    }
    close();
    onError?.(createStreamUnavailableError("Browser event stream disconnected."));
  };

  return { close };
}

export function subscribeResearchScoreStudyJobEvents(jobId, options = {}) {
  return subscribeEventSource(
    `${API_BASE}/api/research/score-studies/jobs/${encodeURIComponent(jobId)}/events`,
    options,
  );
}

export function subscribeResearchBacktestJobEvents(jobId, options = {}) {
  return subscribeEventSource(
    `${API_BASE}/api/research/backtests/jobs/${encodeURIComponent(jobId)}/events`,
    options,
  );
}

export async function streamResearchScoreStudyJob(jobId, {
  onEvent,
  signal,
} = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abortFromExternalSignal = () => {
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  };

  if (signal) {
    if (signal.aborted) {
      abortFromExternalSignal();
    } else {
      signal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }

  try {
    const response = await fetch(`${API_BASE}/api/research/score-studies/jobs/${encodeURIComponent(jobId)}/stream`, {
      method: "GET",
      cache: "no-store",
      signal: controller?.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? safeJson(text) : {};
      const error = new Error(payload?.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      throw createStreamUnavailableError("Score-study streaming is unavailable in this environment.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = processNdjsonBuffer(buffer, onEvent);
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer = processNdjsonBuffer(`${buffer}\n`, onEvent);
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortFromExternalSignal);
    }
  }
}

export async function streamResearchBacktestJob(jobId, {
  onEvent,
  signal,
} = {}) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abortFromExternalSignal = () => {
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  };

  if (signal) {
    if (signal.aborted) {
      abortFromExternalSignal();
    } else {
      signal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }

  try {
    const response = await fetch(`${API_BASE}/api/research/backtests/jobs/${encodeURIComponent(jobId)}/stream`, {
      method: "GET",
      cache: "no-store",
      signal: controller?.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? safeJson(text) : {};
      const error = new Error(payload?.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      throw createStreamUnavailableError("Backtest job streaming is unavailable in this environment.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = processNdjsonBuffer(buffer, onEvent);
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer = processNdjsonBuffer(`${buffer}\n`, onEvent);
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortFromExternalSignal);
    }
  }
}

export async function streamMassiveOptionReplayBacktest({
  marketSymbol,
  bars = [],
  capital,
  executionFidelity,
  strategy,
  dte,
  iv,
  slPct,
  tpPct,
  trailStartPct,
  trailPct,
  zombieBars,
  minConviction,
  allowShorts,
  kellyFrac,
  regimeFilter,
  maxPositions,
  sessionBlocks,
  regimeAdapt,
  commPerContract,
  slipBps,
  tradeDays,
  signalTimeframe,
  rayalgoSettings,
  rayalgoScoringConfig,
  riskStopPolicy,
  optionSelectionSpec,
  backtestV2StageConfig,
  backtestV2RuntimeBridge,
  apiKey,
  onEvent,
  signal,
} = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = BACKTEST_STREAM_TIMEOUT_MS;
  const timeoutId = controller
    ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
    : null;
  const abortFromExternalSignal = () => {
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  };

  if (signal) {
    if (signal.aborted) {
      abortFromExternalSignal();
    } else {
      signal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }

  try {
    const response = await fetch(`${API_BASE}/api/backtest/options/massive/run/stream`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(headers || {}),
      },
      body: JSON.stringify({
        marketSymbol,
        bars,
        capital,
        executionFidelity,
        strategy,
        dte,
        iv,
        slPct,
        tpPct,
        trailStartPct,
        trailPct,
        zombieBars,
        minConviction,
        allowShorts,
        kellyFrac,
        regimeFilter,
        maxPositions,
        sessionBlocks,
        regimeAdapt,
        commPerContract,
        slipBps,
        tradeDays,
        signalTimeframe,
        rayalgoSettings,
        rayalgoScoringConfig,
        riskStopPolicy,
        optionSelectionSpec,
        backtestV2StageConfig,
        backtestV2RuntimeBridge,
      }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const payload = text ? safeJson(text) : {};
      const error = new Error(payload?.error || `Request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      throw createStreamUnavailableError("Backtest streaming is unavailable in this environment.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const finalResultRef = { current: null };
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = processBacktestStreamBuffer(buffer, onEvent, finalResultRef);
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      buffer = processBacktestStreamBuffer(`${buffer}\n`, onEvent, finalResultRef);
    }

    if (!finalResultRef.current) {
      throw createStreamUnavailableError("Backtest stream ended before returning a final result.");
    }

    clearGetResponseCache();
    return finalResultRef.current;
  } catch (error) {
    if (error?.code === BACKTEST_STREAM_UNAVAILABLE_ERROR_CODE) {
      throw error;
    }
    throw normalizeRequestError(error, timeoutMs);
  } finally {
    if (timeoutId != null) {
      globalThis.clearTimeout(timeoutId);
    }
    if (signal) {
      signal.removeEventListener("abort", abortFromExternalSignal);
    }
  }
}

export async function getMassiveOptionBars({
  optionTicker,
  from,
  to,
  multiplier = 1,
  timespan = "minute",
  adjusted = true,
  sort = "asc",
  limit = 50000,
  refresh = false,
  apiKey,
} = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  return request(
    "/api/backtest/options/massive/bars" + toQueryString({
      optionTicker,
      from,
      to,
      multiplier,
      timespan,
      adjusted,
      sort,
      limit,
      refresh,
    }),
    {
      method: "GET",
      headers,
      timeoutMs: BACKTEST_REQUEST_TIMEOUT_MS,
      disableMemoryCache: Boolean(refresh),
      cacheTtlMs: refresh ? 0 : undefined,
    },
  );
}

export async function trackMassiveOptionContract({
  trackingId,
  optionTicker,
  label,
  sourceType,
  sourceId,
  openedAt,
  entrySignalTs,
  exitSignalTs,
  apiKey,
} = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  return request("/api/backtest/options/massive/tracking/track", {
    method: "POST",
    headers,
    body: {
      trackingId,
      optionTicker,
      label,
      sourceType,
      sourceId,
      openedAt,
      entrySignalTs,
      exitSignalTs,
    },
  });
}

export async function untrackMassiveOptionContract({ trackingId } = {}) {
  return request("/api/backtest/options/massive/tracking/untrack", {
    method: "POST",
    body: { trackingId },
  });
}

export async function getMassiveOptionTrackingSnapshots({
  trackingIds = [],
  optionTickers = [],
  apiKey,
} = {}) {
  const normalizedKey = String(apiKey || "").trim();
  const headers = normalizedKey
    ? { "x-massive-api-key": normalizedKey }
    : undefined;
  return request(
    "/api/backtest/options/massive/tracking" + toQueryString({
      trackingId: Array.isArray(trackingIds) && trackingIds.length ? trackingIds.join(",") : null,
      optionTicker: Array.isArray(optionTickers) && optionTickers.length ? optionTickers.join(",") : null,
    }),
    {
      method: "GET",
      headers,
      disableMemoryCache: true,
      cacheTtlMs: 0,
    },
  );
}
export async function previewOrder(order) {
  const response = await request("/api/orders/preview", {
    method: "POST",
    body: order,
  });
  return response;
}

export async function preflightOrder(order) {
  const response = await request("/api/orders/preflight", {
    method: "POST",
    body: order,
  });
  return response;
}

export async function submitOrder(order) {
  const response = await request("/api/orders", {
    method: "POST",
    body: order,
  });
  return response.order;
}

export async function getOrders({
  accountId,
  status,
  lifecycleState,
  openOnly,
  from,
  to,
  limit,
} = {}) {
  const response = await request(
    `/api/orders${toQueryString({
      accountId,
      status,
      lifecycleState,
      openOnly,
      from,
      to,
      limit,
    })}`,
    { method: "GET" },
  );
  return response.orders || [];
}

export async function closePosition(positionId, payload) {
  const response = await request(
    `/api/positions/${encodeURIComponent(positionId)}/close`,
    {
      method: "POST",
      body: payload,
    },
  );
  return response.order;
}

export async function getOrder(orderId) {
  const response = await request(`/api/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
  return response.order;
}

export async function getOrderEvents(orderId) {
  const response = await request(`/api/orders/${encodeURIComponent(orderId)}/events`, {
    method: "GET",
  });
  return response.events || [];
}

export async function rapidOptionOrder(payload) {
  const response = await request("/api/options/orders/rapid", {
    method: "POST",
    body: payload,
  });
  return response;
}

async function request(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(500, Number(options.timeoutMs))
    : REQUEST_TIMEOUT_MS;
  const retryCount = Number.isFinite(Number(options.retryCount))
    ? Math.max(0, Math.floor(Number(options.retryCount)))
    : (isSafeRetryMethod(method) ? SAFE_METHOD_RETRY_COUNT : 0);
  const requestUrl = `${API_BASE}${path}`;
  const cacheTtlMs = resolveGetMemoryCacheTtlMs(method, path, options);
  const cacheKey = cacheTtlMs > 0
    ? buildGetCacheKey(method, requestUrl, options)
    : null;

  if (cacheKey) {
    const cached = readGetResponseCache(cacheKey);
    if (cached !== undefined) {
      return cloneResponsePayload(cached);
    }
    const inFlight = INFLIGHT_GET_REQUESTS.get(cacheKey);
    if (inFlight) {
      const shared = await inFlight;
      return cloneResponsePayload(shared);
    }
  }

  const performRequest = async () => {
    let attempt = 0;
    while (attempt <= retryCount) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeoutId = controller
        ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
        : null;

      try {
        const response = await fetch(requestUrl, {
          method,
          cache: options.cache || "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller?.signal,
        });

        const text = await response.text();
        const payload = text ? safeJson(text) : {};

        if (!response.ok) {
          const error = new Error(payload?.error || `Request failed (${response.status})`);
          error.status = response.status;
          error.payload = payload;
          throw error;
        }

        return payload;
      } catch (error) {
        const normalized = normalizeRequestError(error, timeoutMs);
        if (attempt >= retryCount || !isRetryableFailure(normalized, method)) {
          throw normalized;
        }
        await sleep(backoffDelayMs(attempt));
        attempt += 1;
      } finally {
        if (timeoutId != null) {
          globalThis.clearTimeout(timeoutId);
        }
      }
    }

    throw new Error("Request failed");
  };

  if (cacheKey) {
    const cacheEpoch = GET_CACHE_EPOCH;
    const task = performRequest()
      .then((payload) => {
        if (cacheEpoch === GET_CACHE_EPOCH) {
          writeGetResponseCache(cacheKey, payload, cacheTtlMs);
        }
        return payload;
      })
      .finally(() => {
        INFLIGHT_GET_REQUESTS.delete(cacheKey);
      });
    INFLIGHT_GET_REQUESTS.set(cacheKey, task);
    const result = await task;
    return cloneResponsePayload(result);
  }

  const result = await performRequest();
  if (!isSafeRetryMethod(method)) {
    clearGetResponseCache();
  }
  return result;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function toQueryString(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === "" || value === "all") {
      continue;
    }
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

function parsePositiveNumber(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  return fallback;
}

function resolveGetMemoryCacheTtlMs(method, path, options = {}) {
  if (method !== "GET") {
    return 0;
  }
  if (options.disableMemoryCache) {
    return 0;
  }
  if (Number.isFinite(Number(options.cacheTtlMs))) {
    return Math.max(0, Math.round(Number(options.cacheTtlMs)));
  }

  const route = String(path || "").split("?")[0] || "";
  if (!route) {
    return 0;
  }

  if (hasBypassRefreshQuery(path)) {
    return 0;
  }

  if (FAST_CACHE_PREFIXES.some((prefix) => route.startsWith(prefix))) {
    return GET_RESPONSE_CACHE_TTL_FAST_MS;
  }
  if (SLOW_CACHE_PREFIXES.some((prefix) => route.startsWith(prefix))) {
    return GET_RESPONSE_CACHE_TTL_SLOW_MS;
  }
  return 0;
}

function buildGetCacheKey(method, requestUrl, options = {}) {
  const customKey = String(options.cacheKey || "").trim();
  if (customKey) {
    return `${method}:${customKey}`;
  }
  const headerText =
    options.headers && typeof options.headers === "object"
      ? Object.entries(options.headers)
          .map(([key, value]) => `${String(key).toLowerCase()}:${String(value)}`)
          .sort()
          .join("|")
      : "";
  return `${method}:${requestUrl}|${headerText}`;
}

function readGetResponseCache(cacheKey) {
  const entry = GET_RESPONSE_CACHE.get(cacheKey);
  if (!entry) {
    return undefined;
  }
  if (Number(entry.expiresAt) <= Date.now()) {
    GET_RESPONSE_CACHE.delete(cacheKey);
    return undefined;
  }
  return entry.payload;
}

function writeGetResponseCache(cacheKey, payload, ttlMs) {
  const safeTtlMs = Number.isFinite(Number(ttlMs))
    ? Math.max(0, Math.round(Number(ttlMs)))
    : GET_RESPONSE_CACHE_TTL_MS;
  if (safeTtlMs <= 0) {
    return;
  }
  GET_RESPONSE_CACHE.set(cacheKey, {
    payload: cloneResponsePayload(payload),
    expiresAt: Date.now() + safeTtlMs,
  });
  pruneGetResponseCache();
}

function pruneGetResponseCache() {
  const maxEntries = Math.max(10, Math.round(GET_RESPONSE_CACHE_MAX_ENTRIES));
  if (GET_RESPONSE_CACHE.size <= maxEntries) {
    return;
  }
  const entries = [...GET_RESPONSE_CACHE.entries()].sort(
    (a, b) => Number(a[1]?.expiresAt || 0) - Number(b[1]?.expiresAt || 0),
  );
  const removeCount = GET_RESPONSE_CACHE.size - maxEntries;
  for (let index = 0; index < removeCount; index += 1) {
    GET_RESPONSE_CACHE.delete(entries[index][0]);
  }
}

function clearGetResponseCache() {
  GET_CACHE_EPOCH += 1;
  GET_RESPONSE_CACHE.clear();
  INFLIGHT_GET_REQUESTS.clear();
}

function cloneResponsePayload(payload) {
  if (payload == null || typeof payload !== "object") {
    return payload;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(payload);
  }
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
}

function hasBypassRefreshQuery(path) {
  const text = String(path || "");
  const queryIndex = text.indexOf("?");
  if (queryIndex < 0) {
    return false;
  }
  const params = new URLSearchParams(text.slice(queryIndex + 1));
  const refresh = String(params.get("refresh") || "").toLowerCase();
  if (refresh === "1" || refresh === "true") {
    return true;
  }
  const cacheBypass = String(params.get("cacheBypass") || params.get("noCache") || "").toLowerCase();
  return cacheBypass === "1" || cacheBypass === "true";
}

function isSafeRetryMethod(method) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function isRetryableFailure(error, method) {
  if (!isSafeRetryMethod(method)) {
    return false;
  }
  const status = Number(error?.status || 0);
  if (status === 408 || status === 425 || status === 429) {
    return true;
  }
  if (status >= 500 && status <= 599) {
    return true;
  }
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("networkerror")
    || message.includes("network request failed")
    || message.includes("failed to fetch")
    || message.includes("timed out")
    || message.includes("abort")
  );
}

function normalizeRequestError(error, timeoutMs) {
  if (error?.name === "AbortError") {
    const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs)}ms`);
    timeoutError.status = 408;
    timeoutError.payload = {};
    return timeoutError;
  }
  return error;
}

function backoffDelayMs(attempt) {
  const jitter = Math.floor(Math.random() * 120);
  const exponential = Math.min(2200, 250 * (2 ** attempt));
  return exponential + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
