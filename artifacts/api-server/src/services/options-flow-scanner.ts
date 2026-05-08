export type OptionsFlowScannerTransport = "tws";

export type OptionsFlowScannerTransportStatus = {
  transport: OptionsFlowScannerTransport | null;
  connected?: boolean | null;
  configured?: boolean | null;
  authenticated?: boolean | null;
  liveMarketDataAvailable?: boolean | null;
  lastError?: string | null;
};

export type OptionsFlowScannerSource = {
  status?: string;
  provider?: string;
  errorMessage?: string | null;
  ibkrStatus?: string;
  ibkrReason?: string | null;
};

export type OptionsFlowScannerFetchResult<TEvent> = {
  events: TEvent[];
  source?: OptionsFlowScannerSource | null;
};

export type OptionsFlowScannerRequest = {
  limit: number;
  unusualThreshold?: number;
  lineBudget?: number;
  allowPartial?: boolean;
};

export type OptionsFlowScannerSnapshot<TEvent> = {
  symbol: string;
  events: TEvent[];
  source: OptionsFlowScannerSource | null;
  scannedAt: Date;
  transport: OptionsFlowScannerTransport | null;
  status: string;
  error: string | null;
  freshness: "fresh" | "stale";
};

export type OptionsFlowScannerRunResult = {
  scannedSymbols: string[];
  skippedSymbols: string[];
  failedSymbols: string[];
  transport: OptionsFlowScannerTransport | null;
  skippedReason: string | null;
};

export type OptionsFlowScannerDiagnostics = {
  queuedCount: number;
  draining: boolean;
  snapshotCount: number;
  maxConcurrency: number;
  lastRunAt: Date | null;
  lastBatch: string[];
  lastScannedSymbols: string[];
  lastSkippedSymbols: string[];
  lastFailedSymbols: string[];
  lastSkippedReason: string | null;
  lastTransport: OptionsFlowScannerTransport | null;
};

export type OptionsFlowScannerOptions<TEvent> = {
  fetchSymbol: (input: {
    symbol: string;
    limit: number;
    unusualThreshold?: number;
    lineBudget?: number;
  }) => Promise<OptionsFlowScannerFetchResult<TEvent>>;
  getTransport: () => Promise<OptionsFlowScannerTransportStatus | null>;
  normalizeSymbol?: (symbol: string) => string;
  now?: () => number;
  maxConcurrency?: number;
  snapshotTtlMs?: number;
  snapshotStaleTtlMs?: number;
  preferredTransport?: OptionsFlowScannerTransport | null;
  allowFallbackTransport?: boolean;
  onError?: (error: unknown, context: { symbol?: string; phase: string }) => void;
  onBatch?: (symbols: readonly string[]) => void;
  onResult?: (input: {
    symbol: string;
    result?: OptionsFlowScannerFetchResult<TEvent>;
    failed: boolean;
    error?: string | null;
  }) => void | Promise<void>;
};

type StoredSnapshot<TEvent> = {
  symbol: string;
  events: TEvent[];
  source: OptionsFlowScannerSource | null;
  scannedAtMs: number;
  expiresAtMs: number;
  staleExpiresAtMs: number;
  transport: OptionsFlowScannerTransport | null;
  status: string;
  error: string | null;
  requestedLimit: number;
  requestedLineBudget: number | null;
};

type QueuedScan = {
  symbol: string;
  request: OptionsFlowScannerRequest;
};

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_SNAPSHOT_TTL_MS = 60_000;
const DEFAULT_SNAPSHOT_STALE_TTL_MS = 5 * 60_000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === "string" && error.trim()
    ? error
    : "Unknown options flow scanner error.";
}

function normalizeThreshold(value: number | undefined): number | undefined {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value : undefined;
}

function keyFor(symbol: string, unusualThreshold: number | undefined): string {
  return `${symbol}:${normalizeThreshold(unusualThreshold) ?? "default"}`;
}

function normalizeLineBudget(value: number | undefined): number | null {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : null;
}

const TRANSIENT_EMPTY_REASON_PATTERNS = [
  "backoff",
  "degraded",
  "error",
  "line_budget",
  "queued",
  "refreshing",
  "saturated",
  "unavailable",
];

