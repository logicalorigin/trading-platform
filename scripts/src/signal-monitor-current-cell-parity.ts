import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";
import { eq } from "drizzle-orm";
import { db, pool, signalMonitorProfilesTable } from "@workspace/db";
import { normalizeSymbol } from "../../artifacts/api-server/src/lib/values";
import {
  buildSignalMonitorCurrentCellParityReport,
  resolveSignalMonitorProfileUniverse,
  type SignalMonitorCurrentCellParityMismatch,
  type SignalMonitorCurrentCellParityReport,
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
  help: boolean;
};

type MismatchSummary = {
  byField: Record<string, number>;
  byReason: Record<string, number>;
};

type DiagnosticOutput = {
  environment: RuntimeMode;
  profileId: string;
  enabled: boolean;
  includeInactive: boolean;
  symbolSource: "explicit" | "profile";
  candidateSymbols: number;
  requestedSymbols: number;
  profileUniverseSymbols: number | null;
  batchSize: number;
  batches: number;
  truncatedByMaxSymbols: boolean;
  scopeComplete: boolean;
  scopeWarning: string | null;
  universe:
    | (Awaited<
        ReturnType<typeof resolveSignalMonitorProfileUniverse>
      >["universe"] & {
        truncated: boolean;
      })
    | null;
  timeframes: SignalMonitorMatrixTimeframe[];
  counts: SignalMonitorCurrentCellParityReport["counts"];
  mismatchSummary: MismatchSummary;
  sampleMismatches: SignalMonitorCurrentCellParityMismatch[];
};

