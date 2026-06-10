import { pathToFileURL } from "node:url";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  signalMonitorEventsTable,
} from "@workspace/db";
import {
  __signalMonitorInternalsForTests,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
  getSignalMonitorProfileRow,
  getSignalMonitorTimeframeMs,
  loadSignalMonitorCompletedBars,
  resolveSignalMonitorProfileUniverse,
  type SignalMonitorDirection,
  type SignalMonitorMatrixTimeframe,
} from "../../artifacts/api-server/src/services/signal-monitor";

type RuntimeMode = "paper" | "live";

type Config = {
  environment: RuntimeMode;
  from: Date;
  to: Date;
  timeframes: SignalMonitorMatrixTimeframe[];
  symbols: string[] | null;
  maxSymbols: number | null;
  write: boolean;
  confirmWrite: boolean;
  progress: boolean;
};

type Candidate = {
  eventKey: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  direction: SignalMonitorDirection;
  signalAt: Date;
  signalBarAt: Date;
  latestBarAt: Date;
  latestBarAnchorAt: Date;
  signalPrice: number | null;
  close: number | null;
  payload: Record<string, unknown>;
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
    "  pnpm --filter @workspace/scripts run signal-monitor:events-backfill -- --from=<ISO> --to=<ISO> [--environment=paper] [--timeframes=5m] [--symbols=SPY,QQQ] [--max-symbols=100] [--write --confirm-write]",
    "",
    "Dry-run is the default. Write mode requires both --write and --confirm-write.",
  ].join("\n");
}

