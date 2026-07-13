import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  __signalQualityKpisInternalsForTests,
  compareSignalScoreModels,
  type SignalScoreCalibrationObservation,
  type SignalScoreModelKey,
} from "../../artifacts/api-server/src/services/signal-quality-kpis";

const { scoreSignalWithModel } = __signalQualityKpisInternalsForTests;

const TIMEFRAMES = ["2m", "5m", "15m", "1h", "1d"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];
const DIRECTIONS = ["long", "short"] as const;
type Direction = (typeof DIRECTIONS)[number];

const SCORE_MODELS = [
  "observed-score",
  "sot-outcome-v1",
  "evidence-weighted-v2",
  "trend-confirmation-v2",
  "balanced-sot-v2",
  "reversion-sot-v3",
  "expected-move-v1",
  "expected-move-v2",
] as const satisfies readonly SignalScoreModelKey[];

const DEFAULT_SCORERS: SignalScoreModelKey[] = [
  "observed-score",
  "expected-move-v1",
  "expected-move-v2",
  "reversion-sot-v3",
  "balanced-sot-v2",
];

const VALUE_FLAGS = [
  "--input-dir",
  "--output-dir",
  "--timeframes",
  "--scorers",
  "--score-threshold",
  "--mfe-thresholds",
] as const;

const COMPARABLE_SETTING_KEYS = [
  "timeHorizon",
  "outcomeHorizonBars",
  "bosConfirmation",
  "chochAtrBuffer",
  "chochBodyExpansionAtr",
  "chochVolumeGate",
] as const;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type DumpRow = SignalScoreCalibrationObservation & {
  audit?: Record<string, unknown> | null;
};

type DumpHeader = {
  header: true;
  schemaVersion: 1;
  runId: string;
  deploymentId: string;
  asOfDay: string;
  requestedTimeframe: Timeframe;
  resolvedTimeframe: Timeframe;
  generatedAt: string;
  outcomeHorizonBars: number;
  settings: {
    signalTimeframe: Timeframe;
    timeHorizon: number;
    outcomeHorizonBars: number;
    outcomeTimeframe: Timeframe;
    bosConfirmation: string;
    chochAtrBuffer: number;
    chochBodyExpansionAtr: number;
    chochVolumeGate: number;
  };
  mtf: {
    enabled: boolean;
    requiredCount: number;
    timeframes: string[];
  };
  count: number;
  coverage: {
    requestedTimeframe: Timeframe;
    resolvedTimeframe: Timeframe;
    requestedWindowDays: number;
    windowStart: string | null;
    windowEnd: string | null;
    requestedSymbolCount: number;
    evaluatedSymbolCount: number;
    symbolsWithBars: number;
    symbolsTimedOut: number;
    barsPerSymbolCap: number;
    totalBars: number;
    truncatedSymbolUniverse: boolean;
    usedTimeframeFallback: boolean;
  };
  calibrationCoverage: {
    supported: true;
    reasons: string[];
    symbolCoverageRatio: number;
    timeoutRatio: number;
  };
};

