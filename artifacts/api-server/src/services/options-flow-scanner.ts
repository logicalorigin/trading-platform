export type OptionsFlowScannerTransport = "tws" | "massive";
export type OptionsFlowScannerMarketDataMode =
  | "live"
  | "frozen"
  | "delayed"
  | "delayed_frozen"
  | "unknown";
export type OptionsFlowScannerScanPhase = "seed" | "expanded" | "manual";

export type OptionsFlowScannerTransportStatus = {
  transport: OptionsFlowScannerTransport | null;
  connected?: boolean | null;
  configured?: boolean | null;
  authenticated?: boolean | null;
  liveMarketDataAvailable?: boolean | null;
  marketDataMode?: OptionsFlowScannerMarketDataMode | string | null;
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
  phase?: OptionsFlowScannerScanPhase;
  expirationScanCount?: number;
  strikeCoverage?: "fast" | "standard" | "full";
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
  marketDataMode: OptionsFlowScannerMarketDataMode | null;
  scanPhase: OptionsFlowScannerScanPhase | null;
};

export type OptionsFlowScannerDiagnostics = {
  queuedCount: number;
  queuedSymbols: string[];
  drainingCount: number;
  drainingSymbols: string[];
  draining: boolean;
  activeCount: number;
  activeSymbols: string[];
  drainStartedAt: Date | null;
  snapshotCount: number;
  maxConcurrency: number;
  lastRunAt: Date | null;
  lastBatch: string[];
  lastScannedSymbols: string[];
  lastSkippedSymbols: string[];
  lastFailedSymbols: string[];
  lastSkippedReason: string | null;
  lastTransport: OptionsFlowScannerTransport | null;
  lastMarketDataMode: OptionsFlowScannerMarketDataMode | null;
  lastScanPhase: OptionsFlowScannerScanPhase | null;
  scanTimeoutMs: number | null;
};

