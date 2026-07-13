import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  isDeepStrictEqual,
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  signalMonitorEventsTable,
  signalMonitorProfilesTable,
} from "@workspace/db";
import {
  isStatementTimeoutError,
  isTransientPostgresError,
} from "@workspace/db/transient-postgres-error";
import { normalizeSymbol } from "../../artifacts/api-server/src/lib/values";
import {
  __signalMonitorInternalsForTests,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
  getSignalMonitorTimeframeMs,
  isSignalMonitorBarEvaluationEnabled,
  loadSignalMonitorCompletedBars,
  resolveSignalMonitorProfileUniverse,
  type SignalMonitorDirection,
  type SignalMonitorMatrixTimeframe,
} from "../../artifacts/api-server/src/services/signal-monitor";

type RuntimeMode = "shadow" | "live";

type Config = {
  environment: RuntimeMode;
  from: Date;
  to: Date;
  timeframes: SignalMonitorMatrixTimeframe[];
  symbols: string[] | null;
  maxSymbols: number | null;
  write: boolean;
  progress: boolean;
};

export type Candidate = {
  eventKey: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  direction: SignalMonitorDirection;
  signalAt: Date;
  signalBarAt: Date;
  signalPrice: number | null;
  close: number | null;
  payload: Record<string, unknown>;
};

export type ScanFailure = {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: string;
  error: string;
  code: string | null;
  status: number | null;
  retryable: boolean;
  attempts: number;
  resolution: string;
};

type ScanDependencies = {
  loadCompletedBars: typeof loadSignalMonitorCompletedBars;
  evaluateState: typeof evaluateSignalMonitorMatrixStateFromCompletedBars;
  sleep: (milliseconds: number) => Promise<unknown>;
};

const VALID_TIMEFRAMES: SignalMonitorMatrixTimeframe[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
];
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const UNSAFE_SYMBOL_PATTERN =
  /[\s\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SCAN_RETRY_DELAYS_MS = [250, 1_000] as const;
const NON_RETRYABLE_SCAN_CODES = new Set([
  "signal_monitor_passive_signal_source",
  "massive_not_configured",
  "invalid_history",
  "invalid_request",
]);

const defaultScanDependencies: ScanDependencies = {
  loadCompletedBars: loadSignalMonitorCompletedBars,
  evaluateState: evaluateSignalMonitorMatrixStateFromCompletedBars,
  sleep,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function errorField(error: unknown, name: string, depth = 0): unknown {
  if (!error || depth > 4) return undefined;
  const record = asRecord(error);
  if (record[name] !== undefined) return record[name];
  return errorField(record.cause, name, depth + 1);
}

function safeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(errorField(error, "message") ?? "Unknown source failure");
  const clean = stripVTControlCharacters(raw)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!clean) return "Unknown source failure";
  const points = Array.from(clean);
  return points.length > 500 ? `${points.slice(0, 500).join("")}…` : clean;
}

function scanFailureDetails(error: unknown) {
  const rawCode = errorField(error, "code") ?? errorField(error, "errno");
  const code = typeof rawCode === "string" ? rawCode : null;
  const rawStatus =
    errorField(error, "statusCode") ?? errorField(error, "status");
  const status =
    typeof rawStatus === "number" && Number.isInteger(rawStatus)
      ? rawStatus
      : null;
  const retryable =
    !NON_RETRYABLE_SCAN_CODES.has(code ?? "") &&
    (isTransientPostgresError(error) ||
      isStatementTimeoutError(error) ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      (status !== null && status >= 500));
  return {
    error: safeErrorMessage(error),
    code,
    status,
    retryable,
  };
}

function sourceFailureResolution(
  details: ReturnType<typeof scanFailureDetails>,
  attempts: number,
): string {
  if (details.code === "massive_not_configured") {
    return "Set MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY, then rerun this exact scope.";
  }
  if (details.code === "signal_monitor_passive_signal_source") {
    return "Set PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=true for this explicit backfill run.";
  }
  if (details.code === "invalid_history") {
    return "Repair the reported completed-bar history, then rerun this exact scope.";
  }
  if (details.code === "invalid_request") {
    return "Correct the reported symbol, timeframe, or date scope, then rerun.";
  }
  return details.retryable
    ? `Transient source failure persisted after ${attempts} attempts; restore provider or database connectivity and rerun this exact scope.`
    : "Fix the reported source or data error, then rerun this exact scope.";
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @workspace/scripts run signal-monitor:events-backfill -- --from=<ISO> [--to=<ISO>] [--environment=shadow] [--timeframes=5m] [--symbols=SPY,QQQ] [--max-symbols=100] [--write --confirm-write] [--confirm-live]",
    "",
    "Dry-run is the default. Write mode requires --write and --confirm-write; live writes also require --confirm-live.",
  ].join("\n");
}

