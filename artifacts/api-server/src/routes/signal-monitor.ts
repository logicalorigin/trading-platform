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

// Short-TTL, in-flight-deduped cache for the heavy /signal-monitor/state poll.
// The matrix display polls this ~every 60s per tab; each miss runs a ~3000-row
// states read plus a zod parse of a ~1.4 MB payload. Multiple tabs / overlapping
// polls would each pay the DB read. A 15s cache (fresher than the 60s poll) plus
// in-flight dedup collapses concurrent/near-in-time polls into a single read,
// relieving the scarce DB pool. Display-only and read-through (server-side
// trading reads the producer state directly, never this HTTP route), so it
// cannot affect trading. Still served via res.json so the (gzip) response and
// every header are byte-for-byte unchanged.
const SIGNAL_MONITOR_STATE_CACHE_MS = 15_000;
type SignalMonitorStateData = ReturnType<
  typeof GetSignalMonitorStateResponse.parse
>;
const signalMonitorStateCache = new Map<
  string,
  { data: SignalMonitorStateData; at: number }
>();
const signalMonitorStateInFlight = new Map<
  string,
  Promise<SignalMonitorStateData>
>();

router.get("/signal-monitor/state", async (req, res) => {
  // Validate the request shape, but the request's own environment is overridden
  // by the resolved source environment below, so that resolved value is the only
  // input that changes the output (and thus the cache key).
  GetSignalMonitorStateQueryParams.parse(req.query);
  const environment = resolveSignalSourceEnvironment();

  const cached = signalMonitorStateCache.get(environment);
  if (cached && Date.now() - cached.at < SIGNAL_MONITOR_STATE_CACHE_MS) {
    res.json(cached.data);
    return;
  }

  let pending = signalMonitorStateInFlight.get(environment);
  if (!pending) {
    const compute = (async () => {
      const data = GetSignalMonitorStateResponse.parse(
        await getSignalMonitorState({ environment }),
      );
      signalMonitorStateCache.set(environment, { data, at: Date.now() });
      return data;
    })();
    pending = compute;
    signalMonitorStateInFlight.set(environment, compute);
    // Best-effort cleanup; errors are not cached so the next request retries.
    // The real error is propagated to the route via `await pending`; this
    // separate cleanup chain swallows it so it can't surface as an unhandled
    // rejection.
    void compute
      .finally(() => {
        if (signalMonitorStateInFlight.get(environment) === compute) {
          signalMonitorStateInFlight.delete(environment);
        }
      })
      .catch(() => {});
  }

  res.json(await pending);
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
