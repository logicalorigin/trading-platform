import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  __signalQualityKpisInternalsForTests,
  type SignalScoreCalibrationObservation,
  type SignalScoreModelKey,
} from "../../artifacts/api-server/src/services/signal-quality-kpis";

// The user's metric -- big-mover recall report (PLAN_2026-07-03, Task 2). Reads
// the Task 1 JSONL dumps and, per timeframe x direction x scorer, reports:
//   - recall:    P(score >= scoreThreshold | MFE >= mfeThreshold)
//   - precision: P(MFE >= mfeThreshold | score >= scoreThreshold)
//   - the score-decile distribution of the big-mover (MFE >= 30%) subset
// Scores are recomputed from the dumped feature fields by calling the actual
// scorer registry (scoreSignalWithModel), not by re-deriving the formulas here.

const { scoreSignalWithModel } = __signalQualityKpisInternalsForTests;

const TIMEFRAMES = ["5m", "15m", "1h"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

const DIRECTIONS = ["long", "short"] as const;
type Direction = (typeof DIRECTIONS)[number];

// The three scorers named in the plan: the current production/observed score
// ("raw base") plus the two expected-move candidates it's being compared
// against. All three are already registered model keys in signal-quality-kpis.ts.
const SCORERS: SignalScoreModelKey[] = [
  "observed-score",
  "expected-move-v1",
  "expected-move-v2",
];
const SCORER_LABELS: Record<string, string> = {
  "observed-score": "raw base (observed-score)",
  "expected-move-v1": "expected-move-v1",
  "expected-move-v2": "expected-move-v2",
};

const SCORE_THRESHOLDS = [90, 75] as const;
const MFE_THRESHOLDS = [10, 20, 30] as const;
const BIG_MOVER_MFE_THRESHOLD = 30;

const SCORE_BUCKET_KEYS = [
  "90-100",
  "80-90",
  "70-80",
  "60-70",
  "50-60",
  "40-50",
  "30-40",
  "20-30",
  "10-20",
  "0-10",
  "unknown",
] as const;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CALIBRATION_DIR = path.join(REPO_ROOT, ".pyrus-runtime", "calibration");
const REPORT_JSON_PATH = path.join(CALIBRATION_DIR, "big-mover-recall.json");
const REPORT_MD_PATH = path.join(CALIBRATION_DIR, "big-mover-recall.md");

type DumpRow = SignalScoreCalibrationObservation & { symbol?: string };

type DumpHeader = {
  header: true;
  resolvedTimeframe: string;
  outcomeHorizonBars: number;
  count: number;
};

type LoadedDump = {
  exists: true;
  path: string;
  dumpMtime: string;
  header: DumpHeader | null;
  rows: DumpRow[];
};

type MissingDump = { exists: false; path: string };

function loadDump(timeframe: Timeframe): LoadedDump | MissingDump {
  const filePath = path.join(CALIBRATION_DIR, `observations-${timeframe}.jsonl`);
  if (!existsSync(filePath)) {
    return { exists: false, path: filePath };
  }
  const dumpMtime = statSync(filePath).mtime.toISOString();
  const lines = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (!lines.length) {
    return { exists: true, path: filePath, dumpMtime, header: null, rows: [] };
  }
  const first = JSON.parse(lines[0]) as unknown;
  const header =
    first && typeof first === "object" && (first as { header?: unknown }).header === true
      ? (first as DumpHeader)
      : null;
  const dataLines = header ? lines.slice(1) : lines;
  const rows = dataLines.map((line) => JSON.parse(line) as DumpRow);
  return { exists: true, path: filePath, dumpMtime, header, rows };
}

function bucketForScore(score: number | null): (typeof SCORE_BUCKET_KEYS)[number] {
  if (score == null || !Number.isFinite(score)) {
    return "unknown";
  }
  const clamped = Math.min(100, Math.max(0, score));
  const lower = clamped >= 100 ? 90 : Math.floor(clamped / 10) * 10;
  return `${lower}-${lower + 10}` as (typeof SCORE_BUCKET_KEYS)[number];
}

type ComboCell = {
  scoreThreshold: number;
  mfeThreshold: number;
  jointCount: number;
  mfePopulationCount: number;
  scorePopulationCount: number;
  recall: number | null;
  precision: number | null;
};

type BigMoverBucket = {
  bucket: (typeof SCORE_BUCKET_KEYS)[number];
  count: number;
  fraction: number | null;
};

type ScorerCell = {
  timeframe: Timeframe;
  direction: Direction;
  scorer: SignalScoreModelKey;
  totalObservations: number;
  scorableCount: number;
  combos: ComboCell[];
  bigMoverThreshold: number;
  bigMoverCount: number;
  bigMoverScoreDistribution: BigMoverBucket[];
};

function buildScorerCell(
  timeframe: Timeframe,
  direction: Direction,
  scorer: SignalScoreModelKey,
  directionRows: DumpRow[],
): ScorerCell {
  const scored = directionRows.map((row) => ({
    row,
    score: scoreSignalWithModel(row, scorer),
  }));
  const scorableCount = scored.filter((entry) => entry.score != null).length;

  const combos: ComboCell[] = [];
  for (const scoreThreshold of SCORE_THRESHOLDS) {
    for (const mfeThreshold of MFE_THRESHOLDS) {
      const mfePopulationCount = scored.filter(
        (entry) => entry.row.mfePercent >= mfeThreshold,
      ).length;
      const scorePopulationCount = scored.filter(
        (entry) => entry.score != null && entry.score >= scoreThreshold,
      ).length;
      const jointCount = scored.filter(
        (entry) =>
          entry.score != null &&
          entry.score >= scoreThreshold &&
          entry.row.mfePercent >= mfeThreshold,
      ).length;
      combos.push({
        scoreThreshold,
        mfeThreshold,
        jointCount,
        mfePopulationCount,
        scorePopulationCount,
        recall: mfePopulationCount > 0 ? jointCount / mfePopulationCount : null,
        precision: scorePopulationCount > 0 ? jointCount / scorePopulationCount : null,
      });
    }
  }

  const bigMovers = scored.filter(
    (entry) => entry.row.mfePercent >= BIG_MOVER_MFE_THRESHOLD,
  );
  const bucketCounts = new Map<string, number>();
  for (const entry of bigMovers) {
    const bucket = bucketForScore(entry.score);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const bigMoverScoreDistribution: BigMoverBucket[] = SCORE_BUCKET_KEYS.filter(
    (bucket) => bucket !== "unknown" || (bucketCounts.get("unknown") ?? 0) > 0,
  ).map((bucket) => {
    const count = bucketCounts.get(bucket) ?? 0;
    return {
      bucket,
      count,
      fraction: bigMovers.length > 0 ? count / bigMovers.length : null,
    };
  });

  return {
    timeframe,
    direction,
    scorer,
    totalObservations: directionRows.length,
    scorableCount,
    combos,
    bigMoverThreshold: BIG_MOVER_MFE_THRESHOLD,
    bigMoverCount: bigMovers.length,
    bigMoverScoreDistribution,
  };
}

function formatPercent(value: number | null): string {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

type DumpSummary =
  | {
      exists: true;
      path: string;
      dumpMtime: string;
      resolvedTimeframe: string | null;
      outcomeHorizonBars: number | null;
      headerCount: number | null;
      rowCount: number;
    }
  | { exists: false; path: string };

function summarizeDump(dump: LoadedDump | MissingDump): DumpSummary {
  if (!dump.exists) {
    return { exists: false, path: dump.path };
  }
  return {
    exists: true,
    path: dump.path,
    dumpMtime: dump.dumpMtime,
    resolvedTimeframe: dump.header?.resolvedTimeframe ?? null,
    outcomeHorizonBars: dump.header?.outcomeHorizonBars ?? null,
    headerCount: dump.header?.count ?? null,
    rowCount: dump.rows.length,
  };
}

function renderMarkdown(report: {
  horizonDefinition: string;
  scoreThresholds: readonly number[];
  mfeThresholds: readonly number[];
  bigMoverThreshold: number;
  dumps: Record<Timeframe, DumpSummary>;
  notes: string[];
  cells: ScorerCell[];
}): string {
  const lines: string[] = [];
  lines.push("# Big-mover recall report");
  lines.push("");
  lines.push(
    "Anchor report for `PLAN_2026-07-03_signal-scoring-calibration.md` Task 2 -- measures P(score >= threshold | MFE >= threshold) before any scorer changes.",
  );
  lines.push("");
  lines.push(`**Horizon definition:** ${report.horizonDefinition}`);
  lines.push("");
  lines.push("## Dumps");
  lines.push("");
  lines.push("| Timeframe | Exists | Dump mtime | resolvedTimeframe | outcomeHorizonBars | Rows |");
  lines.push("|---|---|---|---|---|---|");
  for (const timeframe of TIMEFRAMES) {
    const dump = report.dumps[timeframe];
    if (!dump.exists) {
      lines.push(`| ${timeframe} | no | - | - | - | - |`);
      continue;
    }
    lines.push(
      `| ${timeframe} | yes | ${dump.dumpMtime} | ${dump.resolvedTimeframe ?? "n/a"} | ${
        dump.outcomeHorizonBars ?? "n/a"
      } | ${dump.rowCount} |`,
    );
  }
  lines.push("");
  if (report.notes.length) {
    lines.push("## Notes");
    lines.push("");
    for (const note of report.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  for (const timeframe of TIMEFRAMES) {
    const dump = report.dumps[timeframe];
    if (!dump.exists) {
      continue;
    }
    lines.push(`## ${timeframe}`);
    lines.push("");
    for (const direction of DIRECTIONS) {
      lines.push(`### ${timeframe} / ${direction}`);
      lines.push("");
      for (const scorer of SCORERS) {
        const cell = report.cells.find(
          (candidate) =>
            candidate.timeframe === timeframe &&
            candidate.direction === direction &&
            candidate.scorer === scorer,
        );
        if (!cell) {
          continue;
        }
        lines.push(
          `**${SCORER_LABELS[scorer] ?? scorer}** (n=${cell.totalObservations}, scorable=${cell.scorableCount})`,
        );
        lines.push("");
        lines.push(
          "| score >= | MFE >= | joint n | MFE-pop n | score-pop n | recall P(score≥T∣MFE≥M) | precision P(MFE≥M∣score≥T) |",
        );
        lines.push("|---|---|---|---|---|---|---|");
        for (const combo of cell.combos) {
          lines.push(
            `| ${combo.scoreThreshold} | ${combo.mfeThreshold}% | ${combo.jointCount} | ${combo.mfePopulationCount} | ${combo.scorePopulationCount} | ${formatPercent(
              combo.recall,
            )} | ${formatPercent(combo.precision)} |`,
          );
        }
        lines.push("");
        lines.push(
          `Score-decile distribution of big movers (MFE >= ${cell.bigMoverThreshold}%, n=${cell.bigMoverCount}):`,
        );
        lines.push("");
        lines.push("| score band | n | fraction of big movers |");
        lines.push("|---|---|---|");
        for (const bucket of cell.bigMoverScoreDistribution) {
          lines.push(
            `| ${bucket.bucket} | ${bucket.count} | ${formatPercent(bucket.fraction)} |`,
          );
        }
        lines.push("");
      }
    }
  }

  return lines.join("\n") + "\n";
}

async function main(): Promise<void> {
  const dumps = {} as Record<Timeframe, LoadedDump | MissingDump>;
  const notes: string[] = [];
  for (const timeframe of TIMEFRAMES) {
    const dump = loadDump(timeframe);
    dumps[timeframe] = dump;
    if (!dump.exists) {
      notes.push(
        `${timeframe}: no dump found at ${dump.path} -- run signal-scoring:observation-dump for this timeframe first.`,
      );
    } else if (!dump.rows.length) {
      notes.push(`${timeframe}: dump exists but has 0 observation rows.`);
    }
  }

  const cells: ScorerCell[] = [];
  for (const timeframe of TIMEFRAMES) {
    const dump = dumps[timeframe];
    if (!dump.exists || !dump.rows.length) {
      continue;
    }
    for (const direction of DIRECTIONS) {
      const directionRows = dump.rows.filter((row) => row.direction === direction);
      for (const scorer of SCORERS) {
        cells.push(buildScorerCell(timeframe, direction, scorer, directionRows));
      }
    }
  }

  const dumpsSummary = Object.fromEntries(
    TIMEFRAMES.map((timeframe) => [timeframe, summarizeDump(dumps[timeframe])]),
  ) as Record<Timeframe, DumpSummary>;

  const report = {
    deploymentId: "7e2e4e6f-749f-4e65-a011-87d3559a23b0",
    horizonDefinition:
      "MFE% is the max favorable excursion within outcomeHorizonBars bars of the signal's own timeframe (per-TF outcomeHorizonBars shown in the dumps table below) -- the KPI harness's existing forward-return window, not a fixed wall-clock horizon.",
    scoreThresholds: SCORE_THRESHOLDS,
    mfeThresholds: MFE_THRESHOLDS,
    bigMoverThreshold: BIG_MOVER_MFE_THRESHOLD,
    scorers: SCORERS,
    dumps: dumpsSummary,
    notes,
    cells,
  };

  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(CALIBRATION_DIR, { recursive: true });
  writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(REPORT_MD_PATH, renderMarkdown(report));

  console.log(
    JSON.stringify(
      {
        reportJson: REPORT_JSON_PATH,
        reportMd: REPORT_MD_PATH,
        cellCount: cells.length,
        notes,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
