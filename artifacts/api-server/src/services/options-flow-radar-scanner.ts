export type OptionsFlowRadarQuote = {
  symbol: string;
  price?: number | null;
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  optionCallVolume?: number | null;
  optionPutVolume?: number | null;
  optionCallOpenInterest?: number | null;
  optionPutOpenInterest?: number | null;
  impliedVolatility?: number | null;
  updatedAt?: Date | string | null;
  delayed?: boolean | null;
  freshness?: string | null;
};

export type OptionsFlowRadarObservation = {
  symbol: string;
  scannedAt: Date;
  score: number;
  optionVolume: number | null;
  optionOpenInterest: number | null;
  volumeOiRatio: number | null;
  activityNotionalProxy: number | null;
  impliedVolatility: number | null;
  hasOptionActivityTicks: boolean;
  promoted: boolean;
  sourceStatus: string;
};

export type OptionsFlowRadarFetchResult = {
  quotes: OptionsFlowRadarQuote[];
  source?: {
    status?: string;
    provider?: string;
    errorMessage?: string | null;
  } | null;
};

export type OptionsFlowRadarRunResult = {
  scannedSymbols: string[];
  promotedSymbols: string[];
  failed: boolean;
  error: string | null;
};

export type OptionsFlowRadarCoverage = {
  enabled: boolean;
  selectedSymbols: number;
  currentBatch: string[];
  scannedSymbols: number;
  promotedSymbols: string[];
  lastScanAt: Date | null;
  lastFullCycleMs: number | null;
  estimatedCycleMs: number | null;
  batchSize: number;
  intervalMs: number;
  promoteCount: number;
  degradedReason: string | null;
};

export type OptionsFlowRadarScannerOptions = {
  fetchBatch: (symbols: readonly string[]) => Promise<OptionsFlowRadarFetchResult>;
  normalizeSymbol?: (symbol: string) => string;
  now?: () => number;
  onBatch?: (symbols: readonly string[]) => void;
  onObservations?: (
    observations: readonly OptionsFlowRadarObservation[],
  ) => void | Promise<void>;
  onPromotions?: (
    symbols: readonly string[],
    observations: readonly OptionsFlowRadarObservation[],
  ) => void | Promise<void>;
  onError?: (error: unknown, context: { phase: string }) => void;
};

type RotationInput = {
  symbols: readonly string[] | (() => readonly string[]);
  intervalMs: number | (() => number);
  batchSize: number | (() => number);
  promoteCount: number | (() => number);
  fallbackPromoteCount?: number | (() => number);
};

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_PROMOTE_COUNT = 3;

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : typeof error === "string" && error.trim()
      ? error
      : "Unknown options flow radar scanner error.";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nonNegative(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric === null ? null : Math.max(0, numeric);
}

function positive(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function optionalSum(left: number | null, right: number | null): number | null {
  if (left === null && right === null) {
    return null;
  }
  return (left ?? 0) + (right ?? 0);
}

function uniqueSymbols(
  symbols: readonly string[],
  normalizeSymbol: (symbol: string) => string,
): string[] {
  return [...new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean))];
}

function readRuntimeNumber(
  value: number | (() => number) | undefined,
  fallback: number,
): number {
  const raw = typeof value === "function" ? value() : value;
  return Number.isFinite(raw) && (raw as number) > 0
    ? Math.floor(raw as number)
    : fallback;
}

export function scoreOptionsFlowRadarQuote(
  quote: OptionsFlowRadarQuote,
  scannedAt: Date,
): OptionsFlowRadarObservation {
  const callVolume = nonNegative(quote.optionCallVolume);
  const putVolume = nonNegative(quote.optionPutVolume);
  const callOpenInterest = nonNegative(quote.optionCallOpenInterest);
  const putOpenInterest = nonNegative(quote.optionPutOpenInterest);
  const optionVolume = optionalSum(callVolume, putVolume);
  const optionOpenInterest = optionalSum(callOpenInterest, putOpenInterest);
  const hasOptionActivityTicks =
    optionVolume !== null || optionOpenInterest !== null;
  const safeOptionVolume = optionVolume ?? 0;
  const safeOpenInterest = optionOpenInterest ?? 0;
  const volumeOiRatio =
    safeOptionVolume > 0 && safeOpenInterest > 0
      ? safeOptionVolume / safeOpenInterest
      : safeOptionVolume > 0
        ? 1
        : null;
  const price = positive(quote.price) ?? positive(quote.bid) ?? positive(quote.ask);
  const activityNotionalProxy =
    hasOptionActivityTicks && price !== null
      ? price * safeOptionVolume * 100
      : null;
  const impliedVolatility = nonNegative(quote.impliedVolatility);
  const volumeScore =
    hasOptionActivityTicks && safeOptionVolume > 0
      ? Math.log10(safeOptionVolume + 1) * 8
      : 0;
  const ratioScore =
    volumeOiRatio !== null ? Math.min(10, volumeOiRatio) * 12 : 0;
  const notionalScore =
    activityNotionalProxy !== null && activityNotionalProxy > 0
      ? Math.log10(activityNotionalProxy + 1)
      : 0;
  const ivScore = impliedVolatility !== null ? Math.min(5, impliedVolatility) : 0;

  return {
    symbol: quote.symbol,
    scannedAt,
    score: Number((volumeScore + ratioScore + notionalScore + ivScore).toFixed(4)),
    optionVolume,
    optionOpenInterest,
    volumeOiRatio:
      volumeOiRatio === null ? null : Number(volumeOiRatio.toFixed(4)),
    activityNotionalProxy:
      activityNotionalProxy === null
        ? null
        : Number(activityNotionalProxy.toFixed(2)),
    impliedVolatility,
    hasOptionActivityTicks,
    promoted: false,
    sourceStatus: quote.freshness ?? (quote.delayed ? "delayed" : "live"),
  };
}