function isValidIsoCalendarDate(raw: string): boolean {
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth =
    month === 2
      ? leapYear
        ? 29
        : 28
      : [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}

function parseDateArg(
  name: string,
  raw: string | undefined,
  fallback?: Date,
): Date {
  if (raw === undefined && fallback) return new Date(fallback.getTime());
  if (raw === undefined) throw new Error(`Missing ${name}.\n${usage()}`);
  if (!ISO_INSTANT_PATTERN.test(raw) || !isValidIsoCalendarDate(raw)) {
    throw new Error(
      `Invalid ${name}: use an ISO timestamp with Z or an explicit offset.`,
    );
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return date;
}

function parseTimeframes(
  raw: string | undefined,
): SignalMonitorMatrixTimeframe[] {
  const values = (raw ?? "5m").split(",").map((item) => item.trim());
  const timeframes = values.filter(
    (item): item is SignalMonitorMatrixTimeframe =>
      VALID_TIMEFRAMES.includes(item as SignalMonitorMatrixTimeframe),
  );
  if (timeframes.length !== values.length || !timeframes.length) {
    throw new Error(
      `Invalid --timeframes. Use one of: ${VALID_TIMEFRAMES.join(",")}`,
    );
  }
  return Array.from(new Set(timeframes));
}

function normalizeBackfillSymbol(raw: string): string {
  const symbol = normalizeSymbol(raw).toUpperCase();
  if (
    !symbol ||
    Array.from(symbol).length > 32 ||
    UNSAFE_SYMBOL_PATTERN.test(symbol)
  ) {
    throw new Error(
      `Invalid backfill symbol ${JSON.stringify(safeErrorMessage(raw))}: each symbol must normalize to 1-32 non-whitespace characters.`,
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
  return Array.from(new Set(values.map(normalizeBackfillSymbol)));
}

function parsePositiveInteger(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error("--max-symbols must be a positive integer.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error("--max-symbols must be a safe positive integer.");
  }
  return value;
}

export function parseBackfillArgs(
  args: string[],
  now = new Date(),
): Config | null {
  const tokens = args[0] === "--" ? args.slice(1) : [...args];
  const parsed = parseNodeArgs({
    args: tokens,
    options: {
      environment: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      timeframes: { type: "string" },
      symbols: { type: "string" },
      "max-symbols": { type: "string" },
      write: { type: "boolean" },
      "confirm-write": { type: "boolean" },
      "confirm-live": { type: "boolean" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  for (const name of Object.keys(parsed.values)) {
    if (
      parsed.tokens.filter(
        (token) => token.kind === "option" && token.name === name,
      ).length > 1
    ) {
      throw new Error(`Duplicate argument: --${name}`);
    }
  }
  if (parsed.values.help === true) {
    return null;
  }

  const environment = (
    parsed.values.environment ?? "shadow"
  ).trim() as RuntimeMode;
  if (environment !== "shadow" && environment !== "live") {
    throw new Error("Use --environment=shadow or --environment=live.");
  }
  const to = parseDateArg("--to", parsed.values.to, now);
  const from = parseDateArg("--from", parsed.values.from);
  if (from.getTime() > to.getTime()) {
    throw new Error("--from must be at or before --to.");
  }
  const write = parsed.values.write === true;
  const confirmWrite = parsed.values["confirm-write"] === true;
  const confirmLive = parsed.values["confirm-live"] === true;
  if (write !== confirmWrite) {
    throw new Error("Write mode requires both --write and --confirm-write.");
  }
  if (environment === "live" && write && !confirmLive) {
    throw new Error("Live write mode also requires --confirm-live.");
  }
  if (confirmLive && !(environment === "live" && write)) {
    throw new Error("--confirm-live is valid only for a live write.");
  }

  return {
    environment,
    from,
    to,
    timeframes: parseTimeframes(parsed.values.timeframes),
    symbols: parseSymbols(parsed.values.symbols),
    maxSymbols: parsePositiveInteger(parsed.values["max-symbols"]),
    write,
    progress: parsed.values.quiet !== true,
  };
}

export function assertBackfillSourceEnabled(
  env: Record<string, string | undefined>,
): void {
  if (!isSignalMonitorBarEvaluationEnabled(env)) {
    throw new Error(
      "Historical signal evaluation is disabled. Set PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=true for this explicit backfill run.",
    );
  }
}

export async function findExistingSignalMonitorProfile(
  environment: RuntimeMode,
) {
  const [profile] = await db
    .select()
    .from(signalMonitorProfilesTable)
    .where(eq(signalMonitorProfilesTable.environment, environment))
    .limit(1);
  if (!profile) {
    throw new Error(
      `The ${environment} signal-monitor profile is missing; initialize it before running a backfill.`,
    );
  }
  return profile;
}

export function selectBackfillSymbols(
  requestedSymbols: string[] | null,
  universeSymbols: string[],
  maxSymbols: number | null,
): string[] {
  const symbols = Array.from(
    new Set((requestedSymbols ?? universeSymbols).map(normalizeBackfillSymbol)),
  ).slice(0, maxSymbols ?? Number.MAX_SAFE_INTEGER);
  if (!symbols.length) {
    throw new Error(
      "The requested backfill scope resolved no symbols; repair the profile universe or pass --symbols explicitly.",
    );
  }
  return symbols;
}

export function backfillUniverseFailureReason(
  resolution: {
    fallbackUsed?: boolean;
    universe: { degradedReason: string | null };
  } | null,
): string | null {
  if (!resolution) return null;
  const reason =
    resolution.universe.degradedReason ??
    (resolution.fallbackUsed
      ? "The profile universe used fallback data."
      : null);
  return reason
    ? `${safeErrorMessage(reason)} Pass --symbols explicitly after verifying the intended repair scope.`
    : null;
}

export function assertBackfillUniverseWritable(
  write: boolean,
  universeFailure: string | null,
): void {
  if (write && universeFailure) {
    throw new Error(
      `Backfill universe is degraded; nothing was scanned or written. ${universeFailure}`,
    );
  }
}

export function backfillScanDisposition(write: boolean, unrecoverable: number) {
  const scanComplete = unrecoverable === 0;
  return {
    scanComplete,
    writeBlocked: write && !scanComplete,
    queryExisting: !write && scanComplete,
  };
}

function numericStringOrNull(value: number | null): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(6)
    : null;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function directionFromEventType(eventType: string): SignalMonitorDirection {
  if (eventType === "buy_signal") return "buy";
  if (eventType === "sell_signal") return "sell";
  throw new Error(`Unsupported signal event type: ${eventType}`);
}

async function existingEventKeys(eventKeys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const batch of chunk(eventKeys, 500)) {
    if (!batch.length) continue;
    const rows = await db
      .select({ eventKey: signalMonitorEventsTable.eventKey })
      .from(signalMonitorEventsTable)
      .where(inArray(signalMonitorEventsTable.eventKey, batch));
    rows.forEach((row) => found.add(row.eventKey));
  }
  return found;
}

export async function scanCandidates(
  input: {
    profile: Awaited<ReturnType<typeof findExistingSignalMonitorProfile>>;
    symbols: string[];
    timeframes: SignalMonitorMatrixTimeframe[];
    from: Date;
    to: Date;
    progress: boolean;
  },
  dependencies: ScanDependencies = defaultScanDependencies,
) {
  const candidatesByKey = new Map<string, Candidate>();
  const ineligibleByKey = new Map<string, string>();
  const unrecoverable: ScanFailure[] = [];
  const retries = { attempted: 0, recovered: 0 };

  scan: for (const symbol of input.symbols) {
    for (const timeframe of input.timeframes) {
      const stepMs = getSignalMonitorTimeframeMs(timeframe);
      const scanToMs = input.to.getTime() + stepMs;
      for (
        let evaluatedMs = input.from.getTime();
        evaluatedMs <= scanToMs;
        evaluatedMs += stepMs
      ) {
        const evaluatedAt = new Date(evaluatedMs);
        let completedBars: Awaited<
          ReturnType<typeof loadSignalMonitorCompletedBars>
        > | null = null;
        let scanFailed = false;
        let abortScan = false;
        try {
          for (
            let attempt = 1;
            attempt <= SCAN_RETRY_DELAYS_MS.length + 1;
            attempt += 1
          ) {
            try {
              completedBars = await dependencies.loadCompletedBars({
                symbol,
                timeframe,
                evaluatedAt,
                limit: 240,
                allowHistoricalFallback: true,
                includeProvisionalLiveEdge: false,
              });
              if (attempt > 1) retries.recovered += 1;
              break;
            } catch (error) {
              const details = scanFailureDetails(error);
              const retryDelay = SCAN_RETRY_DELAYS_MS[attempt - 1];
              if (!details.retryable || retryDelay === undefined) {
                unrecoverable.push({
                  symbol,
                  timeframe,
                  evaluatedAt: evaluatedAt.toISOString(),
                  ...details,
                  attempts: attempt,
                  resolution: sourceFailureResolution(details, attempt),
                });
                scanFailed = true;
                abortScan = details.retryable;
                break;
              }
              retries.attempted += 1;
              await dependencies.sleep(retryDelay);
            }
          }
          if (scanFailed || !completedBars) {
            if (abortScan) break scan;
            break;
          }

          const state = dependencies.evaluateState({
            profile: input.profile,
            symbol,
            timeframe,
            evaluatedAt,
            completedBars: completedBars.bars,
          });
          const canonical = state.canonicalSignalEvent;
          if (!canonical) continue;
          if (
            canonical.signalAt.getTime() < input.from.getTime() ||
            canonical.signalAt.getTime() > input.to.getTime()
          ) {
            continue;
          }
          const direction = directionFromEventType(canonical.signal.eventType);
          const eventKey =
            __signalMonitorInternalsForTests.buildSignalMonitorEventKey({
              profileId: input.profile.id,
              symbol,
              timeframe,
              direction,
              signalBarAt: canonical.signalBarAt,
            });
          if (candidatesByKey.has(eventKey)) continue;
          const barsSinceSignal = state.barsSinceSignal;
          const eligible =
            typeof barsSinceSignal === "number" &&
            __signalMonitorInternalsForTests.shouldPersistCanonicalSignalMonitorEvent(
              {
                fresh: state.fresh === true,
                barsSinceSignal,
                freshWindowBars: input.profile.freshWindowBars,
                signalAt: canonical.signalAt,
                evaluatedAt,
                sourceBarPartial: canonical.sourceBarPartial,
                sourceBarTrusted: canonical.sourceIntegrity.trusted,
              },
            );
          if (!eligible) {
            const reason = canonical.sourceBarPartial
              ? "partial_source_bar"
              : canonical.sourceIntegrity.trusted === false
                ? "untrusted_source_bar"
                : state.fresh !== true
                  ? "not_fresh"
                  : "outside_fresh_window";
            ineligibleByKey.set(eventKey, reason);
            continue;
          }
          ineligibleByKey.delete(eventKey);
          candidatesByKey.set(eventKey, {
            eventKey,
            symbol,
            timeframe,
            direction,
            signalAt: canonical.signalAt,
            signalBarAt: canonical.signalBarAt,
            signalPrice: canonical.signal.price,
            close: canonical.signal.close,
            payload: {
              signalId: canonical.signal.id,
              barIndex: canonical.signal.barIndex,
              signalBarAt: canonical.signalBarAt.toISOString(),
              latestBarAt: canonical.latestBarAt.toISOString(),
              latestBarAnchorAt: canonical.latestBarAnchorAt.toISOString(),
              sourceIntegrity: canonical.sourceIntegrity,
              filterState: canonical.signal.filterState,
              backfill: "signal-monitor-events",
            },
          });
        } catch (error) {
          const details = scanFailureDetails(error);
          unrecoverable.push({
            symbol,
            timeframe,
            evaluatedAt: evaluatedAt.toISOString(),
            ...details,
            attempts: 1,
            resolution:
              "Fix the reported signal-evaluation error, then rerun this exact scope.",
          });
          break;
        }
      }
      if (input.progress) {
        console.error(
          `[backfill-signal-monitor-events] scanned ${symbol} ${timeframe}; candidates=${candidatesByKey.size}`,
        );
      }
    }
  }

  const ineligibleReasons: Record<string, number> = {};
  for (const reason of ineligibleByKey.values()) {
    ineligibleReasons[reason] = (ineligibleReasons[reason] ?? 0) + 1;
  }
  return {
    candidates: Array.from(candidatesByKey.values()).sort(
      (left, right) =>
        left.signalAt.getTime() - right.signalAt.getTime() ||
        left.symbol.localeCompare(right.symbol) ||
        left.timeframe.localeCompare(right.timeframe),
    ),
    ineligible: {
      total: ineligibleByKey.size,
      reasons: ineligibleReasons,
    },
    retries,
    unrecoverable,
  };
}

function reviewedProfileState(
  profile: Awaited<ReturnType<typeof findExistingSignalMonitorProfile>>,
) {
  return {
    id: profile.id,
    environment: profile.environment,
    enabled: profile.enabled,
    watchlistId: profile.watchlistId,
    timeframe: profile.timeframe,
    pyrusSignalsSettings: profile.pyrusSignalsSettings,
    freshWindowBars: profile.freshWindowBars,
    maxSymbols: profile.maxSymbols,
  };
}

function eventInsertValues(
  profile: Awaited<ReturnType<typeof findExistingSignalMonitorProfile>>,
  candidate: Candidate,
) {
  return {
    profileId: profile.id,
    eventKey: candidate.eventKey,
    environment: profile.environment,
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    direction: candidate.direction,
    signalAt: candidate.signalAt,
    signalPrice: numericStringOrNull(candidate.signalPrice),
    close: numericStringOrNull(candidate.close),
    source: "pyrus-signals",
    payload: candidate.payload,
    emittedAt: candidate.signalAt,
  };
}

export async function commitBackfillCandidates(input: {
  profile: Awaited<ReturnType<typeof findExistingSignalMonitorProfile>>;
  candidates: Candidate[];
  unrecoverable: ScanFailure[];
}) {
  if (input.unrecoverable.length) {
    const first = input.unrecoverable[0];
    throw new Error(
      `Backfill has ${input.unrecoverable.length} unresolved scan gap(s); nothing was written. First failure: ${first?.symbol ?? "unknown"} ${first?.timeframe ?? "unknown"}: ${first?.error ?? "unknown failure"}`,
    );
  }

  const candidates = Array.from(
    new Map(
      input.candidates.map((candidate) => [candidate.eventKey, candidate]),
    ).values(),
  );
  for (const candidate of candidates) {
    if (asRecord(candidate.payload.sourceIntegrity).trusted !== true) {
      throw new Error(
        `Candidate ${candidate.eventKey} is missing trusted source evidence; nothing was written.`,
      );
    }
  }
  // ponytail: the API's event-list cache is process-local and expires within
  // five seconds; add cross-process invalidation only if sub-five-second
  // backfill visibility becomes an operator requirement.
  return db.transaction(async (tx) => {
    const [currentProfile] = await tx
      .select()
      .from(signalMonitorProfilesTable)
      .where(eq(signalMonitorProfilesTable.id, input.profile.id))
      .for("update");
    if (!currentProfile) {
      throw new Error(
        "The reviewed signal-monitor profile disappeared after the scan.",
      );
    }
    if (
      !isDeepStrictEqual(
        reviewedProfileState(currentProfile),
        reviewedProfileState(input.profile),
      )
    ) {
      throw new Error(
        "The signal-monitor profile changed after the scan; nothing was written. Rerun the command against the current profile.",
      );
    }

    const existing = new Set<string>();
    for (const batch of chunk(
      candidates.map((candidate) => candidate.eventKey),
      500,
    )) {
      const rows = await tx
        .select({ eventKey: signalMonitorEventsTable.eventKey })
        .from(signalMonitorEventsTable)
        .where(inArray(signalMonitorEventsTable.eventKey, batch));
      rows.forEach((row) => existing.add(row.eventKey));
    }
    const missing = candidates.filter(
      (candidate) => !existing.has(candidate.eventKey),
    );
    let inserted = 0;
    // ponytail: 250-row batches stay below PostgreSQL's parameter ceiling; move
    // to COPY only if measured backfill write time becomes material.
    for (const batch of chunk(missing, 250)) {
      const rows = await tx
        .insert(signalMonitorEventsTable)
        .values(
          batch.map((candidate) =>
            eventInsertValues(currentProfile, candidate),
          ),
        )
        .onConflictDoNothing({ target: signalMonitorEventsTable.eventKey })
        .returning({ id: signalMonitorEventsTable.id });
      inserted += rows.length;
    }
    return { existing: existing.size, missing: missing.length, inserted };
  });
}

async function main(): Promise<void> {
  const config = parseBackfillArgs(process.argv.slice(2));
  if (!config) {
    console.log(usage());
    return;
  }
  assertBackfillSourceEnabled(process.env);
  const profile = await findExistingSignalMonitorProfile(config.environment);
  const universeResolution = config.symbols
    ? null
    : await resolveSignalMonitorProfileUniverse(profile, {
        ensureWatchlist: false,
      });
  const universeFailure = backfillUniverseFailureReason(universeResolution);
  assertBackfillUniverseWritable(config.write, universeFailure);
  const selectedSymbols = selectBackfillSymbols(
    config.symbols,
    universeResolution?.symbols ?? [],
    config.maxSymbols,
  );

  const scan = await scanCandidates({
    profile,
    symbols: selectedSymbols,
    timeframes: config.timeframes,
    from: config.from,
    to: config.to,
    progress: config.progress,
  });
  const disposition = backfillScanDisposition(
    config.write,
    scan.unrecoverable.length,
  );
  let outcome: {
    existing: number | null;
    missing: number | null;
    inserted: number;
  };
  let missingBeforeWrite: Candidate[] | null;
  if (config.write && disposition.scanComplete) {
    outcome = await commitBackfillCandidates({
      profile,
      candidates: scan.candidates,
      unrecoverable: scan.unrecoverable,
    });
    missingBeforeWrite = null;
  } else if (disposition.queryExisting) {
    const existing = await existingEventKeys(
      scan.candidates.map((candidate) => candidate.eventKey),
    );
    missingBeforeWrite = scan.candidates.filter(
      (candidate) => !existing.has(candidate.eventKey),
    );
    outcome = {
      existing: existing.size,
      missing: missingBeforeWrite.length,
      inserted: 0,
    };
  } else {
    // Do not mask the diagnosed scan or universe failure with a follow-on DB
    // query. No write was attempted, so pre-write row counts remain unknown.
    outcome = { existing: null, missing: null, inserted: 0 };
    missingBeforeWrite = null;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: !config.write,
        environment: config.environment,
        profileId: profile.id,
        from: config.from.toISOString(),
        to: config.to.toISOString(),
        timeframes: config.timeframes,
        symbols: selectedSymbols.length,
        universe: universeResolution?.universe ?? null,
        universeFailure,
        candidates: scan.candidates.length,
        ineligible: scan.ineligible,
        retries: scan.retries,
        existing: outcome.existing,
        missingBeforeWrite: outcome.missing,
        inserted: outcome.inserted,
        atomicWrite: config.write && disposition.scanComplete,
        scanComplete: disposition.scanComplete,
        writeBlocked: disposition.writeBlocked,
        unrecoverable: scan.unrecoverable.length,
        missingBeforeWriteSample:
          missingBeforeWrite?.slice(0, 50).map((candidate) => ({
            eventKey: candidate.eventKey,
            symbol: candidate.symbol,
            timeframe: candidate.timeframe,
            direction: candidate.direction,
            signalAt: candidate.signalAt.toISOString(),
            signalBarAt: candidate.signalBarAt.toISOString(),
            emittedAt: candidate.signalAt.toISOString(),
          })) ?? null,
        unrecoverableSamples: scan.unrecoverable.slice(0, 25),
      },
      null,
      2,
    ),
  );
  if (!disposition.scanComplete) {
    const firstFailure = scan.unrecoverable[0];
    const consequence = config.write
      ? "write blocked; nothing was written"
      : "dry run incomplete";
    throw new Error(
      `Backfill ${consequence}. ${scan.unrecoverable.length} unresolved scan gap(s); first: ${firstFailure?.symbol ?? "unknown"} ${firstFailure?.timeframe ?? "unknown"}: ${firstFailure?.error ?? "unknown failure"}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
