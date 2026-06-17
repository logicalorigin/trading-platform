import { Router, type IRouter, type Request, type Response } from "express";
import {
  EvaluateSignalMonitorBody,
  EvaluateSignalMonitorResponse,
  GetSignalMonitorProfileQueryParams,
  GetSignalMonitorProfileResponse,
  GetSignalMonitorStateQueryParams,
  GetSignalMonitorStateResponse,
  ListSignalMonitorBreadthHistoryQueryParams,
  ListSignalMonitorBreadthHistoryResponse,
  ListSignalMonitorEventsQueryParams,
  ListSignalMonitorEventsResponse,
  StreamSignalMonitorMatrixQueryParams,
  UpdateSignalMonitorProfileBody,
  UpdateSignalMonitorProfileResponse,
} from "@workspace/api-zod";
import {
  buildSignalMonitorMatrixStreamStoredBootstrapEvent,
  evaluateSignalMonitor,
  getSignalMonitorProfile,
  getSignalMonitorState,
  getSignalMonitorMatrixStreamStatus,
  listSignalMonitorBreadthHistory,
  listSignalMonitorEvents,
  normalizeSignalMonitorMatrixStreamScope,
  resolveSignalSourceEnvironment,
  subscribeSignalMonitorMatrixStream,
  updateSignalMonitorProfile,
} from "../services/signal-monitor";

const router: IRouter = Router();

// Short-TTL single-flight cache for the heavy GET /signal-monitor/state read
// (~1.5 MB / ~3000-state payload). The UI polls it continuously; against the
// hard-capped 12-connection DB pool every poll was a fresh read competing with
// state writes. This collapses concurrent/repeat polls within a short window
// into ONE read. TTL is deliberately short so the UI stays live and a real
// degraded/lastError transition surfaces within ~1.5s; a failed read is evicted
// immediately so a transient error is never served for the full window.
const SIGNAL_MONITOR_STATE_CACHE_TTL_MS = 1_500;
const signalMonitorStateReadCache = new Map<
  string,
  { at: number; promise: Promise<Awaited<ReturnType<typeof getSignalMonitorState>>> }
>();

function getCachedSignalMonitorState(
  input: Parameters<typeof getSignalMonitorState>[0],
): Promise<Awaited<ReturnType<typeof getSignalMonitorState>>> {
  const key = JSON.stringify(input);
  const now = Date.now();
  const cached = signalMonitorStateReadCache.get(key);
  if (cached && now - cached.at < SIGNAL_MONITOR_STATE_CACHE_TTL_MS) {
    return cached.promise;
  }
  // Prune expired entries so a varying query-param key space can't grow unbounded.
  for (const [existingKey, entry] of signalMonitorStateReadCache) {
    if (now - entry.at >= SIGNAL_MONITOR_STATE_CACHE_TTL_MS) {
      signalMonitorStateReadCache.delete(existingKey);
    }
  }
  const promise = getSignalMonitorState(input);
  signalMonitorStateReadCache.set(key, { at: now, promise });
  promise.catch(() => {
    const current = signalMonitorStateReadCache.get(key);
    if (current && current.promise === promise) {
      signalMonitorStateReadCache.delete(key);
    }
  });
  return promise;
}

function splitSignalMonitorMatrixStreamList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSignalMonitorMatrixStreamCells(value: string | undefined) {
  return splitSignalMonitorMatrixStreamList(value).map((item) => {
    const [symbol = "", timeframe = ""] = item.split(":");
    return { symbol, timeframe };
  });
}

async function startSignalMonitorMatrixSse(
  req: Request,
  res: Response,
  setup: (controls: {
    writeEvent: (event: string, payload: unknown) => Promise<void>;
    writeComment: (comment: string) => Promise<void>;
  }) => Promise<() => void> | (() => void),
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let cleanedUp = false;
  let nextEventId = 1;
  let cleanup: () => void = () => {};
  let unsubscribe: () => void = () => {};
  const writeChunk = async (chunk: string) => {
    if (cleanedUp || res.destroyed || res.writableEnded) {
      return;
    }
    res.write(chunk);
  };
  const writeEvent = (event: string, payload: unknown) => {
    const eventId = String(nextEventId);
    nextEventId += 1;
    return writeChunk(
      `id: ${eventId}\n` +
        `event: ${event}\n` +
        `data: ${JSON.stringify(payload)}\n\n`,
    );
  };
  const writeComment = (comment: string) =>
    writeChunk(`: ${comment.replace(/\r?\n/g, " ")}\n\n`);
  const heartbeat = setInterval(() => {
    void writeComment(`ping ${new Date().toISOString()}`);
  }, 15_000);
  heartbeat.unref?.();
  cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  };

  res.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    await writeChunk("retry: 5000\n\n");
    const setupUnsubscribe =
      (await setup({ writeEvent, writeComment })) ?? (() => {});
    if (cleanedUp) {
      setupUnsubscribe();
      return;
    }
    unsubscribe = setupUnsubscribe;
  } catch (error) {
    await writeEvent("error", {
      stream: "signal-matrix",
      event: "error",
      code: "signal_monitor_matrix_stream_setup_failed",
      detail:
        error instanceof Error ? error.message : "Signal Matrix stream setup failed.",
      cooldownMs: 5000,
    }).catch(() => {});
    cleanup();
  }
}

