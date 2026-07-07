import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  __signalQualityKpisInternalsForTests,
  compareSignalScoreModels,
  type SignalScoreCalibrationObservation,
  type SignalScoreModelKey,
} from "../../artifacts/api-server/src/services/signal-quality-kpis";

const { scoreSignalWithModel } = __signalQualityKpisInternalsForTests;

const TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const DIRECTIONS = ["long", "short"] as const;
type Direction = (typeof DIRECTIONS)[number];

const DEFAULT_SCORERS: SignalScoreModelKey[] = [
  "observed-score",
  "expected-move-v1",
  "expected-move-v2",
  "reversion-sot-v3",
  "balanced-sot-v2",
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type DumpRow = SignalScoreCalibrationObservation & {
  audit?: Record<string, unknown> | null;
};

type DumpHeader = {
  header: true;
  resolvedTimeframe: string;
  outcomeHorizonBars: number;
  count: number;
};

type LoadedDump = {
  timeframe: Timeframe;
  path: string;
  mtime: string;
  header: DumpHeader | null;
  rows: DumpRow[];
};

type Options = {
  inputDir: string;
  outputDir: string;
  timeframes: Timeframe[];
  scorers: SignalScoreModelKey[];
  scoreThreshold: number;
  mfeThresholds: number[];
};

type ScoredRow = DumpRow & { score: number };

function usage(): string {
  return [
    "Usage: tsx scripts/signal-calibration/calibration-fit.ts [flags]",
    "",
    "Flags:",
    "  --input-dir <path>        Default .pyrus-runtime/calibration/<today>",
    "  --output-dir <path>       Default <input-dir>",
    "  --timeframes <csv>        Default 5m,15m,1h",
    `  --scorers <csv>           Default ${DEFAULT_SCORERS.join(",")}`,
    "  --score-threshold <n>     Default 90",
    "  --mfe-thresholds <csv>    Default 10,20,30",
  ].join("\n");
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
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

function parseCsv(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberCsv(value: string | undefined, fallback: string): number[] {
  const parsed = parseCsv(value, fallback).map(Number);
  if (!parsed.length || parsed.some((item) => !Number.isFinite(item))) {
    throw new Error("Expected comma-separated finite numbers");
  }
  return parsed;
}

function parseTimeframes(value: string | undefined): Timeframe[] {
  const parsed = parseCsv(value, "5m,15m,1h");
  for (const timeframe of parsed) {
    if (!(TIMEFRAMES as readonly string[]).includes(timeframe)) {
      throw new Error(
        `Invalid timeframe "${timeframe}". Use one of ${TIMEFRAMES.join(", ")}`,
      );
    }
  }
  return parsed as Timeframe[];
}

function parseScorers(value: string | undefined): SignalScoreModelKey[] {
  return parseCsv(value, DEFAULT_SCORERS.join(",")) as SignalScoreModelKey[];
}

function parseOptions(argv = process.argv.slice(2)): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    process.exit(0);
  }
  const defaultDir = path.join(".pyrus-runtime", "calibration", todayKey());
  const inputDir = path.resolve(repoRoot, readFlag(argv, "--input-dir") ?? defaultDir);
  return {
    inputDir,
    outputDir: path.resolve(repoRoot, readFlag(argv, "--output-dir") ?? inputDir),
    timeframes: parseTimeframes(readFlag(argv, "--timeframes")),
    scorers: parseScorers(readFlag(argv, "--scorers")),
    scoreThreshold: Number(readFlag(argv, "--score-threshold") ?? 90),
    mfeThresholds: parseNumberCsv(readFlag(argv, "--mfe-thresholds"), "10,20,30"),
  };
}

function loadDump(inputDir: string, timeframe: Timeframe): LoadedDump | null {
  const filePath = path.join(inputDir, `observations-${timeframe}.jsonl`);
  if (!existsSync(filePath)) {
    return null;
  }
  const lines = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const first = lines[0] ? (JSON.parse(lines[0]) as unknown) : null;
  const header =
    first && typeof first === "object" && (first as { header?: unknown }).header === true
      ? (first as DumpHeader)
      : null;
  const rows = (header ? lines.slice(1) : lines).map(
    (line) => JSON.parse(line) as DumpRow,
  );
  return {
    timeframe,
    path: filePath,
    mtime: statSync(filePath).mtime.toISOString(),
    header,
    rows,
  };
}

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = values.slice().sort((left, right) => left - right);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return round(sorted[lower]);
  }
  const weight = index - lower;
  return round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

