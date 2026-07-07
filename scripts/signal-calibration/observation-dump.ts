import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { refreshDeploymentSignalQualityKpiSnapshot } from "../../artifacts/api-server/src/services/signal-quality-kpis-service";

const DEFAULT_DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0";
const TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Options = {
  deploymentId: string;
  timeframes: Timeframe[];
  outputDir: string;
};

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
  return parsed as Timeframe[];
}

function parseOptions(argv = process.argv.slice(2)): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }
  return {
    deploymentId: readFlag(argv, "--deployment-id") ?? DEFAULT_DEPLOYMENT_ID,
    timeframes: parseTimeframes(readFlag(argv, "--timeframes")),
    outputDir: path.resolve(
      repoRoot,
      readFlag(argv, "--output-dir") ??
        path.join(".pyrus-runtime", "calibration", todayKey()),
    ),
  };
}

function countLines(filePath: string): number {
  if (!existsSync(filePath)) {
    return 0;
  }
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

async function dumpTimeframe(options: Options, timeframe: Timeframe) {
  const dumpPath = path.join(options.outputDir, `observations-${timeframe}.jsonl`);
  if (existsSync(dumpPath)) {
    rmSync(dumpPath);
  }
  process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH = dumpPath;
  try {
    await refreshDeploymentSignalQualityKpiSnapshot({
      deploymentId: options.deploymentId,
      draft: {
        signalTimeframe: timeframe,
        outcomeTimeframe: timeframe,
      },
    });
  } finally {
    delete process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
  }
  return { timeframe, path: dumpPath, lineCount: countLines(dumpPath) };
}

async function main(): Promise<void> {
  const options = parseOptions();
  mkdirSync(options.outputDir, { recursive: true });
  const keepalive = setInterval(() => {}, 60_000);
  try {
    const results = [];
    for (const timeframe of options.timeframes) {
      console.log(`[signal-calibration:dump] dumping ${timeframe}...`);
      const result = await dumpTimeframe(options, timeframe);
      console.log(
        `[signal-calibration:dump] ${timeframe}: ${result.lineCount} lines -> ${result.path}`,
      );
      results.push(result);
    }
    console.log(
      JSON.stringify(
        {
          deploymentId: options.deploymentId,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