type LoadedDump = {
  timeframe: Timeframe;
  path: string;
  mtime: string;
  header: DumpHeader;
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

function parseScorers(value: string | undefined): SignalScoreModelKey[] {
  const parsed = parseCsv(value, DEFAULT_SCORERS.join(","));
  if (!parsed.length) {
    throw new Error("--scorers must include at least one scorer");
  }
  for (const scorer of parsed) {
    if (!(SCORE_MODELS as readonly string[]).includes(scorer)) {
      throw new Error(
        `Invalid scorer "${scorer}". Use one of ${SCORE_MODELS.join(", ")}`,
      );
    }
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new Error("--scorers must not contain duplicates");
  }
  return parsed as SignalScoreModelKey[];
}

function parseOptions(argv = process.argv.slice(2)): Options {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage());
    process.exit(0);
  }
  validateArguments(args);
  const defaultDir = path.join(".pyrus-runtime", "calibration", todayKey());
  const inputDir = path.resolve(
    repoRoot,
    readFlag(args, "--input-dir") ?? defaultDir,
  );
  const scoreThreshold = Number(readFlag(args, "--score-threshold") ?? 90);
  if (
    !Number.isFinite(scoreThreshold) ||
    scoreThreshold < 0 ||
    scoreThreshold > 100
  ) {
    throw new Error("--score-threshold must be finite and between 0 and 100");
  }
  const mfeThresholds = parseNumberCsv(
    readFlag(args, "--mfe-thresholds"),
    "10,20,30",
  );
  if (mfeThresholds.some((threshold) => threshold < 0)) {
    throw new Error("--mfe-thresholds must contain only non-negative numbers");
  }
  if (new Set(mfeThresholds).size !== mfeThresholds.length) {
    throw new Error("--mfe-thresholds must not contain duplicates");
  }
  return {
    inputDir,
    outputDir: path.resolve(
      repoRoot,
      readFlag(args, "--output-dir") ?? inputDir,
    ),
    timeframes: parseTimeframes(readFlag(args, "--timeframes")),
    scorers: parseScorers(readFlag(args, "--scorers")),
    scoreThreshold,
    mfeThresholds,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseJsonLine(
  line: string,
  filePath: string,
  lineNumber: number,
): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new Error(`${filePath}: line ${lineNumber} is not valid JSON`);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function parseDumpHeader(
  value: unknown,
  timeframe: Timeframe,
  filePath: string,
): DumpHeader {
  const header = recordValue(value);
  if (header?.header !== true) {
    throw new Error(
      `${filePath}: first line must be an observation dump header`,
    );
  }
  if (header.schemaVersion !== 1) {
    throw new Error(
      `${filePath}: observation dump must use schemaVersion 1; regenerate it with signal-calibration:dump`,
    );
  }
  if (typeof header.runId !== "string" || !header.runId.trim()) {
    throw new Error(`${filePath}: header runId must be a non-empty string`);
  }
  if (typeof header.deploymentId !== "string" || !header.deploymentId.trim()) {
    throw new Error(
      `${filePath}: header deploymentId must be a non-empty string`,
    );
  }
  if (!isDay(header.asOfDay)) {
    throw new Error(`${filePath}: header asOfDay must be a UTC date`);
  }
  if (header.requestedTimeframe !== timeframe) {
    throw new Error(
      `${filePath}: requested timeframe ${String(header.requestedTimeframe)} does not match requested ${timeframe}`,
    );
  }
  if (header.resolvedTimeframe !== timeframe) {
    throw new Error(
      `${filePath}: resolved timeframe ${String(header.resolvedTimeframe)} does not match requested ${timeframe}`,
    );
  }
  if (!isTimestamp(header.generatedAt)) {
    throw new Error(`${filePath}: header generatedAt must be a timestamp`);
  }
  if (
    !isNonNegativeInteger(header.outcomeHorizonBars) ||
    header.outcomeHorizonBars === 0
  ) {
    throw new Error(
      `${filePath}: outcomeHorizonBars must be a positive integer`,
    );
  }
  if (!isNonNegativeInteger(header.count) || header.count === 0) {
    throw new Error(
      `${filePath}: header count must include at least one observation`,
    );
  }

  const settings = recordValue(header.settings);
  if (
    !settings ||
    settings.signalTimeframe !== timeframe ||
    settings.outcomeTimeframe !== timeframe ||
    settings.outcomeHorizonBars !== header.outcomeHorizonBars ||
    !isFiniteNumber(settings.timeHorizon) ||
    settings.timeHorizon <= 0 ||
    typeof settings.bosConfirmation !== "string" ||
    !settings.bosConfirmation ||
    !isFiniteNumber(settings.chochAtrBuffer) ||
    !isFiniteNumber(settings.chochBodyExpansionAtr) ||
    !isFiniteNumber(settings.chochVolumeGate)
  ) {
    throw new Error(`${filePath}: settings provenance is malformed`);
  }
  const mtf = recordValue(header.mtf);
  if (
    !mtf ||
    typeof mtf.enabled !== "boolean" ||
    !isNonNegativeInteger(mtf.requiredCount) ||
    !Array.isArray(mtf.timeframes) ||
    mtf.timeframes.some(
      (item) => typeof item !== "string" || item.trim().length === 0,
    )
  ) {
    throw new Error(`${filePath}: MTF provenance is malformed`);
  }

  const coverage = recordValue(header.coverage);
  if (!coverage) {
    throw new Error(`${filePath}: header coverage is required`);
  }
  if (
    coverage.requestedTimeframe !== timeframe ||
    coverage.resolvedTimeframe !== timeframe
  ) {
    throw new Error(`${filePath}: coverage timeframe identity is inconsistent`);
  }
  if (coverage.usedTimeframeFallback !== false) {
    throw new Error(`${filePath}: coverage used a timeframe fallback`);
  }
  if (
    !isFiniteNumber(coverage.requestedWindowDays) ||
    coverage.requestedWindowDays <= 0 ||
    !isNonNegativeInteger(coverage.requestedSymbolCount) ||
    !isNonNegativeInteger(coverage.evaluatedSymbolCount) ||
    !isNonNegativeInteger(coverage.symbolsWithBars) ||
    !isNonNegativeInteger(coverage.symbolsTimedOut) ||
    !isNonNegativeInteger(coverage.barsPerSymbolCap) ||
    !isNonNegativeInteger(coverage.totalBars) ||
    typeof coverage.truncatedSymbolUniverse !== "boolean" ||
    !(coverage.windowStart === null || isTimestamp(coverage.windowStart)) ||
    !(coverage.windowEnd === null || isTimestamp(coverage.windowEnd))
  ) {
    throw new Error(`${filePath}: coverage fields are malformed`);
  }
  if (
    coverage.evaluatedSymbolCount === 0 ||
    coverage.evaluatedSymbolCount > coverage.requestedSymbolCount ||
    coverage.symbolsWithBars > coverage.evaluatedSymbolCount ||
    coverage.symbolsTimedOut > coverage.evaluatedSymbolCount
  ) {
    throw new Error(`${filePath}: coverage counts are inconsistent`);
  }

  const calibrationCoverage = recordValue(header.calibrationCoverage);
  if (!calibrationCoverage || calibrationCoverage.supported !== true) {
    throw new Error(`${filePath}: calibration coverage is degraded`);
  }
  if (
    !Array.isArray(calibrationCoverage.reasons) ||
    calibrationCoverage.reasons.some((reason) => typeof reason !== "string") ||
    calibrationCoverage.reasons.length > 0 ||
    !isFiniteNumber(calibrationCoverage.symbolCoverageRatio) ||
    calibrationCoverage.symbolCoverageRatio < 0 ||
    calibrationCoverage.symbolCoverageRatio > 1 ||
    !isFiniteNumber(calibrationCoverage.timeoutRatio) ||
    calibrationCoverage.timeoutRatio < 0 ||
    calibrationCoverage.timeoutRatio > 1
  ) {
    throw new Error(`${filePath}: calibration coverage fields are malformed`);
  }
  const expectedSymbolCoverageRatio =
    coverage.symbolsWithBars / coverage.evaluatedSymbolCount;
  const expectedTimeoutRatio =
    coverage.symbolsTimedOut / coverage.evaluatedSymbolCount;
  if (
    Math.abs(
      calibrationCoverage.symbolCoverageRatio - expectedSymbolCoverageRatio,
    ) > Number.EPSILON ||
    Math.abs(calibrationCoverage.timeoutRatio - expectedTimeoutRatio) >
      Number.EPSILON
  ) {
    throw new Error(
      `${filePath}: calibration coverage ratios are inconsistent`,
    );
  }

  return header as unknown as DumpHeader;
}

function parseDumpRow(
  value: unknown,
  rowNumber: number,
  filePath: string,
): DumpRow {
  const row = recordValue(value);
  if (!row) {
    throw new Error(`${filePath}: row ${rowNumber} must be an object`);
  }
  if (typeof row.symbol !== "string" || !row.symbol.trim()) {
    throw new Error(`${filePath}: row ${rowNumber} symbol must be non-empty`);
  }
  if (row.direction !== "long" && row.direction !== "short") {
    throw new Error(`${filePath}: row ${rowNumber} direction is invalid`);
  }
  if (row.score != null && !isFiniteNumber(row.score)) {
    throw new Error(
      `${filePath}: row ${rowNumber} score must be a finite number`,
    );
  }
  if (isFiniteNumber(row.score) && (row.score < 0 || row.score > 100)) {
    throw new Error(
      `${filePath}: row ${rowNumber} score must be between 0 and 100`,
    );
  }
  const directionalFeatures = recordValue(row.directionalFeatures);
  if (
    row.directionalFeatures != null &&
    (!directionalFeatures ||
      Object.values(directionalFeatures).some((item) => !isFiniteNumber(item)))
  ) {
    throw new Error(
      `${filePath}: row ${rowNumber} directionalFeatures must contain finite numbers`,
    );
  }
  for (const key of [
    "realizedReturnPercent",
    "mfePercent",
    "maePercent",
  ] as const) {
    if (!isFiniteNumber(row[key])) {
      throw new Error(
        `${filePath}: row ${rowNumber} ${key} must be a finite number`,
      );
    }
  }
  if (row.audit != null && !recordValue(row.audit)) {
    throw new Error(
      `${filePath}: row ${rowNumber} audit must be an object or null`,
    );
  }
  return row as unknown as DumpRow;
}

function loadDump(inputDir: string, timeframe: Timeframe): LoadedDump | null {
  const filePath = path.join(inputDir, `observations-${timeframe}.jsonl`);
  if (!existsSync(filePath)) {
    return null;
  }
  const lines = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    throw new Error(`${filePath}: observation dump is empty`);
  }
  const header = parseDumpHeader(
    parseJsonLine(lines[0], filePath, 1),
    timeframe,
    filePath,
  );
  const rowLines = lines.slice(1);
  if (header.count !== rowLines.length) {
    throw new Error(
      `${filePath}: header declares ${header.count} rows but contains ${rowLines.length}`,
    );
  }
  // ponytail: fitting already buffers each dump; replace this with a streaming
  // reader if measured calibration artifacts outgrow the operator heap.
  const rows = rowLines.map((line, index) =>
    parseDumpRow(parseJsonLine(line, filePath, index + 2), index + 1, filePath),
  );
  return {
    timeframe,
    path: filePath,
    mtime: statSync(filePath).mtime.toISOString(),
    header,
    rows,
  };
}

