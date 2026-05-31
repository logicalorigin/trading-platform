import path from "node:path";
import { pathToFileURL } from "node:url";

export type JsonRecord = Record<string, unknown>;

export type PortfolioObjective =
  | "max_return"
  | "min_variance"
  | "risk_parity";

export type PortfolioOptimizationInput = {
  positions: Array<{
    symbol: string;
    currentWeight: number;
    expectedReturn: number;
  }>;
  returns: Array<{
    symbol: string;
    values: number[];
  }>;
  objective: PortfolioObjective;
  constraints: {
    longOnly: true;
    maxWeight?: number;
    maxTurnover?: number;
  };
};

type CliOptions = {
  apiBaseUrl: string;
  computeBaseUrl: string | null;
  objective: PortfolioObjective;
  maxWeight: number | null;
  maxTurnover: number | null;
  timeoutMs: number;
  json: boolean;
};

type FetchResult<T> =
  | { ok: true; value: T; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

const DEFAULT_API_BASE_URL =
  process.env["API_BASE_URL"] ?? "http://127.0.0.1:18747/api";

const SAMPLE_RETURNS: PortfolioOptimizationInput["returns"] = [
  { symbol: "SPY", values: [0.006, -0.004, 0.005, 0.002, -0.001, 0.004] },
  { symbol: "QQQ", values: [0.009, -0.007, 0.008, 0.004, -0.003, 0.006] },
  { symbol: "TLT", values: [-0.002, 0.003, -0.001, 0.002, 0.004, -0.001] },
];

const SAMPLE_POSITIONS: PortfolioOptimizationInput["positions"] = [
  { symbol: "SPY", currentWeight: 0.5, expectedReturn: 0.00045 },
  { symbol: "QQQ", currentWeight: 0.3, expectedReturn: 0.0006 },
  { symbol: "TLT", currentWeight: 0.2, expectedReturn: 0.0002 },
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apiBaseUrl:
      process.env["PYRUS_PORTFOLIO_OPTIMIZATION_API_BASE_URL"] ??
      DEFAULT_API_BASE_URL,
    computeBaseUrl:
      process.env["PYRUS_PORTFOLIO_OPTIMIZATION_COMPUTE_BASE_URL"] ?? null,
    objective: parseObjective(
      process.env["PYRUS_PORTFOLIO_OPTIMIZATION_OBJECTIVE"] ?? "",
      "min_variance",
    ),
    maxWeight: parseOptionalUnitNumber(
      process.env["PYRUS_PORTFOLIO_OPTIMIZATION_MAX_WEIGHT"] ?? "",
    ),
    maxTurnover: parseOptionalBoundedNumber(
      process.env["PYRUS_PORTFOLIO_OPTIMIZATION_MAX_TURNOVER"] ?? "",
      0,
      2,
    ),
    timeoutMs: parsePositiveInteger(
      process.env["PYRUS_PORTFOLIO_OPTIMIZATION_TIMEOUT_MS"] ?? "",
      30_000,
    ),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") continue;
    const next = argv[index + 1];
    const [flag, inlineValue] = token.includes("=")
      ? (token.split(/=(.*)/s, 2) as [string, string])
      : [token, undefined];
    const value = inlineValue ?? next;

    if (
      [
        "--api-base-url",
        "--compute-base-url",
        "--objective",
        "--max-weight",
        "--max-turnover",
        "--timeout-ms",
      ].includes(flag) &&
      !value
    ) {
      throw new Error(`${flag} requires a value.`);
    }

    if (flag === "--api-base-url") {
      options.apiBaseUrl = value as string;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--compute-base-url") {
      options.computeBaseUrl = value as string;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--objective") {
      options.objective = parseObjective(value ?? "", options.objective);
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--max-weight") {
      options.maxWeight = parseRequiredUnitNumber(value ?? "", "--max-weight");
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--max-turnover") {
      options.maxTurnover = parseRequiredBoundedNumber(
        value ?? "",
        "--max-turnover",
        0,
        2,
        true,
      );
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(value ?? "", options.timeoutMs);
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

function parseObjective(raw: string, fallback: PortfolioObjective): PortfolioObjective {
  if (raw === "max_return" || raw === "min_variance" || raw === "risk_parity") {
    return raw;
  }
  if (!raw) return fallback;
  throw new Error("--objective must be min_variance, risk_parity, or max_return.");
}

function parsePositiveInteger(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseOptionalUnitNumber(raw: string): number | null {
  return raw ? parseRequiredUnitNumber(raw, "maxWeight") : null;
}

function parseRequiredUnitNumber(raw: string, label: string): number {
  return parseRequiredBoundedNumber(raw, label, 0, 1);
}

function parseOptionalBoundedNumber(
  raw: string,
  minimum: number,
  maximum: number,
): number | null {
  return raw ? parseRequiredBoundedNumber(raw, "value", minimum, maximum, true) : null;
}

function parseRequiredBoundedNumber(
  raw: string,
  label: string,
  minimum: number,
  maximum: number,
  allowMinimum = false,
): number {
  const parsed = Number(raw);
  const belowMinimum = allowMinimum ? parsed < minimum : parsed <= minimum;
  if (!Number.isFinite(parsed) || belowMinimum || parsed > maximum) {
    const lowerBound = allowMinimum ? `>= ${minimum}` : `greater than ${minimum}`;
    throw new Error(`${label} must be ${lowerBound} and <= ${maximum}.`);
  }
  return parsed;
}

export function buildPortfolioOptimizationInput(options: {
  objective: PortfolioObjective;
  maxWeight: number | null;
  maxTurnover: number | null;
}): PortfolioOptimizationInput {
  const constraints: PortfolioOptimizationInput["constraints"] = {
    longOnly: true,
  };
  if (options.maxWeight !== null) {
    constraints.maxWeight = options.maxWeight;
  }
  if (options.maxTurnover !== null) {
    constraints.maxTurnover = options.maxTurnover;
  }
  return {
    positions: SAMPLE_POSITIONS.map((position) => ({ ...position })),
    returns: SAMPLE_RETURNS.map((series) => ({
      symbol: series.symbol,
      values: [...series.values],
    })),
    objective: options.objective,
    constraints,
  };
}

export function buildUrl(baseUrl: string, requestPath: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(requestPath.replace(/^\/+/, ""), base).toString();
}

async function fetchJson<T extends JsonRecord>(
  baseUrl: string,
  requestPath: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(buildUrl(baseUrl, requestPath), {
      ...init,
      headers,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    const value = (await response.json()) as T;
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}: ${JSON.stringify(value)}`,
        latencyMs,
      };
    }
    return { ok: true, value, latencyMs };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function readString(record: JsonRecord | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(record: JsonRecord | null | undefined, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readPythonComputeDiagnostics(runtime: JsonRecord): JsonRecord | null {
  return (
    readRecord(readRecord(runtime["probes"])?.["pythonCompute"]) ??
    readRecord(readRecord(runtime["api"])?.["pythonCompute"]) ??
    readRecord(runtime["pythonCompute"])
  );
}

export function hasPortfolioOptimizationCapability(
  capabilities: JsonRecord | null,
): boolean {
  return asArray(capabilities?.["capabilities"])
    .filter(isRecord)
    .some((capability) => capability["jobType"] === "portfolio_optimization");
}

function summarizeCapabilities(capabilities: JsonRecord | null): JsonRecord {
  const jobTypes = asArray(capabilities?.["capabilities"])
    .filter(isRecord)
    .map((capability) => readString(capability, "jobType"))
    .filter((jobType): jobType is string => jobType !== null);
  return {
    service: readString(capabilities, "service"),
    jobTypes,
    hasPortfolioOptimization: jobTypes.includes("portfolio_optimization"),
  };
}

export function summarizePortfolioOptimizationJob(job: JsonRecord | null): JsonRecord {
  const result = readRecord(job?.["result"]);
  const allocations = asArray(result?.["allocations"])
    .filter(isRecord)
    .map((allocation) => ({
      symbol: readString(allocation, "symbol"),
      currentWeight: readNumber(allocation, "currentWeight"),
      proposedWeight: readNumber(allocation, "proposedWeight"),
      deltaWeight: readNumber(allocation, "deltaWeight"),
      riskContribution: readNumber(allocation, "riskContribution"),
      expectedReturn: readNumber(allocation, "expectedReturn"),
    }));

  return {
    jobId: readString(job, "jobId"),
    status: readString(job, "status"),
    durationMs: readNumber(job, "durationMs"),
    warnings: asArray(job?.["warnings"]).filter(
      (warning): warning is string => typeof warning === "string",
    ),
    error: readRecord(job?.["error"]),
    advisoryOnly: result?.["advisoryOnly"] === true,
    objective: readString(result, "objective"),
    turnover: readNumber(result, "turnover"),
    portfolioVariance: readNumber(result, "portfolioVariance"),
    portfolioVolatility: readNumber(result, "portfolioVolatility"),
    concentration: readRecord(result?.["concentration"]),
    resultWarnings: asArray(result?.["warnings"]).filter(
      (warning): warning is string => typeof warning === "string",
    ),
    allocationCount: allocations.length,
    allocations,
  };
}

async function runPortfolioOptimizationJob(
  computeBaseUrl: string,
  input: PortfolioOptimizationInput,
  timeoutMs: number,
): Promise<JsonRecord> {
  const accepted = await fetchJson<JsonRecord>(
    computeBaseUrl,
    "/jobs",
    timeoutMs,
    {
      method: "POST",
      body: JSON.stringify({
        jobType: "portfolio_optimization",
        schemaVersion: 1,
        input,
        options: { timeoutMs },
      }),
    },
  );
  if (!accepted.ok) {
    throw new Error(`Portfolio optimization job submission failed: ${accepted.error}`);
  }

  const jobId = readString(accepted.value, "jobId");
  if (!jobId) {
    throw new Error("Portfolio optimization job submission did not return a job id.");
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remainingMs = Math.max(250, deadline - Date.now());
    const job = await fetchJson<JsonRecord>(
      computeBaseUrl,
      `/jobs/${encodeURIComponent(jobId)}`,
      remainingMs,
    );
    if (!job.ok) {
      throw new Error(`Portfolio optimization job fetch failed: ${job.error}`);
    }
    const status = readString(job.value, "status");
    if (status === "completed" || status === "failed" || status === "cancelled") {
      return job.value;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, remainingMs)));
  }

  await fetchJson<JsonRecord>(
    computeBaseUrl,
    `/jobs/${encodeURIComponent(jobId)}/cancel`,
    1_000,
    { method: "POST" },
  ).catch(() => null);
  throw new Error(`Portfolio optimization job ${jobId} timed out after ${timeoutMs}ms.`);
}

function computeBaseUrlFromDiagnostics(diagnostics: JsonRecord | null): string | null {
  const host = readString(diagnostics, "host");
  const port = readNumber(diagnostics, "port");
  if (!host || port === null) return null;
  return `http://${host}:${port}`;
}

function summarizePythonCompute(
  diagnostics: JsonRecord | null,
  computeBaseUrl: string,
  health: FetchResult<JsonRecord>,
): JsonRecord {
  const healthOk = health.ok && health.value["ok"] === true;
  return {
    ...(diagnostics ?? {}),
    enabled: diagnostics?.["enabled"] ?? true,
    status: healthOk ? (readString(diagnostics, "status") ?? "healthy") : "degraded",
    computeBaseUrl,
    healthOk,
    healthError: health.ok ? null : health.error,
  };
}

export function statusExitCode(summary: JsonRecord): number {
  const python = readRecord(summary["pythonCompute"]);
  const capabilities = readRecord(summary["capabilities"]);
  const optimization = readRecord(summary["portfolioOptimization"]);

  if (python?.["enabled"] !== true || python["status"] !== "healthy") {
    return 2;
  }
  if (python["healthOk"] === false) {
    return 2;
  }
  if (capabilities?.["hasPortfolioOptimization"] !== true) {
    return 2;
  }
  if (
    optimization?.["status"] !== "completed" ||
    optimization["advisoryOnly"] !== true ||
    optimization["error"] !== null
  ) {
    return 2;
  }
  return 0;
}

function printHuman(summary: JsonRecord): void {
  const python = readRecord(summary["pythonCompute"]);
  const capabilities = readRecord(summary["capabilities"]);
  const optimization = readRecord(summary["portfolioOptimization"]);
  const concentration = readRecord(optimization?.["concentration"]);

  console.log("PYRUS Portfolio Optimization Inspection");
  console.log(`apiBaseUrl: ${summary["apiBaseUrl"]}`);
  console.log(`computeBaseUrl: ${summary["computeBaseUrl"]}`);
  console.log(
    `pythonCompute: enabled=${String(python?.["enabled"])} status=${String(
      python?.["status"],
    )} healthOk=${String(python?.["healthOk"])} pid=${String(
      python?.["pid"] ?? "n/a",
    )}`,
  );
  console.log(
    `capabilities: hasPortfolioOptimization=${String(
      capabilities?.["hasPortfolioOptimization"],
    )} jobTypes=${JSON.stringify(capabilities?.["jobTypes"] ?? [])}`,
  );
  console.log(
    `job: status=${String(optimization?.["status"])} advisoryOnly=${String(
      optimization?.["advisoryOnly"],
    )} durationMs=${String(optimization?.["durationMs"] ?? "n/a")}`,
  );
  console.log(
    `objective=${String(optimization?.["objective"])} turnover=${String(
      optimization?.["turnover"],
    )} variance=${String(optimization?.["portfolioVariance"])} volatility=${String(
      optimization?.["portfolioVolatility"],
    )}`,
  );
  console.log(
    `concentration: top=${String(concentration?.["topSymbol"] ?? "n/a")} maxWeight=${String(
      concentration?.["maxWeight"] ?? "n/a",
    )} effectiveCount=${String(
      concentration?.["effectivePositionCount"] ?? "n/a",
    )}`,
  );
  console.log(
    `warnings: ${JSON.stringify([
      ...asArray(optimization?.["warnings"]),
      ...asArray(optimization?.["resultWarnings"]),
    ])}`,
  );
  console.log(`allocations: ${JSON.stringify(optimization?.["allocations"] ?? [])}`);
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @workspace/scripts run pyrus:portfolio-optimization -- [options]

Options:
  --api-base-url URL          API base URL, default ${DEFAULT_API_BASE_URL}
  --compute-base-url URL      Direct Python compute URL; if omitted, discovered from runtime diagnostics
  --objective NAME            min_variance, risk_parity, or max_return; default min_variance
  --max-weight N              Optional max proposed weight, > 0 and <= 1
  --max-turnover N            Optional turnover cap, >= 0 and <= 2
  --timeout-ms N              Request and job timeout, default 30000
  --json                      Print raw summary JSON

This inspector submits a deterministic sample portfolio_optimization job only.
It does not read broker state, write account state, create orders, or expose UI/API surfaces.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let runtime: FetchResult<JsonRecord> | null = null;
  let diagnostics: JsonRecord | null = null;
  let computeBaseUrl = options.computeBaseUrl;

  if (!computeBaseUrl) {
    runtime = await fetchJson<JsonRecord>(
      options.apiBaseUrl,
      "/diagnostics/runtime",
      options.timeoutMs,
    );
    if (!runtime.ok) {
      throw new Error(`Runtime diagnostics failed: ${runtime.error}`);
    }
    diagnostics = readPythonComputeDiagnostics(runtime.value);
    computeBaseUrl = computeBaseUrlFromDiagnostics(diagnostics);
    if (!computeBaseUrl) {
      throw new Error("Runtime diagnostics did not include a Python compute host and port.");
    }
  }

  const [health, capabilities] = await Promise.all([
    fetchJson<JsonRecord>(computeBaseUrl, "/health", options.timeoutMs),
    fetchJson<JsonRecord>(computeBaseUrl, "/capabilities", options.timeoutMs),
  ]);
  if (!health.ok) {
    throw new Error(`Python compute health check failed: ${health.error}`);
  }
  if (!capabilities.ok) {
    throw new Error(`Python compute capabilities failed: ${capabilities.error}`);
  }

  const input = buildPortfolioOptimizationInput(options);
  const job = await runPortfolioOptimizationJob(
    computeBaseUrl,
    input,
    options.timeoutMs,
  );
  const summary: JsonRecord = {
    checkedAt: new Date().toISOString(),
    apiBaseUrl: options.apiBaseUrl,
    computeBaseUrl,
    discovery: runtime
      ? { runtimeLatencyMs: runtime.latencyMs, source: "api-runtime-diagnostics" }
      : { source: "direct-compute-url" },
    request: {
      objective: input.objective,
      constraints: input.constraints,
      sampleSymbols: input.positions.map((position) => position.symbol),
    },
    latenciesMs: {
      health: health.latencyMs,
      capabilities: capabilities.latencyMs,
    },
    pythonCompute: summarizePythonCompute(diagnostics, computeBaseUrl, health),
    capabilities: summarizeCapabilities(capabilities.value),
    portfolioOptimization: summarizePortfolioOptimizationJob(job),
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary);
  }
  process.exitCode = statusExitCode(summary);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
