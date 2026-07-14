import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";

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
  help: boolean;
};

type FetchResult<T> =
  | { ok: true; value: T; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

const DEFAULT_API_BASE_URL = "http://127.0.0.1:18747/api";
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 300_000;
// ponytail: 16 MiB bounds remote JSON in memory while leaving headroom above
// measured runtime diagnostics. Stream selected fields if that payload reaches it.
const MAX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_LOG_STRING_LENGTH = 1_000;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const UNSAFE_JSON_OUTPUT_PATTERN =
  /[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const USAGE = `Usage:
  pnpm --filter @workspace/scripts run pyrus:portfolio-optimization -- [options]

Options:
  --api-base-url URL          API base URL, default ${DEFAULT_API_BASE_URL}
  --compute-base-url URL      Direct Python compute URL; if omitted, discovered from runtime diagnostics
  --objective NAME            min_variance, risk_parity, or max_return; default min_variance
  --max-weight N              Optional max proposed weight, > 0 and <= 1
  --max-turnover N            Optional turnover cap, >= 0 and <= 2
  --timeout-ms N              Request and job timeout, 100-300000; default 30000
  --json                      Print raw summary JSON`;

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

function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  try {
    const parsed = parseNodeArgs({
      args: argv[0] === "--" ? argv.slice(1) : argv,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        "api-base-url": { type: "string" },
        "compute-base-url": { type: "string" },
        objective: { type: "string" },
        "max-weight": { type: "string" },
        "max-turnover": { type: "string" },
        "timeout-ms": { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    const counts = new Map<string, number>();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      counts.set(token.name, (counts.get(token.name) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count > 1)) {
      throw new Error("Duplicate options are not allowed.");
    }

    const computeBaseUrl =
      parsed.values["compute-base-url"] ??
      stringValue(env["PYRUS_PORTFOLIO_OPTIMIZATION_COMPUTE_BASE_URL"]);
    return {
      apiBaseUrl: parseHttpUrl(
        "--api-base-url",
        parsed.values["api-base-url"] ??
          stringValue(env["PYRUS_PORTFOLIO_OPTIMIZATION_API_BASE_URL"]) ??
          stringValue(env["API_BASE_URL"]) ??
          DEFAULT_API_BASE_URL,
      ),
      computeBaseUrl: computeBaseUrl
        ? parseHttpUrl("--compute-base-url", computeBaseUrl)
        : null,
      objective: parseObjective(
        parsed.values.objective ??
          stringValue(env["PYRUS_PORTFOLIO_OPTIMIZATION_OBJECTIVE"]) ??
          "",
        "min_variance",
      ),
      maxWeight: parseOptionalUnitNumber(
        parsed.values["max-weight"] ??
          stringValue(env["PYRUS_PORTFOLIO_OPTIMIZATION_MAX_WEIGHT"]) ??
          "",
      ),
      maxTurnover: parseOptionalBoundedNumber(
        parsed.values["max-turnover"] ??
          stringValue(env["PYRUS_PORTFOLIO_OPTIMIZATION_MAX_TURNOVER"]) ??
          "",
        0,
        2,
      ),
      timeoutMs: parsePositiveInteger(
        "--timeout-ms",
        parsed.values["timeout-ms"] ??
          stringValue(env["PYRUS_PORTFOLIO_OPTIMIZATION_TIMEOUT_MS"]) ??
          undefined,
        30_000,
      ),
      json: parsed.values.json ?? false,
      help: parsed.values.help ?? false,
    };
  } catch (error) {
    throw new Error(`${USAGE}\n${errorMessage(error)}`);
  }
}

function parseObjective(raw: string, fallback: PortfolioObjective): PortfolioObjective {
  if (raw === "max_return" || raw === "min_variance" || raw === "risk_parity") {
    return raw;
  }
  if (!raw) return fallback;
  throw new Error("--objective must be min_variance, risk_parity, or max_return.");
}

function parsePositiveInteger(
  label: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`${label} must be a canonical integer.`);
  }
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TIMEOUT_MS ||
    parsed > MAX_TIMEOUT_MS
  ) {
    throw new Error(`${label} must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseHttpUrl(label: string, raw: string): string {
  const value = raw.trim();
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must be a credential-free HTTP(S) URL without a query or fragment.`,
    );
  }
  return value;
}

function safeText(value: unknown): string {
  const cleaned = stripVTControlCharacters(
    String(value ?? "").replace(
      /([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu,
      "$1[redacted]@",
    ),
  )
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length <= MAX_LOG_STRING_LENGTH
    ? cleaned
    : `${cleaned.slice(0, MAX_LOG_STRING_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return (
    safeText(error instanceof Error ? error.message : error) ||
    "Unknown portfolio optimization inspector error"
  );
}

function jsonText(value: unknown, space?: number): string {
  return (JSON.stringify(value, null, space) ?? "").replace(
    UNSAFE_JSON_OUTPUT_PATTERN,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
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

async function readResponseText(
  response: Response,
  maximumBytes = MAX_JSON_RESPONSE_BYTES,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`JSON response exceeded the ${maximumBytes}-byte limit.`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`JSON response exceeded the ${maximumBytes}-byte limit.`);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
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
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        latencyMs: Date.now() - startedAt,
      };
    }
    let value: unknown;
    try {
      value = JSON.parse(await readResponseText(response)) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Invalid JSON response.");
      }
      throw error;
    }
    if (!isRecord(value)) {
      throw new Error("Expected a JSON object response.");
    }
    const latencyMs = Date.now() - startedAt;
    return { ok: true, value: value as T, latencyMs };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : errorMessage(error),
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
  return (
    capabilities?.["service"] === "pyrus-compute" &&
    asArray(capabilities["capabilities"])
      .filter(isRecord)
      .some(
        (capability) =>
          capability["jobType"] === "portfolio_optimization" &&
          capability["schemaVersion"] === 1,
      )
  );
}

function summarizeCapabilities(capabilities: JsonRecord | null): JsonRecord {
  const jobTypes = asArray(capabilities?.["capabilities"])
    .filter(isRecord)
    .map((capability) => readString(capability, "jobType"))
    .filter((jobType): jobType is string => jobType !== null);
  return {
    service: readString(capabilities, "service"),
    jobTypes,
    hasPortfolioOptimization: hasPortfolioOptimizationCapability(capabilities),
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
    jobType: readString(job, "jobType"),
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
    constraints: readRecord(result?.["constraints"]),
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
  let terminal = false;
  try {
    while (Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
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
        terminal = true;
        return job.value;
      }
      const waitMs = Math.min(100, deadline - Date.now());
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    throw new Error(`Portfolio optimization job ${jobId} timed out after ${timeoutMs}ms.`);
  } finally {
    if (!terminal) {
      await fetchJson<JsonRecord>(
        computeBaseUrl,
        `/jobs/${encodeURIComponent(jobId)}/cancel`,
        1_000,
        { method: "POST" },
      ).catch(() => null);
    }
  }
}

function computeBaseUrlFromDiagnostics(diagnostics: JsonRecord | null): string | null {
  const host = readString(diagnostics, "host");
  const port = readNumber(diagnostics, "port");
  if (
    !host ||
    port === null ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return null;
  }
  const normalizedHost = host.replace(/^\[|\]$/gu, "");
  const authority = normalizedHost.includes(":")
    ? `[${normalizedHost}]`
    : normalizedHost;
  try {
    const url = new URL(`http://${authority}:${port}`);
    const effectivePort = url.port ? Number(url.port) : 80;
    return url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      effectivePort !== port
      ? null
      : url.origin;
  } catch {
    return null;
  }
}

function summarizePythonCompute(
  diagnostics: JsonRecord | null,
  computeBaseUrl: string,
  health: FetchResult<JsonRecord>,
): JsonRecord {
  const healthOk =
    health.ok &&
    health.value["ok"] === true &&
    health.value["service"] === "pyrus-compute";
  return {
    ...(diagnostics ?? {}),
    enabled: diagnostics?.["enabled"] ?? true,
    status: healthOk ? (readString(diagnostics, "status") ?? "healthy") : "degraded",
    computeBaseUrl,
    healthOk,
    healthService: health.ok ? readString(health.value, "service") : null,
    healthError: health.ok ? null : health.error,
  };
}

function hasValidPortfolioOptimizationResult(summary: JsonRecord): boolean {
  const request = readRecord(summary["request"]);
  const optimization = readRecord(summary["portfolioOptimization"]);
  const requestedObjective = readString(request, "objective");
  const requestedConstraints = readRecord(request?.["constraints"]);
  const resultConstraints = readRecord(optimization?.["constraints"]);
  const concentration = readRecord(optimization?.["concentration"]);
  const concentrationMaxWeight = readNumber(concentration, "maxWeight");
  const concentrationTopSymbol = readString(concentration, "topSymbol");
  const effectivePositionCount = readNumber(
    concentration,
    "effectivePositionCount",
  );
  const requestedSymbolsRaw = asArray(request?.["sampleSymbols"]);
  const allocationsRaw = asArray(optimization?.["allocations"]);
  if (
    !optimization ||
    !readString(optimization, "jobId") ||
    readString(optimization, "jobType") !== "portfolio_optimization" ||
    !requestedObjective ||
    requestedObjective !== readString(optimization, "objective") ||
    requestedConstraints?.["longOnly"] !== true ||
    resultConstraints?.["longOnly"] !== true ||
    concentrationMaxWeight === null ||
    !concentrationTopSymbol ||
    effectivePositionCount === null ||
    ["maxWeight", "maxTurnover"].some((key) => {
      const requested = requestedConstraints?.[key] ?? null;
      const result = resultConstraints?.[key] ?? null;
      return (
        requested !== result ||
        (requested !== null &&
          (typeof requested !== "number" || !Number.isFinite(requested)))
      );
    }) ||
    requestedSymbolsRaw.length === 0 ||
    requestedSymbolsRaw.some(
      (symbol) => typeof symbol !== "string" || !symbol.trim(),
    ) ||
    allocationsRaw.length !== requestedSymbolsRaw.length ||
    readNumber(optimization, "allocationCount") !== allocationsRaw.length ||
    ["turnover", "portfolioVariance", "portfolioVolatility"].some((key) => {
      const value = readNumber(optimization, key);
      return value === null || value < 0;
    })
  ) {
    return false;
  }

  const requestedSymbols = requestedSymbolsRaw.map((symbol) =>
    (symbol as string).trim(),
  );
  const allocationSymbols = new Set<string>();
  const proposedWeights = new Map<string, number>();
  let currentWeightTotal = 0;
  let proposedWeightTotal = 0;
  let proposedWeightSquares = 0;
  for (const value of allocationsRaw) {
    const allocation = readRecord(value);
    const symbol = readString(allocation, "symbol");
    const currentWeight = readNumber(allocation, "currentWeight");
    const proposedWeight = readNumber(allocation, "proposedWeight");
    const deltaWeight = readNumber(allocation, "deltaWeight");
    if (
      !symbol ||
      !requestedSymbols.includes(symbol) ||
      allocationSymbols.has(symbol) ||
      currentWeight === null ||
      currentWeight < 0 ||
      proposedWeight === null ||
      proposedWeight < 0 ||
      deltaWeight === null ||
      Math.abs(currentWeight + deltaWeight - proposedWeight) > 0.000_01 ||
      ["riskContribution", "expectedReturn"].some(
        (key) => readNumber(allocation, key) === null,
      )
    ) {
      return false;
    }
    allocationSymbols.add(symbol);
    proposedWeights.set(symbol, proposedWeight);
    currentWeightTotal += currentWeight;
    proposedWeightTotal += proposedWeight;
    proposedWeightSquares += proposedWeight ** 2;
  }
  const maxProposedWeight = Math.max(...proposedWeights.values());
  const topProposedWeight = proposedWeights.get(concentrationTopSymbol);
  return (
    Math.abs(currentWeightTotal - 1) <= 0.000_01 &&
    Math.abs(proposedWeightTotal - 1) <= 0.000_01 &&
    Math.abs(concentrationMaxWeight - maxProposedWeight) <= 0.000_01 &&
    topProposedWeight !== undefined &&
    Math.abs(topProposedWeight - maxProposedWeight) <= 0.000_01 &&
    proposedWeightSquares > 0 &&
    Math.abs(effectivePositionCount - 1 / proposedWeightSquares) <= 0.000_01
  );
}

export function statusExitCode(summary: JsonRecord): number {
  const python = readRecord(summary["pythonCompute"]);
  const capabilities = readRecord(summary["capabilities"]);
  const optimization = readRecord(summary["portfolioOptimization"]);

  if (
    python?.["enabled"] !== true ||
    python["status"] !== "healthy" ||
    python["healthService"] !== "pyrus-compute"
  ) {
    return 2;
  }
  if (python["healthOk"] !== true) {
    return 2;
  }
  if (
    capabilities?.["service"] !== "pyrus-compute" ||
    capabilities["hasPortfolioOptimization"] !== true
  ) {
    return 2;
  }
  if (
    optimization?.["status"] !== "completed" ||
    optimization["advisoryOnly"] !== true ||
    optimization["error"] !== null ||
    !hasValidPortfolioOptimizationResult(summary)
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
  const log = (line: string) => console.log(safeText(line));

  log("PYRUS Portfolio Optimization Inspection");
  log(`apiBaseUrl: ${summary["apiBaseUrl"]}`);
  log(`computeBaseUrl: ${summary["computeBaseUrl"]}`);
  log(
    `pythonCompute: enabled=${String(python?.["enabled"])} status=${String(
      python?.["status"],
    )} healthOk=${String(python?.["healthOk"])} pid=${String(
      python?.["pid"] ?? "n/a",
    )}`,
  );
  log(
    `capabilities: hasPortfolioOptimization=${String(
      capabilities?.["hasPortfolioOptimization"],
    )} jobTypes=${jsonText(capabilities?.["jobTypes"] ?? [])}`,
  );
  log(
    `job: status=${String(optimization?.["status"])} advisoryOnly=${String(
      optimization?.["advisoryOnly"],
    )} durationMs=${String(optimization?.["durationMs"] ?? "n/a")}`,
  );
  log(
    `objective=${String(optimization?.["objective"])} turnover=${String(
      optimization?.["turnover"],
    )} variance=${String(optimization?.["portfolioVariance"])} volatility=${String(
      optimization?.["portfolioVolatility"],
    )}`,
  );
  log(
    `concentration: top=${String(concentration?.["topSymbol"] ?? "n/a")} maxWeight=${String(
      concentration?.["maxWeight"] ?? "n/a",
    )} effectiveCount=${String(
      concentration?.["effectivePositionCount"] ?? "n/a",
    )}`,
  );
  log(
    `warnings: ${jsonText([
      ...asArray(optimization?.["warnings"]),
      ...asArray(optimization?.["resultWarnings"]),
    ])}`,
  );
  log(`allocations: ${jsonText(optimization?.["allocations"] ?? [])}`);
}

function printUsage(): void {
  console.log(`${USAGE}

This inspector submits a deterministic sample portfolio_optimization job only.
It does not read broker state, write account state, create orders, or expose UI/API surfaces.`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
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
  if (
    health.value["ok"] !== true ||
    health.value["service"] !== "pyrus-compute"
  ) {
    throw new Error("Python compute health response has the wrong service identity.");
  }
  if (!capabilities.ok) {
    throw new Error(`Python compute capabilities failed: ${capabilities.error}`);
  }
  if (!hasPortfolioOptimizationCapability(capabilities.value)) {
    throw new Error(
      "Python compute does not advertise portfolio_optimization schema version 1.",
    );
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
    console.log(jsonText(summary, 2));
  } else {
    printHuman(summary);
  }
  process.exitCode = statusExitCode(summary);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

export const __pyrusPortfolioOptimizationInternalsForTests = {
  buildPortfolioOptimizationInput,
  computeBaseUrlFromDiagnostics,
  errorMessage,
  fetchJson,
  jsonText,
  parseArgs,
  readResponseText,
  runPortfolioOptimizationJob,
};

if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}
