export {};

type JsonRecord = Record<string, unknown>;

type CliOptions = {
  apiBaseUrl: string;
  accountId: string | null;
  mode: "live" | "paper";
  requestTimeoutMs: number;
  json: boolean;
};

type FetchResult<T> =
  | { ok: true; value: T; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

const DEFAULT_API_BASE_URL =
  process.env["API_BASE_URL"] ?? "http://127.0.0.1:18747/api";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    accountId: process.env["PYRUS_GREEK_SCENARIO_ACCOUNT_ID"] ?? null,
    mode:
      process.env["PYRUS_GREEK_SCENARIO_MODE"] === "paper" ? "paper" : "live",
    requestTimeoutMs: parsePositiveInteger(
      process.env["PYRUS_GREEK_SCENARIO_TIMEOUT_MS"] ?? "",
      10_000,
    ),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--") {
      continue;
    }
    const next = argv[index + 1];
    const [flag, inlineValue] = token.includes("=")
      ? (token.split(/=(.*)/s, 2) as [string, string])
      : [token, undefined];
    const value = inlineValue ?? next;

    if ((flag === "--api-base-url" || flag === "--account-id") && !value) {
      throw new Error(`${flag} requires a value.`);
    }
    if (flag === "--api-base-url") {
      options.apiBaseUrl = value as string;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--account-id") {
      options.accountId = value as string;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--mode") {
      if (value !== "live" && value !== "paper") {
        throw new Error("--mode must be live or paper.");
      }
      options.mode = value;
      if (inlineValue === undefined) index += 1;
      continue;
    }
    if (flag === "--request-timeout-ms") {
      options.requestTimeoutMs = parsePositiveInteger(
        value ?? "",
        options.requestTimeoutMs,
      );
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

function parsePositiveInteger(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), base).toString();
}

async function fetchJson<T extends JsonRecord>(
  apiBaseUrl: string,
  path: string,
  timeoutMs: number,
): Promise<FetchResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(buildUrl(apiBaseUrl, path), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, latencyMs };
    }
    return {
      ok: true,
      value: (await response.json()) as T,
      latencyMs,
    };
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

