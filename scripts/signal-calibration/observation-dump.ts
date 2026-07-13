import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { refreshDeploymentSignalQualityKpiSnapshot } from "../../artifacts/api-server/src/services/signal-quality-kpis-service";

const DEFAULT_DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
// The KPI service intentionally resolves requested 1m previews to 5m, so 1m
// cannot satisfy this tool's exact requested/resolved artifact identity.
const TIMEFRAMES = ["2m", "5m", "15m", "1h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type Options = {
  deploymentId: string;
  timeframes: Timeframe[];
  outputDir: string;
};

type RefreshSignalQuality = typeof refreshDeploymentSignalQualityKpiSnapshot;
type RefreshResponse = Awaited<ReturnType<RefreshSignalQuality>>;

const VALUE_FLAGS = [
  "--deployment-id",
  "--timeframes",
  "--output-dir",
] as const;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function usage(): string {
  return [
    "Usage: tsx scripts/signal-calibration/observation-dump.ts [flags]",
    "",
    "Flags:",
    `  --deployment-id <id>      Default ${DEFAULT_DEPLOYMENT_ID}`,
    "  --timeframes <csv>        Default 5m,15m,1h",
    "  --output-dir <path>       Default .pyrus-runtime/calibration/<today>",
  ].join("\n");
}

function readFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }
  return value;
}

function validateArguments(argv: string[]): void {
  const allowed = new Set<string>(VALUE_FLAGS);
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    if (!allowed.has(name)) {
      throw new Error(`Unknown argument "${name}".\n${usage()}`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate argument "${name}".\n${usage()}`);
    }
    seen.add(name);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${name}`);
    }
  }
}

function parseTimeframes(value: string | undefined): Timeframe[] {
  const raw = value ?? "5m,15m,1h";
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parsed.length) {
    throw new Error("--timeframes must include at least one timeframe");
  }
  for (const timeframe of parsed) {
    if (!(TIMEFRAMES as readonly string[]).includes(timeframe)) {
      throw new Error(
        `Invalid timeframe "${timeframe}". Use one of ${TIMEFRAMES.join(", ")}`,
      );
    }
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error("--timeframes must not contain duplicates");
  }
  return parsed as Timeframe[];
}