function loadRequestedDumps(
  inputDir: string,
  timeframes: Timeframe[],
): LoadedDump[] {
  const dumps = timeframes.flatMap((timeframe) => {
    const dump = loadDump(inputDir, timeframe);
    return dump ? [dump] : [];
  });
  const missing = timeframes.filter(
    (timeframe) => !dumps.some((dump) => dump.timeframe === timeframe),
  );
  if (missing.length) {
    throw new Error(
      `Missing observation dumps for ${missing.join(", ")} in ${inputDir}`,
    );
  }
  return dumps;
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
    .sort(
      (left, right) => left.score - right.score || left.index - right.index,
    );
  type Block = {
    minScore: number;
    maxScore: number;
    weight: number;
    sum: number;
  };
  const tiedScores: Block[] = [];
  for (const row of sorted) {
    const prior = tiedScores[tiedScores.length - 1];
    if (prior?.minScore === row.score) {
      prior.weight += 1;
      prior.sum += row.target;
      continue;
    }
    tiedScores.push({
      minScore: row.score,
      maxScore: row.score,
      weight: 1,
      sum: row.target,
    });
  }
  const blocks: Block[] = [];
  for (const tiedScore of tiedScores) {
    blocks.push({ ...tiedScore });
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
    const bucketRows = buckets.get(bucket);
    if (bucketRows) {
      bucketRows.push(row);
    } else {
      buckets.set(bucket, [row]);
    }
  }
  return [...buckets.entries()]
    .sort(
      (left, right) =>
        Number(right[0].split("-")[0]) - Number(left[0].split("-")[0]),
    )
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
      precision: highScore.length
        ? round(joint.length / highScore.length)
        : null,
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
  const directionRows = input.rows.filter(
    (row) => row.direction === input.direction,
  );
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
  const source = dumps[0]?.header ?? null;
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
    analysisMode: "descriptive_in_sample" as const,
    activationEligible: false,
    limitations: [
      "No rolling-origin temporal holdout is applied.",
      "No forward-window embargo is applied.",
      "Do not use this report alone to activate a score model.",
    ],
    sourceRunId: source?.runId ?? null,
    deploymentId: source?.deploymentId ?? null,
    asOfDay: source?.asOfDay ?? null,
    mtf: source?.mtf ?? null,
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
      deploymentId: dump.header.deploymentId,
      asOfDay: dump.header.asOfDay,
      dumpGeneratedAt: dump.header.generatedAt,
      settings: dump.header.settings,
      headerCount: dump.header.count,
      resolvedTimeframe: dump.header.resolvedTimeframe,
      outcomeHorizonBars: dump.header.outcomeHorizonBars,
      symbolCoverageRatio: dump.header.calibrationCoverage.symbolCoverageRatio,
      timeoutRatio: dump.header.calibrationCoverage.timeoutRatio,
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
  lines.push(`Source run: ${report.sourceRunId ?? "n/a"}`);
  lines.push(`Deployment: ${report.deploymentId ?? "n/a"}`);
  lines.push(`As of day: ${report.asOfDay ?? "n/a"}`);
  lines.push(`Input dir: ${report.inputDir}`);
  lines.push("");
  lines.push(
    "> Descriptive in-sample report only. No temporal holdout or forward-window embargo is applied; this is not score-model activation evidence.",
  );
  lines.push("");
  lines.push("## Dumps");
  lines.push("");
  lines.push(
    "| timeframe | deployment | dump generated | rows | horizon bars | symbol coverage | timeouts | path |",
  );
  lines.push("|---|---|---|---:|---:|---:|---:|---|");
  for (const dump of report.dumps) {
    lines.push(
      `| ${dump.timeframe} | ${dump.deploymentId} | ${dump.dumpGeneratedAt} | ${dump.rows} | ${dump.outcomeHorizonBars} | ${formatPercent(dump.symbolCoverageRatio)} | ${formatPercent(dump.timeoutRatio)} | ${dump.path} |`,
    );
  }
  lines.push("");
  lines.push("## Big-Mover Recall");
  lines.push("");
  lines.push(
    "| timeframe | direction | scorer | score >= | MFE >= | joint | big movers | high score | recall | precision |",
  );
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
  lines.push(
    "| timeframe | direction | scorer | n | score-MFE r | high-score MFE lift | top expectancy lift | inversions |",
  );
  lines.push("|---|---|---|---:|---:|---:|---:|---:|");
  for (const cell of report.cells) {
    lines.push(
      `| ${cell.timeframe} | ${cell.direction} | ${cell.scorer} | ${cell.scorableCount} | ${cell.magnitudeAlignment?.scoreMfePearson ?? "n/a"} | ${cell.magnitudeAlignment?.highScoreMfeLiftPercent ?? "n/a"} | ${cell.expectancyAlignment?.topBucketLiftPercent ?? "n/a"} | ${cell.expectancyAlignment?.inversionCount ?? "n/a"} |`,
    );
  }
  return lines.join("\n") + "\n";
}

