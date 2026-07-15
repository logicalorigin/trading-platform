import { pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import {
  classifyFlowUniverseOptionabilityProbeResult,
  loadFlowUniverseOptionabilityCandidates,
  markFlowUniverseOptionability,
  type FlowUniverseOptionabilityCandidate,
  type FlowUniverseOptionabilityProbeResult,
} from "../../artifacts/api-server/src/services/flow-universe-optionability-verifier";
import {
  loadWatchlistUniversePrioritySymbols,
  parseUniversePrioritySymbolList,
  uniqueUniversePrioritySymbols,
} from "./universe-priority";

type CliOptions = {
  limit: number;
  delayMs: number;
  force: boolean;
  execute: boolean;
  explicitSymbols: string[];
  includeWatchlists: boolean;
  help: boolean;
};

type VerificationDependencies = {
  loadWatchlistSymbols: () => Promise<string[]>;
  loadCandidates: (input: {
    limit: number;
    markets: readonly string[];
    prioritySymbols: readonly string[];
    force: boolean;
  }) => Promise<FlowUniverseOptionabilityCandidate[]>;
  fetchExpirations: (input: {
    underlying: string;
    maxExpirations: number;
    recordBridgeFailure: boolean;
    foregroundWaitMs: number;
    timeoutMs: number;
  }) => Promise<FlowUniverseOptionabilityProbeResult>;
  markOptionability: (input: {
    symbol: string;
    market: string;
    listingKey: string;
    status: "verified" | "rejected";
    reason: string | null;
    verifiedAt: Date;
    source: string;
  }) => Promise<void>;
  timeoutMs: number;
  wait: (ms: number) => Promise<void>;
  now: () => Date;
};

const USAGE =
  "Usage: pnpm --filter @workspace/scripts run universe:verify:optionability -- [--execute] [--limit=POSITIVE_INTEGER] [--delay-ms=NON_NEGATIVE_INTEGER] [--force=true|false] [--symbols=SYMBOL,...] [--watchlists=true|false] [--help]";
const MAX_DIAGNOSTIC_LENGTH = 400;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function parseBooleanValue(
  name: string,
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`--${name} must be true or false.`);
}

function parseInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  allowZero: boolean,
): number {
  if (raw === undefined) return fallback;
  const pattern = allowZero ? /^(?:0|[1-9]\d*)$/u : /^[1-9]\d*$/u;
  if (!pattern.test(raw)) {
    throw new Error(
      `--${name} must be a canonical ${allowZero ? "non-negative" : "positive"} integer.`,
    );
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--${name} is outside the supported range.`);
  }
  return parsed;
}

function parseOptions(args = process.argv.slice(2)): CliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  try {
    const parsed = parseArgs({
      args: normalizedArgs,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        execute: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        limit: { type: "string" },
        "delay-ms": { type: "string" },
        force: { type: "string" },
        symbols: { type: "string" },
        watchlists: { type: "string" },
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
    const help = parsed.values.help ?? false;
    if (help && parsed.tokens.length !== 1) {
      throw new Error("--help cannot be combined with other options.");
    }

    return {
      limit: parseInteger("limit", parsed.values.limit, 100, false),
      delayMs: parseInteger("delay-ms", parsed.values["delay-ms"], 750, true),
      force: parseBooleanValue("force", parsed.values.force, false),
      execute: parsed.values.execute ?? false,
      explicitSymbols: parseUniversePrioritySymbolList(
        parsed.values.symbols ?? null,
      ),
      includeWatchlists: parseBooleanValue(
        "watchlists",
        parsed.values.watchlists,
        true,
      ),
      help,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}\n${USAGE}`);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeDiagnostic(error: unknown): string {
  const withoutCredentials = String(
    error instanceof Error ? error.message : error,
  )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/\s+/gu, " ");
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown optionability verification error";
  if (diagnostic.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

async function runVerification(
  options: CliOptions,
  dependencies: VerificationDependencies,
) {
  const watchlistSymbols = options.includeWatchlists
    ? await dependencies.loadWatchlistSymbols()
    : [];
  const prioritySymbols = uniqueUniversePrioritySymbols([
    ...options.explicitSymbols,
    ...watchlistSymbols,
  ]);
  const rows = await dependencies.loadCandidates({
    limit: options.limit,
    markets: ["stocks", "etf"],
    prioritySymbols,
    force: options.force,
  });
  const results: Array<{
    symbol: string;
    status: "verified" | "rejected" | "error";
    reason: string | null;
  }> = [];

  for (const row of rows) {
    try {
      const expirations = await dependencies.fetchExpirations({
        underlying: row.symbol,
        maxExpirations: 1,
        recordBridgeFailure: false,
        foregroundWaitMs: dependencies.timeoutMs,
        timeoutMs: dependencies.timeoutMs,
      });
      const classification =
        classifyFlowUniverseOptionabilityProbeResult(expirations);
      if (classification.status !== "error" && options.execute) {
        await dependencies.markOptionability({
          symbol: row.symbol,
          market: row.market,
          listingKey: row.listingKey,
          status: classification.status,
          reason: classification.reason,
          verifiedAt: dependencies.now(),
          source: "option_expirations_probe",
        });
      }
      results.push({
        symbol: row.symbol,
        status: classification.status,
        reason: classification.reason,
      });
    } catch (error) {
      results.push({
        symbol: row.symbol,
        status: "error",
        reason: safeDiagnostic(error),
      });
    }
    if (options.delayMs > 0) {
      await dependencies.wait(options.delayMs);
    }
  }

  return {
    execute: options.execute,
    dryRun: !options.execute,
    force: options.force,
    explicitSymbolCount: options.explicitSymbols.length,
    watchlistSymbolCount: watchlistSymbols.length,
    prioritySymbolCount: prioritySymbols.length,
    requestedLimit: options.limit,
    attempted: results.length,
    verified: results.filter((result) => result.status === "verified").length,
    rejected: results.filter((result) => result.status === "rejected").length,
    errors: results.filter((result) => result.status === "error").length,
    sample: results.slice(0, 20),
  };
}

export const __verifyFlowUniverseOptionabilityInternalsForTests = {
  parseOptions,
  runVerification,
  safeDiagnostic,
};

async function runCli(): Promise<void> {
  let failed = false;
  let exitCode = 0;
  let closeDatabaseConnections: (() => Promise<void>) | null = null;
  try {
    const options = parseOptions();
    if (options.help) {
      console.log(USAGE);
    } else {
      const database = await import("@workspace/db");
      closeDatabaseConnections = database.closeDatabaseConnections;
      const platform = await import(
        "../../artifacts/api-server/src/services/platform"
      );
      const summary = await runVerification(options, {
        loadWatchlistSymbols: () =>
          loadWatchlistUniversePrioritySymbols(database.db),
        loadCandidates: (input) =>
          loadFlowUniverseOptionabilityCandidates({
            db: database.db,
            ...input,
          }),
        fetchExpirations: platform.getOptionExpirationsWithDebug,
        markOptionability: (input) =>
          markFlowUniverseOptionability({
            db: database.db,
            ...input,
          }),
        timeoutMs: platform.OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS,
        wait,
        now: () => new Date(),
      });
      console.log(JSON.stringify(summary, null, 2));
      if (summary.errors > 0) exitCode = 1;
    }
  } catch (error) {
    failed = true;
    console.error(safeDiagnostic(error));
    exitCode = 1;
  }
  if (closeDatabaseConnections) {
    try {
      await closeDatabaseConnections();
    } catch (error) {
      console.error(
        failed
          ? "Database cleanup also failed."
          : `Database cleanup failed: ${safeDiagnostic(error)}`,
      );
      exitCode = 1;
    }
  }
  process.exitCode = exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCli();
}