export type OptionsFlowScannerOptions<TEvent> = {
  fetchSymbol: (input: {
    symbol: string;
    limit: number;
    unusualThreshold?: number;
    lineBudget?: number;
    phase?: OptionsFlowScannerScanPhase;
    expirationScanCount?: number;
    strikeCoverage?: "fast" | "standard" | "full";
    signal?: AbortSignal;
  }) => Promise<OptionsFlowScannerFetchResult<TEvent>>;
  getTransport: () => Promise<OptionsFlowScannerTransportStatus | null>;
  normalizeSymbol?: (symbol: string) => string;
  now?: () => number;
  maxConcurrency?: number;
  scanTimeoutMs?: number | (() => number | null | undefined);
  snapshotTtlMs?: number;
  snapshotStaleTtlMs?: number;
  preferredTransport?: OptionsFlowScannerTransport | null;
  allowFallbackTransport?: boolean;
  onError?: (error: unknown, context: { symbol?: string; phase: string }) => void;
  onBatch?: (symbols: readonly string[]) => void;
  onResult?: (input: {
    symbol: string;
    request: OptionsFlowScannerRequest;
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
  requestedPhase: OptionsFlowScannerScanPhase | null;
};

type QueuedScan = {
  symbol: string;
  request: OptionsFlowScannerRequest;
};

// Keep the default fan-out conservative. A 2->8 bump (commit 337cb24) overwhelmed
// the shared DB while option-chain persistence was still append-heavy and also
// stressed the IB tunnel; raise only with headroom verified on the target DB/bridge.
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

function normalizeScanPhase(
  value: OptionsFlowScannerScanPhase | undefined,
): OptionsFlowScannerScanPhase | null {
  return value === "seed" || value === "expanded" || value === "manual"
    ? value
    : null;
}

function normalizePositiveInteger(value: number | undefined): number | null {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.floor(value as number)
    : null;
}

function normalizeStrikeCoverage(
  value: OptionsFlowScannerRequest["strikeCoverage"],
): OptionsFlowScannerRequest["strikeCoverage"] | null {
  return value === "fast" || value === "standard" || value === "full"
    ? value
    : null;
}

function normalizeMarketDataMode(
  value: OptionsFlowScannerTransportStatus["marketDataMode"],
): OptionsFlowScannerMarketDataMode | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "live" ||
    normalized === "frozen" ||
    normalized === "delayed" ||
    normalized === "delayed_frozen" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return null;
}

function normalizeTimeoutMs(value: number | null | undefined): number | null {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.max(1, Math.floor(value as number))
    : null;
}

function mergeLineBudget(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  const leftBudget = normalizeLineBudget(left);
  const rightBudget = normalizeLineBudget(right);
  if (leftBudget === null || rightBudget === null) {
    return undefined;
  }
  return Math.max(leftBudget, rightBudget);
}

function mergeQueuedRequest(
  current: OptionsFlowScannerRequest,
  next: OptionsFlowScannerRequest,
): OptionsFlowScannerRequest {
  return {
    ...current,
    ...next,
    limit: Math.max(current.limit, next.limit),
    unusualThreshold: current.unusualThreshold ?? next.unusualThreshold,
    lineBudget: mergeLineBudget(current.lineBudget, next.lineBudget),
    allowPartial: Boolean(current.allowPartial && next.allowPartial),
    phase: next.phase ?? current.phase,
    expirationScanCount:
      normalizePositiveInteger(next.expirationScanCount) ??
      normalizePositiveInteger(current.expirationScanCount) ??
      undefined,
    strikeCoverage:
      normalizeStrikeCoverage(next.strikeCoverage) ??
      normalizeStrikeCoverage(current.strikeCoverage) ??
      undefined,
  };
}

const TRANSIENT_EMPTY_REASON_PATTERNS = [
  "backoff",
  "degraded",
  "error",
  "line_budget",
  "market-session-quiet",
  "market_session_quiet",
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
  if (
    !request.allowPartial &&
    requestedLineBudget !== null &&
    snapshot.requestedLineBudget !== null &&
    snapshot.requestedLineBudget < requestedLineBudget
  ) {
    return false;
  }

  const requestedPhase = normalizeScanPhase(request.phase);
  return !(
    !request.allowPartial &&
    requestedPhase === "expanded" &&
    snapshot.requestedPhase !== "expanded"
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
    return transport === "massive"
      ? "massive-not-configured"
      : "bridge-not-configured";
  }

  if (status?.connected === false) {
    return transport === "massive"
      ? "massive-not-connected"
      : "gateway-not-connected";
  }

  if (status?.authenticated === false) {
    return transport === "massive"
      ? "massive-not-authenticated"
      : "gateway-not-authenticated";
  }

  const marketDataMode = normalizeMarketDataMode(status?.marketDataMode);
  if (marketDataMode === "frozen") {
    return "market-data-frozen";
  }
  if (marketDataMode === "delayed_frozen") {
    return "market-data-delayed-frozen";
  }

  if (
    status?.liveMarketDataAvailable === false &&
    marketDataMode !== "delayed"
  ) {
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
  const drainingSymbols = new Set<string>();
  const activeSymbols = new Set<string>();
  let drainPromise: Promise<OptionsFlowScannerRunResult> | null = null;
  let drainStartedAt: Date | null = null;
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
    marketDataMode: null,
    scanPhase: null,
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
      marketDataMode: result.marketDataMode,
      scanPhase: result.scanPhase,
    };
    return result;
  }

  function getScanTimeoutMs(): number | null {
    const configured = options.scanTimeoutMs;
    return normalizeTimeoutMs(
      typeof configured === "function" ? configured() : configured,
    );
  }

  function withScanTimeout<T>(
    task: (signal: AbortSignal | undefined) => Promise<T>,
    symbol: string,
  ): Promise<T> {
    const timeoutMs = getScanTimeoutMs();
    if (timeoutMs === null) {
      return task(undefined);
    }

    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error(
          `Options flow scanner timed out scanning ${symbol} after ${timeoutMs}ms.`,
        );
        controller.abort(error);
        reject(error);
      }, timeoutMs);
      timeout.unref?.();

      task(controller.signal).then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
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
    activeSymbols.add(symbol);
    try {
      const result = await withScanTimeout(
        (signal) =>
          options.fetchSymbol({
            symbol,
            limit: request.limit,
            unusualThreshold: normalizeThreshold(request.unusualThreshold),
            lineBudget: normalizeLineBudget(request.lineBudget) ?? undefined,
            phase: normalizeScanPhase(request.phase) ?? undefined,
            expirationScanCount:
              normalizePositiveInteger(request.expirationScanCount) ?? undefined,
            strikeCoverage:
              normalizeStrikeCoverage(request.strikeCoverage) ?? undefined,
            signal,
          }),
        symbol,
      );
      const settledAt = now();
      storeSnapshot(symbol, request, result, transport, scanStartedAt, settledAt);
      await options.onResult?.({ symbol, request, result, failed: false });
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
        await options.onResult?.({ symbol, request, failed: true, error: message });
        return { symbol, failed: true };
      }
      snapshots.delete(keyFor(symbol, request.unusualThreshold));
      options.onError?.(error, { symbol, phase: "fetch" });
      await options.onResult?.({ symbol, request, failed: true, error: message });
      return { symbol, failed: true };
    } finally {
      activeSymbols.delete(symbol);
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
      requestedPhase: normalizeScanPhase(request.phase),
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
    const marketDataMode = normalizeMarketDataMode(transportStatus?.marketDataMode);
    const scanPhase = normalizeScanPhase(request.phase);
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
        marketDataMode,
        scanPhase,
      });
    }

    if (!normalizedSymbols.length) {
      return recordRunResult(normalizedSymbols, {
        scannedSymbols: [],
        skippedSymbols: [],
        failedSymbols: [],
        transport,
        skippedReason: null,
        marketDataMode,
        scanPhase,
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
      marketDataMode,
      scanPhase,
    });
  }

  async function drainQueue(): Promise<OptionsFlowScannerRunResult> {
    if (!drainStartedAt) {
      drainStartedAt = new Date(now());
    }
    const batch = Array.from(queued.values());
    queued.clear();
    const batchSymbols = new Set(batch.map((item) => item.symbol));
    batchSymbols.forEach((symbol) => drainingSymbols.add(symbol));
    const result: OptionsFlowScannerRunResult = {
      scannedSymbols: [],
      skippedSymbols: [],
      failedSymbols: [],
      transport: null,
      skippedReason: null,
      marketDataMode: null,
      scanPhase: null,
    };

    try {
      const grouped = new Map<string, QueuedScan[]>();
      for (const item of batch) {
        const groupKey = [
          item.request.limit,
          normalizeThreshold(item.request.unusualThreshold) ?? "default",
          normalizeLineBudget(item.request.lineBudget) ?? "default",
          normalizeScanPhase(item.request.phase) ?? "default",
          normalizePositiveInteger(item.request.expirationScanCount) ?? "default",
          normalizeStrikeCoverage(item.request.strikeCoverage) ?? "default",
        ].join(":");
        const group = grouped.get(groupKey) ?? [];
        group.push(item);
        grouped.set(groupKey, group);
      }

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
        result.marketDataMode = groupResult.marketDataMode;
        result.scanPhase = groupResult.scanPhase;
      }

      return result;
    } finally {
      batchSymbols.forEach((symbol) => drainingSymbols.delete(symbol));
      drainPromise = null;
      if (queued.size > 0) {
        drainPromise = drainQueue();
      } else {
        drainStartedAt = null;
      }
    }
  }

  function requestScan(
    symbols: readonly string[],
    request: OptionsFlowScannerRequest,
  ): Promise<OptionsFlowScannerRunResult> {
    for (const symbol of uniqueSymbols(symbols, normalizeSymbol)) {
      const queueKey = keyFor(symbol, request.unusualThreshold);
      const existing = queued.get(queueKey);
      queued.set(queueKey, {
        symbol,
        request: existing
          ? mergeQueuedRequest(existing.request, request)
          : request,
      });
    }

    if (drainPromise) {
      const activeDrain = drainPromise;
      return activeDrain.then((result) => {
        if (drainPromise && drainPromise !== activeDrain) {
          return drainPromise;
        }
        return result;
      });
    }

    drainPromise = drainQueue();
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
    request: OptionsFlowScannerRequest | (() => OptionsFlowScannerRequest);
    intervalMs: number | (() => number);
    batchSize: number | (() => number);
    onCycle?: (input: { symbols: readonly string[] }) => void;
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
      const normalizedBatchSize = Math.floor(configuredBatchSize);
      if (!Number.isFinite(normalizedBatchSize) || normalizedBatchSize <= 0) {
        return [];
      }
      const size = Math.max(1, Math.min(normalizedBatchSize, symbols.length));
      const start = rotationOffset % symbols.length;
      const batch: string[] = [];
      for (let index = 0; index < size; index += 1) {
        batch.push(symbols[(start + index) % symbols.length]);
      }
      rotationOffset = (start + size) % symbols.length;
      if (rotationOffset === 0) {
        input.onCycle?.({ symbols });
      }
      return batch;
    };

    const run = async () => {
      timer = null;
      const batch = nextBatch();
      if (batch.length) {
        try {
          options.onBatch?.(batch);
          const request =
            typeof input.request === "function" ? input.request() : input.request;
          await requestScan(batch, request);
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
    drainingSymbols.clear();
    activeSymbols.clear();
    drainPromise = null;
    drainStartedAt = null;
    rotationOffset = 0;
    lastRunAt = null;
    lastBatch = [];
    lastRunResult = {
      scannedSymbols: [],
      skippedSymbols: [],
      failedSymbols: [],
      transport: null,
      skippedReason: null,
      marketDataMode: null,
      scanPhase: null,
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
    const scannerActive = Boolean(
      drainPromise || queued.size > 0 || activeSymbols.size > 0,
    );
    return {
      queuedCount: queued.size,
      queuedSymbols: Array.from(queued.values())
        .map((entry) => entry.symbol)
        .sort(),
      drainingCount: drainingSymbols.size,
      drainingSymbols: Array.from(drainingSymbols).sort(),
      draining: Boolean(drainPromise),
      activeCount: activeSymbols.size,
      activeSymbols: Array.from(activeSymbols).sort(),
      drainStartedAt,
      snapshotCount: snapshots.size,
      maxConcurrency,
      lastRunAt,
      lastBatch: [...lastBatch],
      lastScannedSymbols: [...lastRunResult.scannedSymbols],
      lastSkippedSymbols: [...lastRunResult.skippedSymbols],
      lastFailedSymbols: [...lastRunResult.failedSymbols],
      lastSkippedReason: scannerActive ? null : lastRunResult.skippedReason,
      lastTransport: lastRunResult.transport,
      lastMarketDataMode: lastRunResult.marketDataMode,
      lastScanPhase: lastRunResult.scanPhase,
      scanTimeoutMs: getScanTimeoutMs(),
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