function validateDumpSet(dumps: LoadedDump[]): void {
  const first = dumps[0];
  if (!first) {
    return;
  }
  for (const dump of dumps.slice(1)) {
    if (dump.header.runId !== first.header.runId) {
      throw new Error(
        `Observation dumps mix generation runs ${first.header.runId} and ${dump.header.runId}`,
      );
    }
    if (dump.header.deploymentId !== first.header.deploymentId) {
      throw new Error(
        `Observation dumps mix deployments ${first.header.deploymentId} and ${dump.header.deploymentId}`,
      );
    }
    if (dump.header.outcomeHorizonBars !== first.header.outcomeHorizonBars) {
      throw new Error(
        `Observation dumps mix outcome horizons ${first.header.outcomeHorizonBars} and ${dump.header.outcomeHorizonBars}`,
      );
    }
    if (dump.header.asOfDay !== first.header.asOfDay) {
      throw new Error(
        `Observation dumps mix as-of days ${first.header.asOfDay} and ${dump.header.asOfDay}`,
      );
    }
    if (
      COMPARABLE_SETTING_KEYS.some(
        (key) => dump.header.settings[key] !== first.header.settings[key],
      )
    ) {
      throw new Error("Observation dumps mix signal settings");
    }
    if (
      dump.header.mtf.enabled !== first.header.mtf.enabled ||
      dump.header.mtf.requiredCount !== first.header.mtf.requiredCount ||
      dump.header.mtf.timeframes.length !==
        first.header.mtf.timeframes.length ||
      dump.header.mtf.timeframes.some(
        (value, index) => value !== first.header.mtf.timeframes[index],
      )
    ) {
      throw new Error("Observation dumps mix MTF settings");
    }
  }
}

function writeFileAtomically(filePath: string, contents: string): void {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, contents, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const dumps = loadRequestedDumps(options.inputDir, options.timeframes);
  validateDumpSet(dumps);
  const report = buildReport(options, dumps);
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = path.join(options.outputDir, "calibration-fit.json");
  const mdPath = path.join(options.outputDir, "calibration-fit.md");
  // ponytail: each report file is atomically replaced, but the JSON/Markdown
  // pair has no cross-file transaction. Publish a versioned manifest last if a
  // future consumer requires pair-atomic snapshots.
  writeFileAtomically(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileAtomically(mdPath, renderMarkdown(report));
  console.log(JSON.stringify({ jsonPath, mdPath }, null, 2));
}

export const __calibrationFitInternalsForTests = {
  buildReport,
  fitIsotonic,
  loadDump,
  loadRequestedDumps,
  parseOptions,
  renderMarkdown,
  validateDumpSet,
  writeFileAtomically,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