function scoreRows(rows: DumpRow[], scorer: SignalScoreModelKey): ScoredRow[] {
  return rows.flatMap((row) => {
    const score = scoreSignalWithModel(row, scorer);
    return score == null || !Number.isFinite(score) ? [] : [{ ...row, score }];
  });
}

function bucketForScore(score: number): string {
  const clamped = Math.min(100, Math.max(0, score));
  const lower = clamped >= 100 ? 90 : Math.floor(clamped / 10) * 10;
  return `${lower}-${lower + 10}`;
}

function fitIsotonic(rows: ScoredRow[]) {
  const sorted = rows
    .map((row, index) => ({ score: row.score, target: row.mfePercent, index }))
    .sort((left, right) => left.score - right.score || left.index - right.index);
  type Block = {
    minScore: number;
    maxScore: number;
    weight: number;
    sum: number;
  };
  const blocks: Block[] = [];
  for (const row of sorted) {
    blocks.push({
      minScore: row.score,
      maxScore: row.score,
      weight: 1,
      sum: row.target,
    });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left.sum / left.weight <= right.sum / right.weight) {
        break;
      }
      blocks.splice(blocks.length - 2, 2, {
        minScore: left.minScore,
        maxScore: right.maxScore,
        weight: left.weight + right.weight,
        sum: left.sum + right.sum,
      });
    }
  }
  return blocks.map((block) => ({
    minScore: round(block.minScore, 3),
    maxScore: round(block.maxScore, 3),
    count: block.weight,
    calibratedMfePercent: round(block.sum / block.weight),
  }));
}

function quantileBuckets(rows: ScoredRow[]) {
  const buckets = new Map<string, ScoredRow[]>();
  for (const row of rows) {
    const bucket = bucketForScore(row.score);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), row]);
  }
  return [...buckets.entries()]
    .sort((left, right) => Number(right[0].split("-")[0]) - Number(left[0].split("-")[0]))
    .map(([bucket, bucketRows]) => {
      const mfes = bucketRows.map((row) => row.mfePercent);
      return {
        bucket,
        count: bucketRows.length,
        avgMfePercent: mean(mfes),
        p50MfePercent: quantile(mfes, 0.5),
        p75MfePercent: quantile(mfes, 0.75),
        p90MfePercent: quantile(mfes, 0.9),
      };
    });
}

function bigMoverMetrics(
  rows: ScoredRow[],
  scoreThreshold: number,
  mfeThresholds: number[],
) {
  const highScore = rows.filter((row) => row.score >= scoreThreshold);
  return mfeThresholds.map((mfeThreshold) => {
    const bigMovers = rows.filter((row) => row.mfePercent >= mfeThreshold);
    const joint = bigMovers.filter((row) => row.score >= scoreThreshold);
    return {
      scoreThreshold,
      mfeThreshold,
      jointCount: joint.length,
      bigMoverCount: bigMovers.length,
      highScoreCount: highScore.length,
      recall: bigMovers.length ? round(joint.length / bigMovers.length) : null,
      precision: highScore.length ? round(joint.length / highScore.length) : null,
    };
  });
}

function buildCell(input: {
  timeframe: Timeframe;
  direction: Direction;
  scorer: SignalScoreModelKey;
  rows: DumpRow[];
  options: Options;
}) {
  const directionRows = input.rows.filter((row) => row.direction === input.direction);
  const scored = scoreRows(directionRows, input.scorer);
  const comparison = compareSignalScoreModels(scored, [input.scorer], {
    minObservationCount: 1,
    minTopBucketSignalCount: Math.max(1, Math.round(scored.length * 0.2)),
    minLowerBaselineSignalCount: 1,
    minPopulatedBucketCount: 1,
    minAlignmentScore: Number.NEGATIVE_INFINITY,
  }).models[0];
  return {
    timeframe: input.timeframe,
    direction: input.direction,
    scorer: input.scorer,
    totalObservations: directionRows.length,
    scorableCount: scored.length,
    bigMoverMetrics: bigMoverMetrics(
      scored,
      input.options.scoreThreshold,
      input.options.mfeThresholds,
    ),
    isotonicFit: fitIsotonic(scored),
    quantileBuckets: quantileBuckets(scored),
    magnitudeAlignment: comparison?.magnitudeAlignment ?? null,
    expectancyAlignment: comparison?.alignment ?? null,
  };
}

