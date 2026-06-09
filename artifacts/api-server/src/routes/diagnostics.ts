import { once } from "node:events";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  exportDiagnostics,
  getDiagnosticEventDetail,
  getDiagnosticThresholds,
  getLatestDiagnostics,
  listDiagnosticEvents,
  listDiagnosticHistory,
  pruneDiagnosticStorage,
  recordBrowserReports,
  recordBrowserDiagnosticEvent,
  recordClientDiagnosticsMetrics,
  subscribeDiagnostics,
  updateDiagnosticThresholds,
  type DiagnosticEventStatus,
  type DiagnosticSeverity,
} from "../services/diagnostics";
import {
  refreshGexUniverseSnapshots,
  type GexUniverseRefreshScope,
} from "../services/gex-universe-refresh";
import { recordLatestClientPerfMetrics } from "../services/ibkr-perf-capture";
import { HttpError } from "../lib/errors";

const router: IRouter = Router();

function parseDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function readWindow(req: Request): { from: Date; to: Date } {
  const to = parseDate(req.query.to, new Date());
  const from = parseDate(
    req.query.from,
    new Date(to.getTime() - 60 * 60 * 1000),
  );
  return { from, to };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSeverity(value: unknown): DiagnosticSeverity | undefined {
  if (value === "info" || value === "warning") {
    return value;
  }
  return undefined;
}

function readStatus(value: unknown): DiagnosticEventStatus | undefined {
  if (value === "open" || value === "resolved") {
    return value;
  }
  return undefined;
}

function readLimit(
  value: unknown,
  { fallback, max }: { fallback: number; max: number },
): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(max, parsed);
}

