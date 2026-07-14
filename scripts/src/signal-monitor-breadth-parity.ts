import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";
import { pool } from "@workspace/db";
import {
  buildSignalMonitorBreadthParityReport,
  type SignalMonitorBreadthHistoryRange,
  type SignalMonitorBreadthParityReport,
} from "../../artifacts/api-server/src/services/signal-monitor";

type RuntimeMode = "shadow" | "live";

type Config = {
  environment: RuntimeMode;
  ranges: SignalMonitorBreadthHistoryRange[];
  now: Date | null;
  mismatchLimit: number;
  json: boolean;
  help: boolean;
};

const VALID_RANGES: SignalMonitorBreadthHistoryRange[] = [
  "hour",
  "day",
  "week",
  "month",
];
const MAX_MISMATCH_LIMIT = 10_000;
const MAX_DIAGNOSTIC_LENGTH = 500;
// ponytail: current report fields are compact and schema-bounded; move large
// diagnostics to a structured artifact before raising this terminal ceiling.
const MAX_OUTPUT_FIELD_LENGTH = 1_000;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const JSON_TERMINAL_PATTERN =
  /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @workspace/scripts run signal-monitor:breadth-parity -- [--environment=shadow|live] [--ranges=hour,day,week,month] [--now=2026-06-26T16:00:00.000Z] [--mismatch-limit=0..10000] [--json] [--help]",
    "",
    "Read-only diagnostic. No writes or repairs are performed.",
  ].join("\n");
}

function parseEnvironment(raw: string | undefined): RuntimeMode {
  const environment = raw ?? "shadow";
  if (environment !== "shadow" && environment !== "live") {
    throw new Error("Use --environment=shadow or --environment=live.");
  }
  return environment;
}

function parseRanges(
  raw: string | undefined,
): SignalMonitorBreadthHistoryRange[] {
  if (raw === undefined) return [...VALID_RANGES];
  const values = raw.split(",").map((item) => item.trim());
  const ranges = values.filter(
    (item): item is SignalMonitorBreadthHistoryRange =>
      VALID_RANGES.includes(item as SignalMonitorBreadthHistoryRange),
  );
  if (
    ranges.length !== values.length ||
    !ranges.length ||
    new Set(ranges).size !== ranges.length
  ) {
    throw new Error(`Invalid --ranges. Use one of: ${VALID_RANGES.join(",")}`);
  }
  return ranges;
}

function parseMismatchLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  if (!/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new Error(
      "--mismatch-limit must be a canonical non-negative integer.",
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_MISMATCH_LIMIT) {
    throw new Error(`--mismatch-limit must be at most ${MAX_MISMATCH_LIMIT}.`);
  }
  return value;
}

function parseNow(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== raw) {
    throw new Error("--now must be a canonical UTC ISO timestamp.");
  }
  return date;
}

function readConfig(argv: string[] = process.argv.slice(2)): Config {
  try {
    const parsed = parseNodeArgs({
      args: argv[0] === "--" ? argv.slice(1) : argv,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        environment: { type: "string" },
        ranges: { type: "string" },
        now: { type: "string" },
        "mismatch-limit": { type: "string" },
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
    return {
      environment: parseEnvironment(parsed.values.environment),
      ranges: parseRanges(parsed.values.ranges),
      now: parseNow(parsed.values.now),
      mismatchLimit: parseMismatchLimit(parsed.values["mismatch-limit"]),
      json: parsed.values.json ?? false,
      help: parsed.values.help ?? false,
    };
  } catch (error) {
    throw new Error(`${usage()}\n${errorMessage(error)}`);
  }
}

function safeOutput(
  value: unknown,
  maxLength = MAX_OUTPUT_FIELD_LENGTH,
): string {
  const raw = String(value);
  const withoutCredentials = raw
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&#\s]*/giu,
      "$1[redacted]",
    );
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1)}…`;
}

function errorMessage(error: unknown): string {
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
  return (
    safeOutput(lines.join("\n"), MAX_DIAGNOSTIC_LENGTH) ||
    "Unknown breadth parity error"
  );
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error("Breadth parity report is not JSON serializable.");
  }
  return serialized.replace(
    JSON_TERMINAL_PATTERN,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`,
  );
}

function renderTextReport(report: SignalMonitorBreadthParityReport): string {
  const lines = [
    "Signal Monitor breadth parity",
    `Environment: ${safeOutput(report.environment)}`,
    `Generated at: ${safeOutput(report.generatedAt)}`,
    `Ranges: ${report.ranges.map((range) => safeOutput(range.range)).join(", ")}`,
  ];
  for (const range of report.ranges) {
    lines.push(
      `- ${safeOutput(range.range)}: from=${safeOutput(range.from)}, to=${safeOutput(range.to)}, bucket-minutes=${range.bucketMinutes}, snapshots=${range.snapshotRows}, seeds=${range.seedRows}, events=${range.eventRows}, covered=${range.snapshotsCoverWindow}, compared=${range.counts.comparedPoints}, mismatches=${range.counts.mismatches}`,
    );
  }
  lines.push(
    `Compared points: ${report.counts.comparedPoints}`,
    `Missing snapshot points: ${report.counts.missingSnapshotPoints}`,
    `Missing event points: ${report.counts.missingEventPoints}`,
    `Mismatches: ${report.counts.mismatches}`,
    `Event anchors: active=${report.eventAnchorCoverage.activeCells}, with-event=${report.eventAnchorCoverage.cellsWithEvent}, missing=${report.eventAnchorCoverage.cellsMissingEvent}, direction-mismatch=${report.eventAnchorCoverage.cellsDirectionMismatch}`,
    `By range: ${safeOutput(JSON.stringify(report.mismatchSummary.byRange))}`,
    `By timeframe: ${safeOutput(JSON.stringify(report.mismatchSummary.byTimeframe))}`,
    `By field: ${safeOutput(JSON.stringify(report.mismatchSummary.byField))}`,
    `By reason: ${safeOutput(JSON.stringify(report.mismatchSummary.byReason))}`,
  );
  if (report.mismatches.length) {
    lines.push(
      `Sample mismatches (showing ${report.mismatches.length} of ${report.counts.mismatches}):`,
    );
    for (const mismatch of report.mismatches) {
      lines.push(
        `- ${safeOutput(mismatch.range)} ${safeOutput(mismatch.timeframe)} ${safeOutput(mismatch.at)} ${safeOutput(mismatch.field)} ${safeOutput(mismatch.reason)}: snapshot=${safeOutput(mismatch.snapshot)} event=${safeOutput(mismatch.event)}`,
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  const config = readConfig();
  if (config.help) {
    console.log(usage());
    return;
  }
  const report = await buildSignalMonitorBreadthParityReport({
    environment: config.environment,
    ranges: config.ranges,
    now: config.now ?? undefined,
    mismatchLimit: config.mismatchLimit,
  });

  console.log(config.json ? serializeJson(report) : renderTextReport(report));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

export const __signalMonitorBreadthParityInternalsForTests = {
  errorMessage,
  readConfig,
  renderTextReport,
  serializeJson,
};

if (import.meta.url === invokedPath) {
  void main()
    .catch((error) => {
      console.error(errorMessage(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await pool.end();
      } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 1;
      }
    });
}