router.get("/signal-monitor/profile", async (req, res) => {
  const query = GetSignalMonitorProfileQueryParams.parse(req.query);
  const data = GetSignalMonitorProfileResponse.parse(
    // Signals are one universal source — read the canonical feed regardless of
    // any environment param (deployment env is execution-only, downstream).
    await getSignalMonitorProfile({
      ...query,
      environment: resolveSignalSourceEnvironment(),
    }),
  );

  res.json(data);
});

router.put("/signal-monitor/profile", async (req, res) => {
  const body = UpdateSignalMonitorProfileBody.parse(req.body);
  const data = UpdateSignalMonitorProfileResponse.parse(
    await updateSignalMonitorProfile(body),
  );

  res.json(data);
});

router.post("/signal-monitor/evaluate", async (req, res) => {
  const body = EvaluateSignalMonitorBody.parse(req.body ?? {});
  const data = EvaluateSignalMonitorResponse.parse(
    await evaluateSignalMonitor(body),
  );

  res.json(data);
});

router.get("/signal-monitor/matrix/stream", async (req, res) => {
  const query = StreamSignalMonitorMatrixQueryParams.parse(req.query);
  const scope = normalizeSignalMonitorMatrixStreamScope({
    // Canonical signal source: stream one feed regardless of any env param.
    environment: resolveSignalSourceEnvironment(),
    symbols: splitSignalMonitorMatrixStreamList(query.symbols),
    timeframes: splitSignalMonitorMatrixStreamList(query.timeframes),
    cells: parseSignalMonitorMatrixStreamCells(query.cells) as never,
    clientRole: query.clientRole,
    requestOrigin: query.requestOrigin,
  });

  if (!scope.symbols.length) {
    res.status(204).end();
    return;
  }

  await startSignalMonitorMatrixSse(req, res, async ({ writeEvent }) => {
    const subscription = await subscribeSignalMonitorMatrixStream({
      scope,
      onEvent: (event) => writeEvent(event.event, event),
    });
    const bootstrap = await buildSignalMonitorMatrixStreamStoredBootstrapEvent(
      subscription.scope,
    );
    await writeEvent(bootstrap.event, bootstrap);
    subscription.recordSnapshot(bootstrap.states);
    await writeEvent(
      "stream-status",
      getSignalMonitorMatrixStreamStatus(subscription.scope),
    );
    const statusTimer = setInterval(() => {
      void writeEvent(
        "stream-status",
        getSignalMonitorMatrixStreamStatus(subscription.scope),
      );
    }, 5_000);
    statusTimer.unref?.();

    return () => {
      clearInterval(statusTimer);
      subscription.unsubscribe();
    };
  });
});

router.get("/signal-monitor/state", async (req, res) => {
  const query = GetSignalMonitorStateQueryParams.parse(req.query);
  const data = GetSignalMonitorStateResponse.parse(
    await getCachedSignalMonitorState({
      ...query,
      environment: resolveSignalSourceEnvironment(),
    }),
  );

  res.json(data);
});

router.get("/signal-monitor/breadth-history", async (req, res) => {
  const query = ListSignalMonitorBreadthHistoryQueryParams.parse(req.query);
  const data = ListSignalMonitorBreadthHistoryResponse.parse(
    await listSignalMonitorBreadthHistory({
      ...query,
      environment: resolveSignalSourceEnvironment(),
    }),
  );

  res.json(data);
});

router.get("/signal-monitor/events", async (req, res) => {
  const query = ListSignalMonitorEventsQueryParams.parse(req.query);
  const data = ListSignalMonitorEventsResponse.parse(
    await listSignalMonitorEvents({
      ...query,
      environment: resolveSignalSourceEnvironment(),
    }),
  );

  res.json(data);
});

export default router;