async function resolveAccountId(options: CliOptions): Promise<string> {
  if (options.accountId) {
    return options.accountId;
  }
  const accounts = await fetchJson<JsonRecord>(
    options.apiBaseUrl,
    `/accounts?mode=${options.mode}`,
    options.requestTimeoutMs,
  );
  if (!accounts.ok) {
    throw new Error(`Could not fetch accounts: ${accounts.error}`);
  }
  const rows = Array.isArray(accounts.value["accounts"])
    ? accounts.value["accounts"]
    : [];
  const first = rows.find(isRecord);
  const accountId =
    readString(first, "accountId") ??
    readString(first, "id") ??
    readString(first, "providerAccountId");
  if (!accountId) {
    throw new Error(
      "No account id found. Pass --account-id or set PYRUS_GREEK_SCENARIO_ACCOUNT_ID.",
    );
  }
  return accountId;
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

function summarizeScenario(scenario: JsonRecord | null): JsonRecord | null {
  if (!scenario) return null;
  return {
    spotShock: readNumber(scenario, "spotShock"),
    ivShockVolPoints: readNumber(scenario, "ivShockVolPoints"),
    dayOffset: readNumber(scenario, "dayOffset"),
    estimatedPnl: readNumber(scenario, "estimatedPnl"),
    components: readRecord(scenario["components"]),
    boundedPositionCount: readNumber(scenario, "boundedPositionCount"),
    repricedPositionCount: readNumber(scenario, "repricedPositionCount"),
    fallbackPositionCount: readNumber(scenario, "fallbackPositionCount"),
  };
}

function summarizeGreekScenarios(greekScenarios: JsonRecord | null): JsonRecord {
  if (!greekScenarios) {
    return { present: false };
  }
  const result = readRecord(greekScenarios["result"]);
  const scenarios = asArray(result?.["scenarios"])
    .filter(isRecord)
    .map((scenario) => ({
      ...scenario,
      estimatedPnl: readNumber(scenario, "estimatedPnl") ?? 0,
    }))
    .sort(
      (left, right) =>
        (readNumber(left, "estimatedPnl") ?? 0) -
        (readNumber(right, "estimatedPnl") ?? 0),
    );
  const flags = asArray(result?.["managementFlags"]).filter(isRecord);

  return {
    present: true,
    enabled: greekScenarios["enabled"] === true,
    status: readString(greekScenarios, "status"),
    warning: readString(greekScenarios, "warning"),
    coverage: readRecord(greekScenarios["coverage"]),
    pricingModel: readString(result, "pricingModel"),
    repricedPositionScenarioCount: readNumber(
      result,
      "repricedPositionScenarioCount",
    ),
    fallbackPositionScenarioCount: readNumber(
      result,
      "fallbackPositionScenarioCount",
    ),
    boundedPositionScenarioCount: readNumber(
      result,
      "boundedPositionScenarioCount",
    ),
    scenarioCount:
      readNumber(result, "scenarioCount") ?? scenarios.length,
    worst: summarizeScenario(scenarios[0] ?? null),
    best: summarizeScenario(scenarios[scenarios.length - 1] ?? null),
    managementFlags: flags.slice(0, 5).map((flag) => ({
      symbol: readString(flag, "symbol"),
      reasons: asArray(flag["reasons"]).filter(
        (reason): reason is string => typeof reason === "string",
      ),
      thetaBurdenPct: readNumber(flag, "thetaBurdenPct"),
      worstFivePctGammaPnlPct: readNumber(flag, "worstFivePctGammaPnlPct"),
      fiveVolPointVegaPnlPct: readNumber(flag, "fiveVolPointVegaPnlPct"),
    })),
    pythonJob: readRecord(greekScenarios["pythonJob"]),
  };
}

function readPythonComputeDiagnostics(runtime: JsonRecord): JsonRecord | null {
  return (
    readRecord(readRecord(runtime["probes"])?.["pythonCompute"]) ??
    readRecord(readRecord(runtime["api"])?.["pythonCompute"]) ??
    readRecord(runtime["pythonCompute"])
  );
}

function statusExitCode(summary: JsonRecord): number {
  const python = readRecord(summary["pythonCompute"]);
  const greek = readRecord(summary["greekScenarios"]);
  if (python?.["enabled"] !== true || python["status"] !== "healthy") {
    return 2;
  }
  if (greek?.["present"] !== true || greek["enabled"] !== true) {
    return 2;
  }
  const status = greek["status"];
  return status === "completed" || status === "empty" ? 0 : 2;
}

function printHuman(summary: JsonRecord): void {
  const python = readRecord(summary["pythonCompute"]);
  const greek = readRecord(summary["greekScenarios"]);
  const coverage = readRecord(greek?.["coverage"]);

  console.log("PYRUS Greek Scenario Inspection");
  console.log(`apiBaseUrl: ${summary["apiBaseUrl"]}`);
  console.log(`accountId: ${summary["accountId"]}`);
  console.log(`mode: ${summary["mode"]}`);
  console.log(
    `pythonCompute: enabled=${String(python?.["enabled"])} status=${String(
      python?.["status"],
    )} pid=${String(python?.["pid"] ?? "n/a")} restarts=${String(
      python?.["restartCount"] ?? "n/a",
    )}`,
  );
  console.log(
    `greekScenarios: present=${String(greek?.["present"])} enabled=${String(
      greek?.["enabled"],
    )} status=${String(greek?.["status"])} warning=${String(
      greek?.["warning"] ?? "none",
    )}`,
  );
  if (coverage) {
    const skipped = readRecord(coverage["skipped"]);
    console.log(
      `coverage: total=${String(coverage["totalOptionPositions"])} eligible=${String(
        coverage["eligiblePositions"],
      )} skipped=${String(coverage["skippedPositions"])}`,
    );
    console.log(
      `skipped: missingSpot=${String(skipped?.["missingSpot"])} missingMark=${String(
        skipped?.["missingMarkPrice"],
      )} missingContract=${String(
        skipped?.["missingContractData"],
      )} missingGreek=${String(skipped?.["missingGreekSnapshot"])}`,
    );
  }
  console.log(`scenarioCount: ${String(greek?.["scenarioCount"] ?? "n/a")}`);
  console.log(
    `pricing: model=${String(greek?.["pricingModel"] ?? "n/a")} repriced=${String(
      greek?.["repricedPositionScenarioCount"] ?? "n/a",
    )} fallback=${String(
      greek?.["fallbackPositionScenarioCount"] ?? "n/a",
    )} bounded=${String(greek?.["boundedPositionScenarioCount"] ?? "n/a")}`,
  );
  console.log(`worst: ${JSON.stringify(greek?.["worst"] ?? null)}`);
  console.log(`best: ${JSON.stringify(greek?.["best"] ?? null)}`);
  console.log(
    `managementFlags: ${JSON.stringify(greek?.["managementFlags"] ?? [])}`,
  );
}

function printUsage(): void {
  console.log(`Usage:
  pnpm --filter @workspace/scripts run pyrus:greek-scenarios -- [options]

Options:
  --api-base-url URL        API base URL, default ${DEFAULT_API_BASE_URL}
  --account-id ID           Account id; if omitted, the first /accounts row is used
  --mode live|paper         Account mode, default live
  --request-timeout-ms N    Request timeout, default 10000
  --json                    Print raw summary JSON

Required runtime flags on the API process:
  PYRUS_PYTHON_COMPUTE_ENABLED=1
  PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED=1`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const accountId = await resolveAccountId(options);
  const [runtime, risk] = await Promise.all([
    fetchJson<JsonRecord>(
      options.apiBaseUrl,
      "/diagnostics/runtime",
      options.requestTimeoutMs,
    ),
    fetchJson<JsonRecord>(
      options.apiBaseUrl,
      `/accounts/${encodeURIComponent(accountId)}/risk?mode=${options.mode}`,
      options.requestTimeoutMs,
    ),
  ]);

  if (!runtime.ok) {
    throw new Error(`Runtime diagnostics failed: ${runtime.error}`);
  }
  if (!risk.ok) {
    throw new Error(`Account risk failed: ${risk.error}`);
  }

  const summary: JsonRecord = {
    checkedAt: new Date().toISOString(),
    apiBaseUrl: options.apiBaseUrl,
    accountId,
    mode: options.mode,
    latenciesMs: {
      runtime: runtime.latencyMs,
      risk: risk.latencyMs,
    },
    pythonCompute: readPythonComputeDiagnostics(runtime.value),
    greekScenarios: summarizeGreekScenarios(
      readRecord(risk.value["greekScenarios"]),
    ),
  };

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary);
  }
  process.exitCode = statusExitCode(summary);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