function isTransientEmptySource(
  source: OptionsFlowScannerSource | null | undefined,
): boolean {
  if (!source) {
    return false;
  }

  const status = String(source.status || "").toLowerCase();
  const provider = String(source.provider || "").toLowerCase();
  const ibkrStatus = String(source.ibkrStatus || "").toLowerCase();
  const ibkrReason = String(source.ibkrReason || "").toLowerCase();

  if (status === "error" || Boolean(source.errorMessage)) {
    return true;
  }
  if (ibkrStatus === "degraded" || ibkrStatus === "error") {
    return true;
  }
  if (TRANSIENT_EMPTY_REASON_PATTERNS.some((pattern) => ibkrReason.includes(pattern))) {
    return true;
  }

  return status === "empty" && provider !== "ibkr" && ibkrStatus !== "loaded";
}

function snapshotSatisfiesRequest<TEvent>(
  snapshot: StoredSnapshot<TEvent>,
  request: OptionsFlowScannerRequest,
): boolean {
  if (
    !request.allowPartial &&
    snapshot.requestedLimit < request.limit &&
    snapshot.events.length >= snapshot.requestedLimit
  ) {
    return false;
  }

  const requestedLineBudget = normalizeLineBudget(request.lineBudget);
  return !(
    !request.allowPartial &&
    requestedLineBudget !== null &&
    snapshot.requestedLineBudget !== null &&
    snapshot.requestedLineBudget < requestedLineBudget
  );
}

function snapshotToResponse<TEvent>(
  snapshot: StoredSnapshot<TEvent>,
  request: OptionsFlowScannerRequest,
  currentMs: number,
): OptionsFlowScannerSnapshot<TEvent> {
  return {
    symbol: snapshot.symbol,
    events: snapshot.events.slice(0, request.limit),
    source: snapshot.source,
    scannedAt: new Date(snapshot.scannedAtMs),
    transport: snapshot.transport,
    status: snapshot.status,
    error: snapshot.error,
    freshness: snapshot.expiresAtMs > currentMs ? "fresh" : "stale",
  };
}

function uniqueSymbols(
  symbols: readonly string[],
  normalizeSymbol: (symbol: string) => string,
): string[] {
  return [
    ...new Set(
      symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
    ),
  ];
}

function getTransportSkipReason(
  status: OptionsFlowScannerTransportStatus | null,
  preferredTransport: OptionsFlowScannerTransport | null,
  allowFallbackTransport: boolean,
): string | null {
  if (!status) {
    return "transport-unavailable";
  }

  const transport = status?.transport ?? null;

  if (
    preferredTransport &&
    transport !== preferredTransport &&
    !allowFallbackTransport
  ) {
    return `transport-not-${preferredTransport}`;
  }

  if (status?.configured === false) {
    return "bridge-not-configured";
  }

  if (status?.connected === false) {
    return "gateway-not-connected";
  }

  if (status?.authenticated === false) {
    return "gateway-not-authenticated";
  }

  if (status?.liveMarketDataAvailable === false) {
    return "market-data-not-live";
  }

  return null;
}