const VALID_TIMEFRAMES: SignalMonitorMatrixTimeframe[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
];
// Keep this trust-boundary ceiling aligned with the producer's
// SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT. Larger universes require a bounded-active-set
// design in the producer before this diagnostic can claim equivalent coverage.
const MAX_SYMBOLS = 2_000;
// A report can expand each symbol across six timeframes. This keeps the largest
// VALUES query comfortably below Postgres' bind-parameter ceiling.
const MAX_BATCH_SIZE = 1_000;
const MAX_MISMATCH_LIMIT = 10_000;
const MAX_DIAGNOSTIC_LENGTH = 500;
// ponytail: current report fields are compact and schema-bounded; move large
// diagnostics to a structured artifact before raising this terminal ceiling.
const MAX_OUTPUT_FIELD_LENGTH = 1_000;
const UNSAFE_SYMBOL_PATTERN =
  /[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const JSON_TERMINAL_PATTERN =
  /[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @workspace/scripts run signal-monitor:current-cell-parity -- [--environment=shadow|live] [--symbols=SPY,QQQ] [--timeframes=1m,2m,5m,15m,1h,1d] [--max-symbols=1..2000] [--batch-size=1..1000] [--include-inactive] [--mismatch-limit=0..10000] [--json] [--help]",
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

function parseTimeframes(
  raw: string | undefined,
): SignalMonitorMatrixTimeframe[] {
  if (raw === undefined) return [...VALID_TIMEFRAMES];
  const values = raw.split(",").map((item) => item.trim());
  const timeframes = values.filter(
    (item): item is SignalMonitorMatrixTimeframe =>
      VALID_TIMEFRAMES.includes(item as SignalMonitorMatrixTimeframe),
  );
  if (
    timeframes.length !== values.length ||
    !timeframes.length ||
    new Set(timeframes).size !== timeframes.length
  ) {
    throw new Error(
      `Invalid --timeframes. Use unique values from: ${VALID_TIMEFRAMES.join(",")}`,
    );
  }
  return timeframes;
}

function normalizeRequestedSymbol(raw: string): string {
  const symbol = normalizeSymbol(raw).toUpperCase();
  if (
    !symbol ||
    Array.from(symbol).length > 32 ||
    UNSAFE_SYMBOL_PATTERN.test(symbol)
  ) {
    throw new Error(
      "Each --symbols value must normalize to 1-32 non-whitespace characters.",
    );
  }
  return symbol;
}

function parseSymbols(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const values = raw.split(",").map((symbol) => symbol.trim());
  if (!values.length || values.some((symbol) => !symbol)) {
    throw new Error("--symbols requires at least one symbol.");
  }
  const symbols = Array.from(new Set(values.map(normalizeRequestedSymbol)));
  if (symbols.length > MAX_SYMBOLS) {
    throw new Error(`--symbols accepts at most ${MAX_SYMBOLS} unique symbols.`);
  }
  return symbols;
}

function parseCanonicalInteger(input: {
  name: string;
  raw: string | undefined;
  fallback: number | null;
  minimum: number;
  maximum: number;
}): number | null {
  if (input.raw === undefined) return input.fallback;
  const pattern = input.minimum === 0 ? /^(?:0|[1-9]\d*)$/u : /^[1-9]\d*$/u;
  if (!pattern.test(input.raw)) {
    throw new Error(`${input.name} must be a canonical integer.`);
  }
  const value = Number(input.raw);
  if (
    !Number.isSafeInteger(value) ||
    value < input.minimum ||
    value > input.maximum
  ) {
    throw new Error(
      `${input.name} must be between ${input.minimum} and ${input.maximum}.`,
    );
  }
  return value;
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
        symbols: { type: "string" },
        timeframes: { type: "string" },
        "max-symbols": { type: "string" },
        "batch-size": { type: "string" },
        "include-inactive": { type: "boolean" },
        "mismatch-limit": { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    const optionCounts = new Map<string, number>();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      optionCounts.set(token.name, (optionCounts.get(token.name) ?? 0) + 1);
    }
    if ([...optionCounts.values()].some((count) => count > 1)) {
      throw new Error("Duplicate options are not allowed.");
    }
    return {
      environment: parseEnvironment(parsed.values.environment),
      symbols: parseSymbols(parsed.values.symbols),
      timeframes: parseTimeframes(parsed.values.timeframes),
      maxSymbols: parseCanonicalInteger({
        name: "--max-symbols",
        raw: parsed.values["max-symbols"],
        fallback: null,
        minimum: 1,
        maximum: MAX_SYMBOLS,
      }),
      batchSize: parseCanonicalInteger({
        name: "--batch-size",
        raw: parsed.values["batch-size"],
        fallback: 5,
        minimum: 1,
        maximum: MAX_BATCH_SIZE,
      }) as number,
      includeInactive: parsed.values["include-inactive"] ?? false,
      mismatchLimit: parseCanonicalInteger({
        name: "--mismatch-limit",
        raw: parsed.values["mismatch-limit"],
        fallback: 50,
        minimum: 0,
        maximum: MAX_MISMATCH_LIMIT,
      }) as number,
      json: parsed.values.json ?? false,
      help: parsed.values.help ?? false,
    };
  } catch (error) {
    throw new Error(`${usage()}\n${errorMessage(error)}`);
  }
}

async function loadExistingSignalMonitorProfile(environment: RuntimeMode) {
  const [profile] = await db
    .select()
    .from(signalMonitorProfilesTable)
    .where(eq(signalMonitorProfilesTable.environment, environment))
    .limit(1);
  if (!profile) {
    throw new Error(
      `No existing signal_monitor_profiles row for ${environment}.`,
    );
  }
  return profile;
}

type Profile = Awaited<ReturnType<typeof loadExistingSignalMonitorProfile>>;
type UniverseResolution = Awaited<
  ReturnType<typeof resolveSignalMonitorProfileUniverse>
>;
type DiagnosticDependencies = {
  loadProfile: (environment: RuntimeMode) => Promise<Profile>;
  resolveUniverse: (profile: Profile) => Promise<UniverseResolution>;
  buildReport: typeof buildSignalMonitorCurrentCellParityReport;
};

const defaultDependencies: DiagnosticDependencies = {
  loadProfile: loadExistingSignalMonitorProfile,
  resolveUniverse: (profile) =>
    resolveSignalMonitorProfileUniverse(profile, { ensureWatchlist: false }),
  buildReport: buildSignalMonitorCurrentCellParityReport,
};

function selectSymbols(
  sourceSymbols: string[],
  maxSymbols: number | null,
): { candidates: string[]; selected: string[] } {
  const candidates = Array.from(
    new Set(sourceSymbols.map(normalizeRequestedSymbol)),
  );
  const limit = Math.min(maxSymbols ?? MAX_SYMBOLS, MAX_SYMBOLS);
  return {
    candidates,
    selected: candidates.slice(0, limit),
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function addReportToAggregate(
  aggregate: {
    counts: SignalMonitorCurrentCellParityReport["counts"];
    mismatchSummary: MismatchSummary;
    sampleMismatches: SignalMonitorCurrentCellParityMismatch[];
  },
  report: Pick<SignalMonitorCurrentCellParityReport, "counts" | "mismatches">,
  mismatchLimit: number,
): void {
  aggregate.counts.comparedCells += report.counts.comparedCells;
  aggregate.counts.missingStoredCells += report.counts.missingStoredCells;
  aggregate.counts.missingDerivedCells += report.counts.missingDerivedCells;
  aggregate.counts.mismatches += report.counts.mismatches;
  for (const mismatch of report.mismatches) {
    aggregate.mismatchSummary.byField[mismatch.field] =
      (aggregate.mismatchSummary.byField[mismatch.field] ?? 0) + 1;
    aggregate.mismatchSummary.byReason[mismatch.reason] =
      (aggregate.mismatchSummary.byReason[mismatch.reason] ?? 0) + 1;
    if (aggregate.sampleMismatches.length < mismatchLimit) {
      aggregate.sampleMismatches.push(mismatch);
    }
  }
}

async function runDiagnostic(
  config: Config,
  dependencies: DiagnosticDependencies = defaultDependencies,
): Promise<DiagnosticOutput> {
  const profile = await dependencies.loadProfile(config.environment);
  const universeResolution = config.symbols
    ? null
    : await dependencies.resolveUniverse(profile);
  const { candidates, selected } = selectSymbols(
    config.symbols ?? universeResolution?.symbols ?? [],
    config.maxSymbols,
  );
  if (!selected.length) {
    throw new Error(
      "The current-cell parity scope resolved no symbols; repair the profile universe or pass --symbols explicitly.",
    );
  }
  const symbolBatches = chunk(selected, config.batchSize);
  const aggregate = {
    counts: {
      comparedCells: 0,
      missingStoredCells: 0,
      missingDerivedCells: 0,
      mismatches: 0,
    },
    mismatchSummary: {
      byField: {},
      byReason: {},
    },
    sampleMismatches: [] as SignalMonitorCurrentCellParityMismatch[],
  };
  for (const symbols of symbolBatches) {
    const report = await dependencies.buildReport({
      profile,
      symbols,
      timeframes: config.timeframes,
      includeInactive: config.includeInactive,
    });
    addReportToAggregate(aggregate, report, config.mismatchLimit);
  }

  const rawScopeWarning = universeResolution
    ? (universeResolution.universe.degradedReason ??
      (universeResolution.fallbackUsed
        ? "The profile universe used fallback data."
        : null))
    : null;
  const scopeWarning = rawScopeWarning ? safeOutput(rawScopeWarning) : null;
  return {
    environment: config.environment,
    profileId: profile.id,
    enabled: profile.enabled,
    includeInactive: config.includeInactive,
    symbolSource: config.symbols ? "explicit" : "profile",
    candidateSymbols: candidates.length,
    requestedSymbols: selected.length,
    profileUniverseSymbols: universeResolution?.symbols.length ?? null,
    batchSize: config.batchSize,
    batches: symbolBatches.length,
    truncatedByMaxSymbols: candidates.length > selected.length,
    scopeComplete: scopeWarning == null,
    scopeWarning,
    universe: universeResolution
      ? {
          ...universeResolution.universe,
          degradedReason: universeResolution.universe.degradedReason
            ? safeOutput(universeResolution.universe.degradedReason)
            : null,
          truncated: universeResolution.truncated,
        }
      : null,
    timeframes: config.timeframes,
    counts: aggregate.counts,
    mismatchSummary: aggregate.mismatchSummary,
    sampleMismatches: aggregate.sampleMismatches,
  };
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
    "Unknown current-cell parity error"
  );
}

function serializeJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error("Current-cell parity output is not JSON serializable.");
  }
  return serialized.replace(
    JSON_TERMINAL_PATTERN,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0")}`,
  );
}