export function createOptionsFlowRadarScanner(
  options: OptionsFlowRadarScannerOptions,
) {
  const normalizeSymbol =
    options.normalizeSymbol ?? ((symbol: string) => symbol.trim().toUpperCase());
  const now = options.now ?? (() => Date.now());

  let timer: NodeJS.Timeout | null = null;
  let stopRotation: (() => void) | null = null;
  let rotationOffset = 0;
  let currentSymbolsKey = "";
  let scannedSymbols = new Set<string>();
  let currentBatch: string[] = [];
  let promotedSymbols: string[] = [];
  let lastScanAt: Date | null = null;
  let cycleStartedAtMs: number | null = null;
  let lastFullCycleMs: number | null = null;
  let selectedSymbolCount = 0;
  let lastBatchSize = DEFAULT_BATCH_SIZE;
  let lastIntervalMs = DEFAULT_INTERVAL_MS;
  let lastPromoteCount = DEFAULT_PROMOTE_COUNT;
  let degradedReason: string | null = null;

  function resetCycleIfSymbolsChanged(symbols: readonly string[]): void {
    const key = uniqueSymbols(symbols, normalizeSymbol).join(",");
    if (key === currentSymbolsKey) {
      return;
    }
    currentSymbolsKey = key;
    rotationOffset = 0;
    scannedSymbols = new Set();
    currentBatch = [];
    promotedSymbols = [];
    lastScanAt = null;
    cycleStartedAtMs = null;
    lastFullCycleMs = null;
    degradedReason = null;
  }

  function buildNextBatch(
    symbolsInput: readonly string[],
    batchSizeInput: number,
  ): string[] {
    const symbols = uniqueSymbols(symbolsInput, normalizeSymbol);
    resetCycleIfSymbolsChanged(symbols);
    selectedSymbolCount = symbols.length;
    if (!symbols.length) {
      rotationOffset = 0;
      return [];
    }

    const size = Math.max(1, Math.min(batchSizeInput, symbols.length));
    const start = rotationOffset % symbols.length;
    if (start === 0 && scannedSymbols.size >= symbols.length) {
      if (cycleStartedAtMs !== null) {
        lastFullCycleMs = Math.max(0, now() - cycleStartedAtMs);
      }
      scannedSymbols = new Set();
      cycleStartedAtMs = now();
    } else if (cycleStartedAtMs === null) {
      cycleStartedAtMs = now();
    }

    const batch: string[] = [];
    for (let index = 0; index < size; index += 1) {
      batch.push(symbols[(start + index) % symbols.length]);
    }
    rotationOffset = (start + size) % symbols.length;
    return batch;
  }

  async function runOnce(
    symbolsInput: readonly string[],
    input: {
      batchSize?: number;
      promoteCount?: number;
      fallbackPromoteCount?: number;
    } = {},
  ): Promise<OptionsFlowRadarRunResult> {
    lastBatchSize = Math.max(
      1,
      Math.floor(input.batchSize ?? DEFAULT_BATCH_SIZE),
    );
    lastPromoteCount = Math.max(
      0,
      Math.floor(input.promoteCount ?? DEFAULT_PROMOTE_COUNT),
    );
    const batch = buildNextBatch(
      symbolsInput,
      lastBatchSize,
    );
    currentBatch = batch;
    promotedSymbols = [];

    if (!batch.length) {
      return {
        scannedSymbols: [],
        promotedSymbols: [],
        failed: false,
        error: null,
      };
    }

    try {
      options.onBatch?.(batch);
      const result = await options.fetchBatch(batch);
      const scannedAt = new Date(now());
      const quotesBySymbol = new Map(
        result.quotes.map((quote) => [normalizeSymbol(quote.symbol), quote]),
      );
      const observations = batch.map((symbol) => {
        const quote = quotesBySymbol.get(symbol) ?? { symbol };
        return scoreOptionsFlowRadarQuote({ ...quote, symbol }, scannedAt);
      });
      observations.forEach((observation) => {
        scannedSymbols.add(observation.symbol);
      });
      lastScanAt = scannedAt;

      const promoteCount = Math.max(
        0,
        Math.floor(input.promoteCount ?? DEFAULT_PROMOTE_COUNT),
      );
      const fallbackPromoteCount = Math.max(
        0,
        Math.floor(input.fallbackPromoteCount ?? 0),
      );
      const ranked = [...observations].sort((left, right) => {
        return right.score - left.score || left.symbol.localeCompare(right.symbol);
      });
      const promoted = ranked
        .filter(
          (observation) =>
            observation.hasOptionActivityTicks &&
            (observation.optionVolume ?? 0) > 0 &&
            observation.score > 0,
        )
        .slice(0, promoteCount);
      if (!promoted.length && fallbackPromoteCount > 0) {
        promoted.push(...ranked.slice(0, fallbackPromoteCount));
      }
      const promotedSet = new Set(promoted.map((observation) => observation.symbol));
      const settledObservations = observations.map((observation) => ({
        ...observation,
        promoted: promotedSet.has(observation.symbol),
      }));
      promotedSymbols = promoted.map((observation) => observation.symbol);
      degradedReason = result.source?.errorMessage ?? null;

      await options.onObservations?.(settledObservations);
      if (promotedSymbols.length) {
        await options.onPromotions?.(promotedSymbols, settledObservations);
      }

      return {
        scannedSymbols: batch,
        promotedSymbols,
        failed: false,
        error: null,
      };
    } catch (error) {
      const message = getErrorMessage(error);
      degradedReason = message;
      options.onError?.(error, { phase: "radar-fetch" });
      return {
        scannedSymbols: [],
        promotedSymbols: [],
        failed: true,
        error: message,
      };
    }
  }

  function startRotation(input: RotationInput): void {
    if (timer || stopRotation) {
      return;
    }

    let stopped = false;
    stopRotation = () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      stopRotation = null;
    };

    const configuredSymbols = input.symbols;
    const getSymbols: () => readonly string[] =
      typeof configuredSymbols === "function"
        ? configuredSymbols
        : () => configuredSymbols;

    const schedule = (delayMs: number) => {
      if (stopped) {
        return;
      }
      timer = setTimeout(run, Math.max(1_000, delayMs));
      timer.unref?.();
    };

    const run = async () => {
      timer = null;
      const intervalMs = readRuntimeNumber(input.intervalMs, DEFAULT_INTERVAL_MS);
      const batchSize = readRuntimeNumber(input.batchSize, DEFAULT_BATCH_SIZE);
      const promoteCount = readRuntimeNumber(input.promoteCount, DEFAULT_PROMOTE_COUNT);
      const fallbackPromoteCount = readRuntimeNumber(input.fallbackPromoteCount, 0);
      lastIntervalMs = intervalMs;
      lastBatchSize = batchSize;
      lastPromoteCount = promoteCount;
      await runOnce(getSymbols(), {
        batchSize,
        promoteCount,
        fallbackPromoteCount,
      });
      schedule(intervalMs);
    };

    void run();
  }

  function stop(): void {
    stopRotation?.();
  }

  function reset(): void {
    stop();
    rotationOffset = 0;
    currentSymbolsKey = "";
    scannedSymbols = new Set();
    currentBatch = [];
    promotedSymbols = [];
    lastScanAt = null;
    cycleStartedAtMs = null;
    lastFullCycleMs = null;
    selectedSymbolCount = 0;
    degradedReason = null;
  }

  function getCoverage(): OptionsFlowRadarCoverage {
    return {
      enabled: Boolean(stopRotation),
      selectedSymbols: selectedSymbolCount,
      currentBatch,
      scannedSymbols: scannedSymbols.size,
      promotedSymbols,
      lastScanAt,
      lastFullCycleMs,
      estimatedCycleMs: selectedSymbolCount
        ? Math.ceil(selectedSymbolCount / Math.max(1, lastBatchSize)) *
          lastIntervalMs
        : null,
      batchSize: lastBatchSize,
      intervalMs: lastIntervalMs,
      promoteCount: lastPromoteCount,
      degradedReason,
    };
  }

  return {
    getCoverage,
    reset,
    runOnce,
    startRotation,
    stop,
  };
}