export function createOptionsFlowScanner<TEvent>(
  options: OptionsFlowScannerOptions<TEvent>,
) {
  const normalizeSymbol =
    options.normalizeSymbol ?? ((symbol: string) => symbol.trim().toUpperCase());
  const now = options.now ?? (() => Date.now());
  let maxConcurrency = Math.max(
    1,
    Math.floor(options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY),
  );
  const snapshotTtlMs = Math.max(
    1_000,
    options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS,
  );
  const snapshotStaleTtlMs = Math.max(
    snapshotTtlMs,
    options.snapshotStaleTtlMs ?? DEFAULT_SNAPSHOT_STALE_TTL_MS,
  );
  const preferredTransport = options.preferredTransport ?? null;
  const allowFallbackTransport = Boolean(options.allowFallbackTransport);

  const snapshots = new Map<string, StoredSnapshot<TEvent>>();
  const queued = new Map<string, QueuedScan>();
  let drainPromise: Promise<OptionsFlowScannerRunResult> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopRotation: (() => void) | null = null;
  let rotationOffset = 0;
  let lastRunAt: Date | null = null;
  let lastBatch: string[] = [];
  let lastRunResult: OptionsFlowScannerRunResult = {
    scannedSymbols: [],
    skippedSymbols: [],
    failedSymbols: [],
    transport: null,
    skippedReason: null,
  };

  function recordRunResult(
    symbols: readonly string[],
    result: OptionsFlowScannerRunResult,
  ): OptionsFlowScannerRunResult {
    lastRunAt = new Date(now());
    lastBatch = [...symbols];
    lastRunResult = {
      scannedSymbols: [...result.scannedSymbols],
      skippedSymbols: [...result.skippedSymbols],
      failedSymbols: [...result.failedSymbols],
      transport: result.transport,
      skippedReason: result.skippedReason,
    };
    return result;
  }

  async function getTransport(): Promise<OptionsFlowScannerTransportStatus | null> {
    try {
      return await options.getTransport();
    } catch (error) {
      options.onError?.(error, { phase: "transport" });
      return null;
    }
  }

  async function fetchOne(
    symbol: string,
    request: OptionsFlowScannerRequest,
    transport: OptionsFlowScannerTransport | null,
  ): Promise<{ symbol: string; failed: boolean }> {
    const scanStartedAt = now();
    try {
      const result = await options.fetchSymbol({
        symbol,
        limit: request.limit,
        unusualThreshold: normalizeThreshold(request.unusualThreshold),
        lineBudget: normalizeLineBudget(request.lineBudget) ?? undefined,
      });
      const settledAt = now();
      storeSnapshot(symbol, request, result, transport, scanStartedAt, settledAt);
      await options.onResult?.({ symbol, result, failed: false });
      return { symbol, failed: false };
    } catch (error) {
      const settledAt = now();
      const message = getErrorMessage(error);
      const source = {
        status: "error",
        provider: "none",
        errorMessage: message,
      };
      if (
        shouldPreserveExistingSnapshot(
          symbol,
          request,
          [],
          source,
          settledAt,
        )
      ) {
        options.onError?.(error, { symbol, phase: "fetch" });
        await options.onResult?.({ symbol, failed: true, error: message });
        return { symbol, failed: true };
      }
      snapshots.delete(keyFor(symbol, request.unusualThreshold));
      options.onError?.(error, { symbol, phase: "fetch" });
      await options.onResult?.({ symbol, failed: true, error: message });
      return { symbol, failed: true };
    }
  }

  function storeSnapshot(
    symbolInput: string,
    request: OptionsFlowScannerRequest,
    result: OptionsFlowScannerFetchResult<TEvent>,
    transport: OptionsFlowScannerTransport | null = null,
    scannedAtMs = now(),
    settledAtMs = now(),
  ): void {
    const symbol = normalizeSymbol(symbolInput);
    const source = result.source ?? null;
    if (
      shouldPreserveExistingSnapshot(
        symbol,
        request,
        result.events,
        source,
        settledAtMs,
      )
    ) {
      return;
    }
    if (result.events.length === 0 && isTransientEmptySource(source)) {
      snapshots.delete(keyFor(symbol, request.unusualThreshold));
      return;
    }
    snapshots.set(keyFor(symbol, request.unusualThreshold), {
      symbol,
      events: result.events,
      source,
      scannedAtMs,
      expiresAtMs: settledAtMs + snapshotTtlMs,
      staleExpiresAtMs: settledAtMs + snapshotStaleTtlMs,
      transport,
      status: source?.status ?? (result.events.length ? "live" : "empty"),
      error: source?.errorMessage ?? null,
      requestedLimit: request.limit,
      requestedLineBudget: normalizeLineBudget(request.lineBudget),
    });
  }

  function shouldPreserveExistingSnapshot(
    symbolInput: string,
    request: OptionsFlowScannerRequest,
    events: readonly TEvent[],
    source: OptionsFlowScannerSource | null,
    currentMs = now(),
  ): boolean {
    if (events.length > 0 || !isTransientEmptySource(source)) {
      return false;
    }

    const symbol = normalizeSymbol(symbolInput);
    const existing = snapshots.get(keyFor(symbol, request.unusualThreshold));
    return Boolean(existing?.events.length && existing.staleExpiresAtMs > currentMs);
  }

  async function runOnce(
    symbols: readonly string[],
    request: OptionsFlowScannerRequest,
  ): Promise<OptionsFlowScannerRunResult> {
    const normalizedSymbols = uniqueSymbols(symbols, normalizeSymbol);
    const transportStatus = await getTransport();
    const transport = transportStatus?.transport ?? null;
    const skipReason = getTransportSkipReason(
      transportStatus,
      preferredTransport,
      allowFallbackTransport,
    );

    if (skipReason) {
      return recordRunResult(normalizedSymbols, {
        scannedSymbols: [],
        skippedSymbols: normalizedSymbols,
        failedSymbols: [],
        transport,
        skippedReason: skipReason,
      });
    }

    if (!normalizedSymbols.length) {
      return recordRunResult(normalizedSymbols, {
        scannedSymbols: [],
        skippedSymbols: [],
        failedSymbols: [],
        transport,
        skippedReason: null,
      });
    }

    const scannedSymbols: string[] = [];
    const failedSymbols: string[] = [];
    let cursor = 0;
    const workerCount = Math.min(maxConcurrency, normalizedSymbols.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < normalizedSymbols.length) {
        const index = cursor;
        cursor += 1;
        const symbol = normalizedSymbols[index];
        const result = await fetchOne(symbol, request, transport);
        scannedSymbols.push(result.symbol);
        if (result.failed) {
          failedSymbols.push(result.symbol);
        }
      }
    });

    await Promise.all(workers);

    return recordRunResult(normalizedSymbols, {
      scannedSymbols,
      skippedSymbols: [],
      failedSymbols,
      transport,
      skippedReason: null,
    });
  }

  async function drainQueue(): Promise<OptionsFlowScannerRunResult> {
    const batch = Array.from(queued.values());
    queued.clear();
    const grouped = new Map<string, QueuedScan[]>();
    for (const item of batch) {
      const groupKey = `${item.request.limit}:${normalizeThreshold(item.request.unusualThreshold) ?? "default"}:${normalizeLineBudget(item.request.lineBudget) ?? "default"}`;
      const group = grouped.get(groupKey) ?? [];
      group.push(item);
      grouped.set(groupKey, group);
    }

    const result: OptionsFlowScannerRunResult = {
      scannedSymbols: [],
      skippedSymbols: [],
      failedSymbols: [],
      transport: null,
      skippedReason: null,
    };

    for (const group of grouped.values()) {
      const groupResult = await runOnce(
        group.map((item) => item.symbol),
        group[0]?.request ?? { limit: 50 },
      );
      result.scannedSymbols.push(...groupResult.scannedSymbols);
      result.skippedSymbols.push(...groupResult.skippedSymbols);
      result.failedSymbols.push(...groupResult.failedSymbols);
      result.transport = groupResult.transport;
      result.skippedReason = groupResult.skippedReason;
    }
    drainPromise = null;

    if (queued.size > 0) {
      drainPromise = drainQueue();
    }

    return result;
  }

  function requestScan(
    symbols: readonly string[],
    request: OptionsFlowScannerRequest,
  ): Promise<OptionsFlowScannerRunResult> {
    for (const symbol of uniqueSymbols(symbols, normalizeSymbol)) {
      queued.set(keyFor(symbol, request.unusualThreshold), { symbol, request });
    }

    if (!drainPromise) {
      drainPromise = drainQueue();
    }

    return drainPromise;
  }

  function getSnapshot(
    symbolInput: string,
    request: OptionsFlowScannerRequest,
  ): OptionsFlowScannerSnapshot<TEvent> | null {
    const symbol = normalizeSymbol(symbolInput);
    const key = keyFor(symbol, request.unusualThreshold);
    const snapshot = snapshots.get(key);
    if (!snapshot) {
      return null;
    }

    const current = now();
    if (snapshot.staleExpiresAtMs <= current) {
      snapshots.delete(key);
      return null;
    }

    if (!snapshotSatisfiesRequest(snapshot, request)) {
      return null;
    }

    return snapshotToResponse(snapshot, request, current);
  }

  function listSnapshots(
    request: OptionsFlowScannerRequest,
  ): OptionsFlowScannerSnapshot<TEvent>[] {
    const current = now();
    const results: OptionsFlowScannerSnapshot<TEvent>[] = [];

    for (const [key, snapshot] of snapshots.entries()) {
      if (snapshot.staleExpiresAtMs <= current) {
        snapshots.delete(key);
        continue;
      }
      if (key !== keyFor(snapshot.symbol, request.unusualThreshold)) {
        continue;
      }
      if (!snapshotSatisfiesRequest(snapshot, request)) {
        continue;
      }
      results.push(snapshotToResponse(snapshot, request, current));
    }

    return results.sort((left, right) => {
      const freshness =
        Number(right.freshness === "fresh") - Number(left.freshness === "fresh");
      if (freshness !== 0) {
        return freshness;
      }
      return right.scannedAt.getTime() - left.scannedAt.getTime();
    });
  }

  function startRotation(input: {
    symbols: readonly string[] | (() => readonly string[]);
    request: OptionsFlowScannerRequest;
    intervalMs: number | (() => number);
    batchSize: number | (() => number);
  }): void {
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

    const nextBatch = (): string[] => {
      const symbols = uniqueSymbols(getSymbols(), normalizeSymbol);
      if (!symbols.length) {
        rotationOffset = 0;
        return [];
      }

      const configuredBatchSize =
        typeof input.batchSize === "function" ? input.batchSize() : input.batchSize;
      const size = Math.max(1, Math.min(configuredBatchSize, symbols.length));
      const start = rotationOffset % symbols.length;
      const batch: string[] = [];
      for (let index = 0; index < size; index += 1) {
        batch.push(symbols[(start + index) % symbols.length]);
      }
      rotationOffset = (start + size) % symbols.length;
      return batch;
    };

    const run = async () => {
      timer = null;
      const batch = nextBatch();
      if (batch.length) {
        try {
          options.onBatch?.(batch);
          await requestScan(batch, input.request);
        } catch (error) {
          options.onError?.(error, { phase: "rotation" });
        }
      }
      const nextInterval =
        typeof input.intervalMs === "function"
          ? input.intervalMs()
          : input.intervalMs;
      schedule(nextInterval);
    };

    void run();
  }

  function stop(): void {
    stopRotation?.();
  }

  function reset(): void {
    stop();
    snapshots.clear();
    queued.clear();
    drainPromise = null;
    rotationOffset = 0;
    lastRunAt = null;
    lastBatch = [];
    lastRunResult = {
      scannedSymbols: [],
      skippedSymbols: [],
      failedSymbols: [],
      transport: null,
      skippedReason: null,
    };
  }

  function setMaxConcurrency(value: number): void {
    if (Number.isFinite(value) && value > 0) {
      maxConcurrency = Math.max(1, Math.floor(value));
    }
  }

  function getMaxConcurrency(): number {
    return maxConcurrency;
  }

  function getDiagnostics(): OptionsFlowScannerDiagnostics {
    return {
      queuedCount: queued.size,
      draining: Boolean(drainPromise),
      snapshotCount: snapshots.size,
      maxConcurrency,
      lastRunAt,
      lastBatch: [...lastBatch],
      lastScannedSymbols: [...lastRunResult.scannedSymbols],
      lastSkippedSymbols: [...lastRunResult.skippedSymbols],
      lastFailedSymbols: [...lastRunResult.failedSymbols],
      lastSkippedReason: lastRunResult.skippedReason,
      lastTransport: lastRunResult.transport,
    };
  }

  return {
    getDiagnostics,
    getMaxConcurrency,
    getSnapshot,
    listSnapshots,
    requestScan,
    runOnce,
    reset,
    setMaxConcurrency,
    storeSnapshot,
    startRotation,
    stop,
  };
}