function buildReport(options: Options, dumps: LoadedDump[]) {
  const cells = dumps.flatMap((dump) =>
    DIRECTIONS.flatMap((direction) =>
      options.scorers.map((scorer) =>
        buildCell({
          timeframe: dump.timeframe,
          direction,
          scorer,
          rows: dump.rows,
          options,
        }),
      ),
    ),
  );
  return {
    generatedAt: new Date().toISOString(),
    inputDir: options.inputDir,
    outputDir: options.outputDir,
    scoreThreshold: options.scoreThreshold,
    mfeThresholds: options.mfeThresholds,
    scorers: options.scorers,
    dumps: dumps.map((dump) => ({
      timeframe: dump.timeframe,
      path: dump.path,
      mtime: dump.mtime,
      rows: dump.rows.length,
      headerCount: dump.header?.count ?? null,
      resolvedTimeframe: dump.header?.resolvedTimeframe ?? null,
      outcomeHorizonBars: dump.header?.outcomeHorizonBars ?? null,
    })),
    cells,
  };
}

function formatPercent(value: number | null): string {
  return value == null ? "n/a" : `${round(value * 100, 2)}%`;
}

function renderMarkdown(report: ReturnType<typeof buildReport>): string {
  const lines: string[] = [];
  lines.push("# Signal Calibration Fit");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Input dir: ${report.inputDir}`);
  lines.push("");
  lines.push("## Dumps");
  lines.push("");
  lines.push("| timeframe | path | mtime | rows | header count | resolved timeframe | horizon bars |");
  lines.push("|---|---|---|---:|---:|---|---:|");
  for (const dump of report.dumps) {
    lines.push(
      `| ${dump.timeframe} | ${dump.path} | ${dump.mtime} | ${dump.rows} | ${dump.headerCount ?? "n/a"} | ${dump.resolvedTimeframe ?? "n/a"} | ${dump.outcomeHorizonBars ?? "n/a"} |`,
    );
  }
  lines.push("");
  lines.push("## Big-Mover Recall");
  lines.push("");
  lines.push("| timeframe | direction | scorer | score >= | MFE >= | joint | big movers | high score | recall | precision |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const cell of report.cells) {
    for (const metric of cell.bigMoverMetrics) {
      lines.push(
        `| ${cell.timeframe} | ${cell.direction} | ${cell.scorer} | ${metric.scoreThreshold} | ${metric.mfeThreshold}% | ${metric.jointCount} | ${metric.bigMoverCount} | ${metric.highScoreCount} | ${formatPercent(metric.recall)} | ${formatPercent(metric.precision)} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Fit Quality");
  lines.push("");
  lines.push("| timeframe | direction | scorer | n | score-MFE r | high-score MFE lift | top expectancy lift | inversions |");
  lines.push("|---|---|---|---:|---:|---:|---:|---:|");
  for (const cell of report.cells) {
    lines.push(
      `| ${cell.timeframe} | ${cell.direction} | ${cell.scorer} | ${cell.scorableCount} | ${cell.magnitudeAlignment?.scoreMfePearson ?? "n/a"} | ${cell.magnitudeAlignment?.highScoreMfeLiftPercent ?? "n/a"} | ${cell.expectancyAlignment?.topBucketLiftPercent ?? "n/a"} | ${cell.expectancyAlignment?.inversionCount ?? "n/a"} |`,
    );
  }
  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const options = parseOptions();
  if (!Number.isFinite(options.scoreThreshold)) {
    throw new Error("--score-threshold must be finite");
  }
  const dumps = options.timeframes.flatMap((timeframe) => {
    const dump = loadDump(options.inputDir, timeframe);
    return dump ? [dump] : [];
  });
  if (!dumps.length) {
    throw new Error(`No observation dumps found in ${options.inputDir}`);
  }
  const missing = options.timeframes.filter(
    (timeframe) => !dumps.some((dump) => dump.timeframe === timeframe),
  );
  const report = buildReport(options, dumps);
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = path.join(options.outputDir, "calibration-fit.json");
  const mdPath = path.join(options.outputDir, "calibration-fit.md");
  writeFileSync(jsonPath, `${JSON.stringify({ ...report, missing }, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(JSON.stringify({ jsonPath, mdPath, missing }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
