import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { refreshDeploymentSignalQualityKpiSnapshot } from "../../artifacts/api-server/src/services/signal-quality-kpis-service";

// Regenerates raw observation dumps for the score-model calibration tooling
// (PLAN_2026-07-03_signal-scoring-calibration.md, Task 1). Calls the KPI
// service directly (no HTTP, no API reload) against bar_cache history -- fully
// offline, matching the plan's constraint.
//
// Usage:
//   pnpm --filter @workspace/scripts run signal-scoring:observation-dump
//   pnpm --filter @workspace/scripts run signal-scoring:observation-dump -- 5m

const DEPLOYMENT_ID = "7e2e4e6f-749f-4e65-a011-87d3559a23b0"; // Pyrus Signals Options Shadow

const TIMEFRAMES = ["5m", "15m", "1h"] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

// Resolve relative to this file (not process.cwd(), which varies by how the
// pnpm script is invoked) so the dump always lands in the repo-root durable,
// git-ignored dir the plan specifies.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CALIBRATION_DIR = path.join(REPO_ROOT, ".pyrus-runtime", "calibration");

function dumpPathFor(timeframe: Timeframe): string {
  return path.join(CALIBRATION_DIR, `observations-${timeframe}.jsonl`);
}

function parseTimeframeArg(): Timeframe | null {
  const raw = process.argv[2];
  if (!raw) {
    return null;
  }
  if (!(TIMEFRAMES as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid timeframe "${raw}". Use one of: ${TIMEFRAMES.join(", ")}`,
    );
  }
  return raw as Timeframe;
}

function countLines(filePath: string): number {
  if (!existsSync(filePath)) {
    return 0;
  }
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

async function dumpTimeframe(
  timeframe: Timeframe,
): Promise<{ timeframe: Timeframe; path: string; lineCount: number }> {
  const dumpPath = dumpPathFor(timeframe);
  // The KPI service's onObservations hook APPENDS to
  // SIGNAL_QUALITY_OBSERVATION_DUMP_PATH (signal-quality-kpis-service.ts,
  // "Env-gated raw-observation dump" block). Delete first so a re-run
  // replaces rather than double-appends.
  if (existsSync(dumpPath)) {
    rmSync(dumpPath);
  }
  process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH = dumpPath;
  try {
    await refreshDeploymentSignalQualityKpiSnapshot({
      deploymentId: DEPLOYMENT_ID,
      draft: { signalTimeframe: timeframe },
    });
  } finally {
    delete process.env.SIGNAL_QUALITY_OBSERVATION_DUMP_PATH;
  }
  return { timeframe, path: dumpPath, lineCount: countLines(dumpPath) };
}

async function main(): Promise<void> {
  mkdirSync(CALIBRATION_DIR, { recursive: true });
  const only = parseTimeframeArg();
  const timeframes = only ? [only] : [...TIMEFRAMES];

  // The KPI compute path's internal wait/retry timers are unref'd, so a
  // standalone process can exit mid-run once the microtask queue drains
  // between awaits. Keep one ref'd handle alive for the duration of the run;
  // cleared in the finally below once every timeframe has finished.
  const keepalive = setInterval(() => {}, 60_000);
  try {
    const results: Array<{ timeframe: Timeframe; path: string; lineCount: number }> = [];
    for (const timeframe of timeframes) {
      console.log(`[signal-scoring-observation-dump] dumping ${timeframe}...`);
      const result = await dumpTimeframe(timeframe);
      console.log(
        `[signal-scoring-observation-dump] ${timeframe}: ${result.lineCount} lines -> ${result.path}`,
      );
      results.push(result);
    }
    console.log(
      JSON.stringify({ deploymentId: DEPLOYMENT_ID, results }, null, 2),
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