function parseDateArg(name: string, fallback?: Date): Date {
  const raw = argValue(name);
  if (!raw && fallback) return fallback;
  if (!raw) throw new Error(`Missing ${name}.\n${usage()}`);
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid ${name}: ${raw}`);
  }
  return date;
}

function parseTimeframes(raw: string | null): SignalMonitorMatrixTimeframe[] {
  const values = (raw || "5m")
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
  const environment = (argValue("--environment") || "paper").trim() as RuntimeMode;
  if (environment !== "paper" && environment !== "live") {
    throw new Error("Use --environment=paper or --environment=live.");
  }
  const to = parseDateArg("--to", new Date());
  const from = parseDateArg("--from");
  if (from.getTime() > to.getTime()) {
    throw new Error("--from must be at or before --to.");
  }
  return {
    environment,
    from,
    to,
    timeframes: parseTimeframes(argValue("--timeframes")),
    symbols: parseSymbols(argValue("--symbols")),
    maxSymbols: parsePositiveInteger(argValue("--max-symbols")),
    write: hasArg("--write"),
    confirmWrite: hasArg("--confirm-write"),
    progress: !hasArg("--quiet"),
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
  return eventType === "sell_signal" ? "sell" : "buy";
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

async function scanCandidates(input: {
  profile: Awaited<ReturnType<typeof getSignalMonitorProfileRow>>;
  symbols: string[];
  timeframes: SignalMonitorMatrixTimeframe[];
  from: Date;
  to: Date;
  progress: boolean;
}): Promise<{ candidates: Candidate[]; unrecoverable: Record<string, string>[] }> {
  const candidatesByKey = new Map<string, Candidate>();
  const unrecoverable: Record<string, string>[] = [];

  for (const symbol of input.symbols) {
    for (const timeframe of input.timeframes) {
      const stepMs = getSignalMonitorTimeframeMs(timeframe);
      const scanToMs = input.to.getTime() + stepMs;
      for (
        let evaluatedMs = input.from.getTime();
        evaluatedMs <= scanToMs;
        evaluatedMs += stepMs
      ) {
        const evaluatedAt = new Date(evaluatedMs);
        try {
          const completedBars = await loadSignalMonitorCompletedBars({
            symbol,
            timeframe,
            evaluatedAt,
            limit: 240,
            allowHistoricalFallback: true,
            includeProvisionalLiveEdge: false,
          });
          const state = evaluateSignalMonitorMatrixStateFromCompletedBars({
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
          candidatesByKey.set(eventKey, {
            eventKey,
            symbol,
            timeframe,
            direction,
            signalAt: canonical.signalAt,
            signalBarAt: canonical.signalBarAt,
            latestBarAt: canonical.latestBarAt,
            latestBarAnchorAt: canonical.latestBarAnchorAt,
            signalPrice: canonical.signal.price,
            close: canonical.signal.close,
            payload: {
              signalId: canonical.signal.id,
              barIndex: canonical.signal.barIndex,
              signalBarAt: canonical.signalBarAt.toISOString(),
              latestBarAt: canonical.latestBarAt.toISOString(),
              latestBarAnchorAt: canonical.latestBarAnchorAt.toISOString(),
              filterState: canonical.signal.filterState,
              backfill: "signal-monitor-events",
            },
          });
        } catch (error) {
          unrecoverable.push({
            symbol,
            timeframe,
            evaluatedAt: evaluatedAt.toISOString(),
            error: error instanceof Error ? error.message : String(error),
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

  return {
    candidates: Array.from(candidatesByKey.values()).sort(
      (left, right) =>
        left.signalAt.getTime() - right.signalAt.getTime() ||
        left.symbol.localeCompare(right.symbol) ||
        left.timeframe.localeCompare(right.timeframe),
    ),
    unrecoverable,
  };
}

async function insertMissingEvents(input: {
  profile: Awaited<ReturnType<typeof getSignalMonitorProfileRow>>;
  candidates: Candidate[];
}): Promise<number> {
  let inserted = 0;
  for (const candidate of input.candidates) {
    const rows = await db
      .insert(signalMonitorEventsTable)
      .values({
        profileId: input.profile.id,
        eventKey: candidate.eventKey,
        environment: input.profile.environment,
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        direction: candidate.direction,
        signalAt: candidate.signalAt,
        signalPrice: numericStringOrNull(candidate.signalPrice),
        close: numericStringOrNull(candidate.close),
        source: "pyrus-signals",
        payload: candidate.payload,
        emittedAt: candidate.signalAt,
      })
      .onConflictDoNothing()
      .returning({ id: signalMonitorEventsTable.id });
    inserted += rows.length;
  }
  return inserted;
}

async function main(): Promise<void> {
  const config = readConfig();
  if (config.write && !config.confirmWrite) {
    throw new Error("Write mode requires --confirm-write.");
  }
  const profile = await getSignalMonitorProfileRow({
    environment: config.environment,
  });
  const universe = await resolveSignalMonitorProfileUniverse(profile);
  const universeSymbols = Array.isArray(universe.symbols) ? universe.symbols : [];
  const selectedSymbols = (config.symbols ?? universeSymbols)
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, config.maxSymbols ?? Number.MAX_SAFE_INTEGER);

  const { candidates, unrecoverable } = await scanCandidates({
    profile,
    symbols: selectedSymbols,
    timeframes: config.timeframes,
    from: config.from,
    to: config.to,
    progress: config.progress,
  });
  const existing = await existingEventKeys(candidates.map((candidate) => candidate.eventKey));
  const missing = candidates.filter((candidate) => !existing.has(candidate.eventKey));
  const inserted = config.write
    ? await insertMissingEvents({ profile, candidates: missing })
    : 0;

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
        candidates: candidates.length,
        existing: existing.size,
        missing: missing.length,
        inserted,
        unrecoverable: unrecoverable.length,
        missingEvents: missing.slice(0, 50).map((candidate) => ({
          eventKey: candidate.eventKey,
          symbol: candidate.symbol,
          timeframe: candidate.timeframe,
          direction: candidate.direction,
          signalAt: candidate.signalAt.toISOString(),
          signalBarAt: candidate.signalBarAt.toISOString(),
          emittedAt: candidate.signalAt.toISOString(),
        })),
        unrecoverableSamples: unrecoverable.slice(0, 25),
      },
      null,
      2,
    ),
  );
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