function jsonValue(value: unknown): string {
  return safeOutput(JSON.stringify(value) ?? "null");
}

function renderTextReport(output: DiagnosticOutput): string {
  const lines = [
    "Signal Monitor current-cell parity",
    `Environment: ${safeOutput(output.environment)}`,
    `Profile: ${safeOutput(output.profileId)} (${output.enabled ? "enabled" : "disabled"})`,
    `Scope complete: ${output.scopeComplete ? "yes" : "no"}`,
  ];
  if (output.scopeWarning) {
    lines.push(`Scope warning: ${safeOutput(output.scopeWarning)}`);
  }
  if (output.universe) {
    lines.push(
      `Universe: mode=${safeOutput(output.universe.mode)}, source=${safeOutput(output.universe.source)}, configured=${output.universe.configuredMaxSymbols}, resolved=${output.universe.resolvedSymbols}, fallback=${output.universe.fallbackUsed}, truncated=${output.universe.truncated}, ranked-at=${safeOutput(output.universe.rankedAt?.toISOString() ?? "none")}`,
    );
  } else {
    lines.push("Universe: explicit symbols (profile discovery skipped)");
  }
  lines.push(
    `Symbols: ${output.requestedSymbols}/${output.candidateSymbols} (source=${output.symbolSource}${output.truncatedByMaxSymbols ? ", max-symbols truncated" : ""})`,
    `Include inactive: ${output.includeInactive}`,
    `Batches: ${output.batches} x <=${output.batchSize}`,
    `Timeframes: ${output.timeframes.map(safeOutput).join(", ")}`,
    `Compared cells: ${output.counts.comparedCells}`,
    `Missing stored cells: ${output.counts.missingStoredCells}`,
    `Missing derived cells: ${output.counts.missingDerivedCells}`,
    `Mismatches: ${output.counts.mismatches}`,
    `By field: ${safeOutput(JSON.stringify(output.mismatchSummary.byField))}`,
    `By reason: ${safeOutput(JSON.stringify(output.mismatchSummary.byReason))}`,
  );
  lines.push(
    `Sample mismatches (showing ${output.sampleMismatches.length} of ${output.counts.mismatches}):`,
  );
  if (output.sampleMismatches.length) {
    for (const mismatch of output.sampleMismatches) {
      lines.push(
        `- ${safeOutput(mismatch.symbol)} ${safeOutput(mismatch.timeframe)} ${safeOutput(mismatch.field)} ${safeOutput(mismatch.reason)}: stored=${jsonValue(mismatch.stored)} derived=${jsonValue(mismatch.derived)}`,
      );
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const config = readConfig();
  if (config.help) {
    console.log(usage());
    return;
  }
  const output = await runDiagnostic(config);
  console.log(config.json ? serializeJson(output) : renderTextReport(output));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

export const __signalMonitorCurrentCellParityInternalsForTests = {
  errorMessage,
  readConfig,
  renderTextReport,
  runDiagnostic,
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