function readOptionalPositiveInteger(
  value: unknown,
  max: number,
): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.min(max, parsed);
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function readGexUniverseRefreshScope(
  value: unknown,
): GexUniverseRefreshScope | undefined {
  if (value === "high_beta_500" || value === "symbols") {
    return value;
  }
  return undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const symbols = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return symbols.length > 0 ? symbols : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const symbols = value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return symbols.length > 0 ? symbols : undefined;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readOptionalFiniteNumber(
  entry: Record<string, unknown>,
  key: "warning",
): number | undefined {
  if (entry[key] === undefined || entry[key] === null || entry[key] === "") {
    return undefined;
  }

  const value = Number(entry[key]);
  if (!Number.isFinite(value) || value < 0) {
    throw new HttpError(400, "Invalid diagnostic threshold override.", {
      code: "invalid_diagnostic_threshold",
      detail: `${key} must be a finite non-negative number.`,
    });
  }
  return value;
}

async function getLatestDiagnosticsOrEmpty() {
  return (
    getLatestDiagnostics() ?? {
      timestamp: new Date().toISOString(),
      status: "unknown",
      severity: "info",
      summary: "Diagnostics collector has not published a snapshot yet.",
      snapshots: [],
      events: [],
      thresholds: await getDiagnosticThresholds(),
    }
  );
}

async function writeSseChunk(res: Response, chunk: string): Promise<void> {
  if (res.write(chunk)) {
    return;
  }
  await once(res, "drain");
}

router.get("/diagnostics/latest", async (_req, res) => {
  res.json(await getLatestDiagnosticsOrEmpty());
});

router.get("/diagnostics/history", async (req, res) => {
  const { from, to } = readWindow(req);
  res.json(
    await listDiagnosticHistory({
      from,
      to,
      subsystem: readString(req.query.subsystem),
      limit: readLimit(req.query.limit, { fallback: 500, max: 2_500 }),
    }),
  );
});

router.get("/diagnostics/events", async (req, res) => {
  const { from, to } = readWindow(req);
  res.json(
    await listDiagnosticEvents({
      from,
      to,
      subsystem: readString(req.query.subsystem),
      severity: readString(req.query.severity),
      status: readStatus(req.query.status),
      limit: readLimit(req.query.limit, { fallback: 200, max: 1_000 }),
    }),
  );
});

router.get("/diagnostics/export", async (req, res) => {
  const { from, to } = readWindow(req);
  res.json(
    await exportDiagnostics({
      from,
      to,
      subsystem: readString(req.query.subsystem),
      snapshotLimit: readLimit(req.query.snapshotLimit ?? req.query.limit, {
        fallback: 500,
        max: 2_500,
      }),
      eventLimit: readLimit(req.query.eventLimit, {
        fallback: 200,
        max: 1_000,
      }),
    }),
  );
});

router.get("/diagnostics/thresholds", async (_req, res) => {
  res.json({ thresholds: await getDiagnosticThresholds() });
});

router.put("/diagnostics/thresholds", async (req, res) => {
  const body = asRecord(req.body);
  const thresholds = Array.isArray(body.thresholds) ? body.thresholds : [];
  res.json({
    thresholds: await updateDiagnosticThresholds(
      thresholds
        .map((entry) => asRecord(entry))
        .map((entry) => {
          const warning = readOptionalFiniteNumber(entry, "warning");
          return {
            metricKey: String(entry.metricKey ?? ""),
            warning,
            enabled:
              typeof entry.enabled === "boolean" ? entry.enabled : undefined,
            audible:
              typeof entry.audible === "boolean" ? entry.audible : undefined,
          };
        }),
    ),
  });
});

router.post("/diagnostics/client-events", async (req, res) => {
  const body = asRecord(req.body);
  const event = await recordBrowserDiagnosticEvent({
    category: readString(body.category) ?? "client-event",
    severity: readSeverity(body.severity) ?? "warning",
    code: readString(body.code),
    message: readString(body.message) ?? "Browser diagnostic event",
    dimensions: asRecord(body.dimensions),
    raw: asRecord(body.raw),
  });
  res.status(202).json({ event });
});

router.post("/diagnostics/client-metrics", async (req, res) => {
  const body = asRecord(req.body);
  // Forward the full payload (incl. the `liveData` attribution section) to the IBKR perf
  // capture sampler so client-side data-flow metrics land in the before/after document.
  recordLatestClientPerfMetrics(body);
  const result = await recordClientDiagnosticsMetrics({
    memory: asRecord(body.memory),
    isolation: asRecord(body.isolation),
    workload: asRecord(body.workload),
    chartHydration: asRecord(body.chartHydration),
    storage: asRecord(body.storage),
    caches: asRecord(body.caches),
    navigation: asRecord(body.navigation),
    screens: asRecord(body.screens),
    longTasks: asRecord(body.longTasks),
    apiTimings: asRecord(body.apiTimings),
    raw: asRecord(body.raw),
  });
  res.status(202).json(result);
});

router.post("/diagnostics/browser-reports", async (req, res) => {
  const result = await recordBrowserReports(req.body);
  res.status(202).json(result);
});

router.post("/diagnostics/storage/prune", async (req, res) => {
  const body = asRecord(req.body);
  const tables = Array.isArray(body.tables)
    ? body.tables.map((value) => String(value))
    : undefined;
  const olderThanDays =
    body.olderThanDays === undefined ? undefined : Number(body.olderThanDays);
  const dryRun = body.dryRun !== false;
  res.json(await pruneDiagnosticStorage({ tables, olderThanDays, dryRun }));
});

router.post("/diagnostics/market-data/gex-universe-refresh", async (req, res) => {
  const body = asRecord(req.body);
  const symbols = readStringList(body.symbols);
  const dryRun = readOptionalBoolean(body.dryRun) ?? true;
  const result = await refreshGexUniverseSnapshots({
    scope:
      readGexUniverseRefreshScope(body.scope) ??
      (symbols?.length ? "symbols" : "high_beta_500"),
    symbols,
    limit: readOptionalPositiveInteger(body.limit, 500),
    batchSize: readOptionalPositiveInteger(body.batchSize, 100),
    staleAfterMs: readOptionalPositiveInteger(
      body.staleAfterMs,
      Number.MAX_SAFE_INTEGER,
    ),
    dryRun,
    refreshUniverse: readOptionalBoolean(body.refreshUniverse),
    reason: readString(body.reason) ?? undefined,
  });

  res.status(dryRun ? 200 : 202).json(result);
});

router.get("/diagnostics/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  let nextId = 1;
  let queue = Promise.resolve();
  const send = (event: string, payload: unknown): void => {
    const id = nextId;
    nextId += 1;
    queue = queue
      .then(() =>
        closed
          ? undefined
          : writeSseChunk(
              res,
              `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
            ),
      )
      .catch(() => {});
  };

  void writeSseChunk(res, "retry: 5000\n\n");
  send("ready", {
    at: new Date().toISOString(),
    latest: getLatestDiagnostics(),
  });

  const unsubscribe = subscribeDiagnostics((message) => {
    send(message.type, message.payload);
  });
  const heartbeat = setInterval(() => {
    send("heartbeat", { at: new Date().toISOString() });
  }, 15_000);
  heartbeat.unref?.();

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.destroyed) {
      res.end();
    }
  };

  res.on("close", cleanup);
  req.on("aborted", cleanup);
});

router.get("/diagnostics/events/:eventId", async (req, res) => {
  const detail = await getDiagnosticEventDetail(req.params.eventId);
  if (!detail) {
    res.status(404).json({
      type: "https://pyrus.local/problems/not-found",
      title: "Diagnostic event not found",
      status: 404,
    });
    return;
  }
  res.json(detail);
});

export default router;
