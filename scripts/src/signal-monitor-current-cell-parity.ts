import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  signalMonitorProfilesTable,
} from "@workspace/db";
import {
  __signalMonitorInternalsForTests,
  buildSignalMonitorCurrentCellParityReport,
  resolveSignalMonitorProfileUniverse,
  type SignalMonitorMatrixTimeframe,
} from "../../artifacts/api-server/src/services/signal-monitor";

type RuntimeMode = "shadow" | "live";

type Config = {
  environment: RuntimeMode;
  symbols: string[] | null;
  timeframes: SignalMonitorMatrixTimeframe[];
  maxSymbols: number | null;
  batchSize: number;
  includeInactive: boolean;
  mismatchLimit: number;
  json: boolean;
};

const VALID_TIMEFRAMES: SignalMonitorMatrixTimeframe[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
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
    "  pnpm --filter @workspace/scripts run signal-monitor:current-cell-parity -- [--environment=shadow] [--symbols=SPY,QQQ] [--timeframes=5m,15m] [--max-symbols=100] [--batch-size=5] [--include-inactive] [--mismatch-limit=50] [--json]",
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

function parseTimeframes(raw: string | null): SignalMonitorMatrixTimeframe[] {
  const values = (raw || VALID_TIMEFRAMES.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const timeframes = values.filter((item): item is SignalMonitorMatrixTimeframe =>
    VALID_TIMEFRAMES.includes(item as SignalMonitorMatrixTimeframe),
  );
  if (timeframes.length !== values.length || !timeframes.length) {
    throw new Error(`Invalid --timeframes. Use one of: ${VALID_TIMEFRAMES.join(",")}`);
  }
  return Array.from(new Set(timeframes));
}

function parseSymbols(raw: string | null): string[] | null {
  if (!raw) return null;
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length ? Array.from(new Set(symbols)) : null;
}

function parseNonNegativeInteger(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid non-negative integer: ${raw}`);
  }
  return Math.floor(value);
}

function parsePositiveInteger(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`Invalid positive integer: ${raw}`);
  }
  return Math.floor(value);
}

function readConfig(): Config {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(usage());
    process.exit(0);
  }
  return {
    environment: parseEnvironment(),
    symbols: parseSymbols(argValue("--symbols")),
    timeframes: parseTimeframes(argValue("--timeframes")),
    maxSymbols: parsePositiveInteger(argValue("--max-symbols")),
    batchSize: parseNonNegativeInteger(argValue("--batch-size"), 5) || 5,
    includeInactive: hasArg("--include-inactive"),
    mismatchLimit: parseNonNegativeInteger(argValue("--mismatch-limit"), 50),
    json: hasArg("--json"),
  };
}

async function loadExistingSignalMonitorProfile(environment: RuntimeMode) {
  const [profile] = await db
    .select()
    .from(signalMonitorProfilesTable)
    .where(eq(signalMonitorProfilesTable.environment, environment))
    .limit(1);
  if (!profile) {
    throw new Error(`No existing signal_monitor_profiles row for ${environment}.`);
  }
  return profile;
}

function applyMaxSymbols(symbols: string[], maxSymbols: number | null): string[] {
  const normalized = Array.from(
    new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
  return maxSymbols == null ? normalized : normalized.slice(0, maxSymbols);
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  const chunkSize = Math.max(1, Math.floor(size));
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function summarizeMismatches(
  mismatches: Awaited<
    ReturnType<typeof buildSignalMonitorCurrentCellParityReport>
  >["mismatches"],
) {
  const byField: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  for (const mismatch of mismatches) {
    byField[mismatch.field] = (byField[mismatch.field] ?? 0) + 1;
    byReason[mismatch.reason] = (byReason[mismatch.reason] ?? 0) + 1;
  }
  return { byField, byReason };
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
  const profile = await loadExistingSignalMonitorProfile(config.environment);
  const universe = await resolveSignalMonitorProfileUniverse(profile, {
    ensureWatchlist: false,
  });
  const profileSymbols = __signalMonitorInternalsForTests.resolveSignalMonitorUniverseSymbols(
    universe,
  );
  const selectedSymbols = applyMaxSymbols(
    config.symbols ?? profileSymbols,
    config.maxSymbols,
  );
  const symbolBatches = selectedSymbols.length
    ? chunk(selectedSymbols, config.batchSize)
    : [[]];
  const counts = {
    comparedCells: 0,
    missingStoredCells: 0,
    missingDerivedCells: 0,
    mismatches: 0,
  };
  const allMismatches: Awaited<
    ReturnType<typeof buildSignalMonitorCurrentCellParityReport>
  >["mismatches"] = [];
  for (const symbols of symbolBatches) {
    const report = await buildSignalMonitorCurrentCellParityReport({
      profile,
      symbols,
      timeframes: config.timeframes,
      includeInactive: config.includeInactive,
    });
    counts.comparedCells += report.counts.comparedCells;
    counts.missingStoredCells += report.counts.missingStoredCells;
    counts.missingDerivedCells += report.counts.missingDerivedCells;
    counts.mismatches += report.counts.mismatches;
    allMismatches.push(...report.mismatches);
  }
  const mismatchSummary = summarizeMismatches(allMismatches);
  const output = {
    environment: config.environment,
    profileId: profile.id,
    enabled: profile.enabled,
    includeInactive: config.includeInactive,
    requestedSymbols: selectedSymbols.length,
    profileUniverseSymbols: profileSymbols.length,
    batchSize: config.batchSize,
    batches: symbolBatches.length,
    truncatedByMaxSymbols:
      config.maxSymbols != null && profileSymbols.length > selectedSymbols.length,
    timeframes: config.timeframes,
    counts,
    mismatchSummary,
    sampleMismatches: allMismatches.slice(0, config.mismatchLimit),
  };

  if (config.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log("Signal Monitor current-cell parity");
  console.log(`Environment: ${output.environment}`);
  console.log(`Profile: ${output.profileId} (${output.enabled ? "enabled" : "disabled"})`);
  console.log(
    `Symbols: ${output.requestedSymbols}/${output.profileUniverseSymbols}` +
      (output.truncatedByMaxSymbols ? " (truncated)" : ""),
  );
  console.log(`Batches: ${output.batches} x <=${output.batchSize}`);
  console.log(`Timeframes: ${output.timeframes.join(", ")}`);
  console.log(`Compared cells: ${output.counts.comparedCells}`);
  console.log(`Missing stored cells: ${output.counts.missingStoredCells}`);
  console.log(`Missing derived cells: ${output.counts.missingDerivedCells}`);
  console.log(`Mismatches: ${output.counts.mismatches}`);
  console.log(`By field: ${JSON.stringify(output.mismatchSummary.byField)}`);
  console.log(`By reason: ${JSON.stringify(output.mismatchSummary.byReason)}`);
  if (output.sampleMismatches.length) {
    console.log("Sample mismatches:");
    for (const mismatch of output.sampleMismatches) {
      console.log(
        `- ${mismatch.symbol} ${mismatch.timeframe} ${mismatch.field} ${mismatch.reason}: stored=${JSON.stringify(
          mismatch.stored,
        )} derived=${JSON.stringify(mismatch.derived)}`,
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