function parseOptions(argv = process.argv.slice(2)): Options {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage());
    process.exit(0);
  }
  validateArguments(args);
  const deploymentId = (
    readFlag(args, "--deployment-id") ?? DEFAULT_DEPLOYMENT_ID
  ).trim();
  if (!deploymentId) {
    throw new Error("--deployment-id must not be empty");
  }
  return {
    deploymentId,
    timeframes: parseTimeframes(readFlag(args, "--timeframes")),
    outputDir: path.resolve(
      repoRoot,
      readFlag(args, "--output-dir") ??
        path.join(".pyrus-runtime", "calibration", todayKey()),
    ),
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseServiceDump(input: {
  temporaryPath: string;
  timeframe: Timeframe;
  options: Options;
  response: RefreshResponse;
  runId: string;
}): { contents: string; lineCount: number } {
  const calibrationReasons =
    input.response.kpis.scoreModelComparisons.calibration.reasons;
  const coverageReasons = calibrationReasons.filter(
    (reason) => reason === "coverage_degraded",
  );
  if (coverageReasons.length) {
    throw new Error(
      `Observation coverage degraded for ${input.timeframe}; canonical dump was not replaced.`,
    );
  }

  const { coverage } = input.response;
  if (coverage.requestedTimeframe !== input.timeframe) {
    throw new Error(
      `Coverage requested timeframe ${coverage.requestedTimeframe} does not match requested ${input.timeframe}.`,
    );
  }
  if (coverage.resolvedTimeframe !== input.timeframe) {
    throw new Error(
      `Resolved timeframe ${coverage.resolvedTimeframe} does not match requested ${input.timeframe}.`,
    );
  }
  if (coverage.usedTimeframeFallback) {
    throw new Error(
      `Observation refresh used a timeframe fallback for ${input.timeframe}; canonical dump was not replaced.`,
    );
  }
  if (!existsSync(input.temporaryPath)) {
    throw new Error(
      `Observation refresh did not create ${input.temporaryPath}`,
    );
  }
  // ponytail: this operator-only validation buffers one dump; upgrade to a
  // streaming header rewrite if measured calibration artifacts outgrow the heap.
  const lines = readFileSync(input.temporaryPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    throw new Error(
      `Observation refresh created an empty dump for ${input.timeframe}`,
    );
  }
  let rawHeader: unknown;
  try {
    rawHeader = JSON.parse(lines[0]) as unknown;
  } catch {
    throw new Error(
      `Observation dump header is not valid JSON for ${input.timeframe}`,
    );
  }
  const serviceHeader = recordValue(rawHeader);
  if (serviceHeader?.header !== true) {
    throw new Error(
      `Observation dump is missing its header for ${input.timeframe}`,
    );
  }
  if (serviceHeader.resolvedTimeframe !== input.timeframe) {
    throw new Error(
      `Dump resolved timeframe ${String(serviceHeader.resolvedTimeframe)} does not match requested ${input.timeframe}.`,
    );
  }
  const outcomeHorizonBars = serviceHeader.outcomeHorizonBars;
  if (
    typeof outcomeHorizonBars !== "number" ||
    !Number.isInteger(outcomeHorizonBars) ||
    outcomeHorizonBars <= 0
  ) {
    throw new Error(
      `Observation dump has an invalid outcome horizon for ${input.timeframe}`,
    );
  }
  if (outcomeHorizonBars !== input.response.settings.outcomeHorizonBars) {
    throw new Error(
      `Observation dump horizon ${outcomeHorizonBars} does not match settings horizon ${input.response.settings.outcomeHorizonBars}.`,
    );
  }
  const rowLines = lines.slice(1);
  if (
    !Number.isInteger(serviceHeader.count) ||
    Number(serviceHeader.count) !== rowLines.length
  ) {
    throw new Error(
      `Observation dump declares ${String(serviceHeader.count)} rows but contains ${rowLines.length}.`,
    );
  }
  if (!rowLines.length) {
    throw new Error(
      `Observation dump contains no observations for ${input.timeframe}`,
    );
  }
  rowLines.forEach((line, index) => {
    try {
      JSON.parse(line);
    } catch {
      throw new Error(`Observation dump row ${index + 1} is not valid JSON`);
    }
  });

  const evaluatedSymbolCount = coverage.evaluatedSymbolCount;
  const calibrationCoverage = {
    supported: true,
    reasons: coverageReasons,
    symbolCoverageRatio:
      evaluatedSymbolCount > 0
        ? coverage.symbolsWithBars / evaluatedSymbolCount
        : 0,
    timeoutRatio:
      evaluatedSymbolCount > 0
        ? coverage.symbolsTimedOut / evaluatedSymbolCount
        : 1,
  };
  const header = {
    header: true,
    schemaVersion: 1,
    runId: input.runId,
    deploymentId: input.options.deploymentId,
    asOfDay: input.response.asOfDay,
    requestedTimeframe: input.timeframe,
    resolvedTimeframe: input.timeframe,
    generatedAt: input.response.generatedAt,
    outcomeHorizonBars,
    settings: input.response.settings,
    mtf: input.response.mtf,
    count: rowLines.length,
    coverage,
    calibrationCoverage,
  };
  return {
    contents: [JSON.stringify(header), ...rowLines].join("\n") + "\n",
    lineCount: lines.length,
  };
}

async function dumpTimeframe(
  options: Options,
  timeframe: Timeframe,
  refresh: RefreshSignalQuality = refreshDeploymentSignalQualityKpiSnapshot,
  runId = randomUUID(),
) {
  const dumpPath = path.join(
    options.outputDir,
    `observations-${timeframe}.jsonl`,
  );
  const temporaryPath = path.join(
    options.outputDir,
    `.${path.basename(dumpPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  const previousDumpPath = process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
  try {
    writeFileSync(temporaryPath, "", { flag: "wx", mode: 0o600 });
    process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH = temporaryPath;
    const response = await refresh({
      deploymentId: options.deploymentId,
      draft: {
        signalTimeframe: timeframe,
        outcomeTimeframe: timeframe,
      },
    });
    const artifact = parseServiceDump({
      temporaryPath,
      timeframe,
      options,
      response,
      runId,
    });
    writeFileSync(temporaryPath, artifact.contents);
    renameSync(temporaryPath, dumpPath);
    return { timeframe, path: dumpPath, lineCount: artifact.lineCount };
  } finally {
    if (previousDumpPath === undefined) {
      delete process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
    } else {
      process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH = previousDumpPath;
    }
    rmSync(temporaryPath, { force: true });
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  mkdirSync(options.outputDir, { recursive: true });
  const keepalive = setInterval(() => {}, 60_000);
  try {
    const results = [];
    const runId = randomUUID();
    for (const timeframe of options.timeframes) {
      console.log(`[signal-calibration:dump] dumping ${timeframe}...`);
      const result = await dumpTimeframe(
        options,
        timeframe,
        refreshDeploymentSignalQualityKpiSnapshot,
        runId,
      );
      console.log(
        `[signal-calibration:dump] ${timeframe}: ${result.lineCount} lines -> ${result.path}`,
      );
      results.push(result);
    }
    console.log(
      JSON.stringify(
        {
          deploymentId: options.deploymentId,
          runId,
          outputDir: options.outputDir,
          results,
        },
        null,
        2,
      ),
    );
  } finally {
    clearInterval(keepalive);
  }
}

export const __observationDumpInternalsForTests = {
  dumpTimeframe,
  parseOptions,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
