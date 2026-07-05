import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import {
  buildSignalMonitorBreadthParityReport,
  type SignalMonitorBreadthHistoryRange,
} from "../../artifacts/api-server/src/services/signal-monitor";

type RuntimeMode = "shadow" | "live";

type Config = {
  environment: RuntimeMode;
  ranges: SignalMonitorBreadthHistoryRange[];
  now: Date | null;
  mismatchLimit: number;
  json: boolean;
};

const VALID_RANGES: SignalMonitorBreadthHistoryRange[] = [
  "hour",
  "day",
  "week",
  "month",
];

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @workspace/scripts run signal-monitor:breadth-parity -- [--environment=shadow] [--ranges=hour,day,week,month] [--now=2026-06-26T16:00:00.000Z] [--mismatch-limit=50] [--json]",
    "",
    "Read-only diagnostic. No writes or repairs are performed.",
  ].join("\n");
}

function parseEnvironment(): RuntimeMode {
  const environment = (argValue("--environment") || "shadow").trim();
  if (environment !== "shadow" && environment !== "live") {
    throw new Error("Use --environment=shadow or --environment=live.");
  }
  return environment;
}

function parseRanges(raw: string | null): SignalMonitorBreadthHistoryRange[] {
  const values = (raw || VALID_RANGES.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const ranges = values.filter((item): item is SignalMonitorBreadthHistoryRange =>
    VALID_RANGES.includes(item as SignalMonitorBreadthHistoryRange),
  );
  if (ranges.length !== values.length || !ranges.length) {
    throw new Error(`Invalid --ranges. Use one of: ${VALID_RANGES.join(",")}`);
  }
  return Array.from(new Set(ranges));
}

function parseNonNegativeInteger(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid non-negative integer: ${raw}`);
  }
  return Math.floor(value);
}

function parseNow(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid --now timestamp: ${raw}`);
  }
  return date;
}

function readConfig(): Config {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(usage());
    process.exit(0);
  }
  return {
    environment: parseEnvironment(),
    ranges: parseRanges(argValue("--ranges")),
    now: parseNow(argValue("--now")),
    mismatchLimit: parseNonNegativeInteger(argValue("--mismatch-limit"), 50),
    json: hasArg("--json"),
  };
}

function formatError(error: unknown): string {
  const lines = [error instanceof Error ? error.message : String(error)];
  const cause =
    error && typeof error === "object" && "cause" in error
      ? (error as { cause?: unknown }).cause
      : null;
  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    const message = record["message"];
    if (message) lines.push(`Cause: ${String(message)}`);
    for (const key of ["code", "detail", "hint", "position"]) {
      if (record[key]) lines.push(`${key}: ${String(record[key])}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const config = readConfig();
  const report = await buildSignalMonitorBreadthParityReport({
    environment: config.environment,
    ranges: config.ranges,
    now: config.now ?? undefined,
    mismatchLimit: config.mismatchLimit,
  });

  if (config.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("Signal Monitor breadth parity");
  console.log(`Environment: ${report.environment}`);
  console.log(`Generated at: ${report.generatedAt}`);
  console.log(`Ranges: ${report.ranges.map((range) => range.range).join(", ")}`);
  for (const range of report.ranges) {
    console.log(
      `- ${range.range}: snapshots=${range.snapshotRows}, seeds=${range.seedRows}, events=${range.eventRows}, covered=${range.snapshotsCoverWindow}, compared=${range.counts.comparedPoints}, mismatches=${range.counts.mismatches}`,
    );
  }
  console.log(`Compared points: ${report.counts.comparedPoints}`);
  console.log(`Missing snapshot points: ${report.counts.missingSnapshotPoints}`);
  console.log(`Missing event points: ${report.counts.missingEventPoints}`);
  console.log(`Mismatches: ${report.counts.mismatches}`);
  console.log(`By range: ${JSON.stringify(report.mismatchSummary.byRange)}`);
  console.log(`By timeframe: ${JSON.stringify(report.mismatchSummary.byTimeframe)}`);
  console.log(`By field: ${JSON.stringify(report.mismatchSummary.byField)}`);
  console.log(`By reason: ${JSON.stringify(report.mismatchSummary.byReason)}`);
  if (report.mismatches.length) {
    console.log("Sample mismatches:");
    for (const mismatch of report.mismatches) {
      console.log(
        `- ${mismatch.range} ${mismatch.timeframe} ${mismatch.at} ${mismatch.field} ${mismatch.reason}: snapshot=${mismatch.snapshot} event=${mismatch.event}`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(formatError(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
