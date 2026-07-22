import { Router, type IRouter, type Request, type Response } from "express";
import {
  EvaluateSignalMonitorBody,
  EvaluateSignalMonitorResponse,
  GetSignalMonitorProfileQueryParams,
  GetSignalMonitorProfileResponse,
  GetSignalMonitorStateQueryParams,
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
  resolveSignalSourceEnvironment,
  resolveSignalMonitorMatrixStreamScope,
  subscribeSignalMonitorMatrixStream,
  type SignalMonitorMatrixStreamBootstrapEvent,
  updateSignalMonitorProfile,
} from "../services/signal-monitor";
import { RawJson } from "../lib/raw-json";
import { requireAdminCsrf } from "./auth";

const router: IRouter = Router();
const SIGNAL_MONITOR_SSE_MAX_BUFFERED_CHUNKS = 256;
const SIGNAL_MONITOR_SSE_DRAIN_TIMEOUT_MS = 15_000;

function splitSignalMonitorMatrixStreamList(
  value: string | undefined,
): string[] {
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

export async function startSignalMonitorMatrixSse(
  req: Request,
  res: Response,
  setup: (controls: {
    writeEvent: (event: string, payload: unknown) => Promise<void>;
    writeComment: (comment: string) => Promise<void>;
    registerCleanup: (cleanup: () => void) => void;
  }) => Promise<() => void> | (() => void),
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "private, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let cleanedUp = false;
  let nextEventId = 1;
  let cleanup: () => void = () => {};
  let writeTail = Promise.resolve();
  let pendingChunks = 0;
  const pendingCleanups = new Set<() => void>();
  const completedCleanups = new Set<() => void>();
  const runCleanup = (nextCleanup: () => void) => {
    if (completedCleanups.has(nextCleanup)) {
      return;
    }
    completedCleanups.add(nextCleanup);
    nextCleanup();
  };
  const writeChunk = (chunk: string) => {
    if (cleanedUp) {
      return Promise.resolve();
    }
    if (req.aborted || res.destroyed || res.writableEnded) {
      cleanup();
      return Promise.resolve();
    }
    // Deltas are signature-deduped before fan-out, so silently dropping one can
    // leave a client stale forever. Close and let it reconnect/bootstrap instead
    // of retaining an unbounded queue behind a socket that never drains.
    if (pendingChunks >= SIGNAL_MONITOR_SSE_MAX_BUFFERED_CHUNKS) {
      cleanup();
      return Promise.resolve();
    }
    pendingChunks += 1;
    const pendingWrite = writeTail
      .then(async () => {
        if (cleanedUp || res.destroyed || res.writableEnded) {
          return;
        }
        // Respect socket backpressure: a full-universe bootstrap is multiple MB,
        // and ignoring res.write()'s false return queues the whole payload in the
        // socket buffer per subscriber (memory balloons with every extra tab).
        // Serialize writes so one slow subscriber owns at most one drain/close
        // waiter while preserving SSE frame order.
        if (!res.write(chunk)) {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              done(
                new Error("Signal Matrix SSE client did not drain in time."),
              );
            }, SIGNAL_MONITOR_SSE_DRAIN_TIMEOUT_MS);
            timeout.unref?.();
            const done = (error?: Error) => {
              clearTimeout(timeout);
              res.off("drain", onDrain);
              res.off("close", onClose);
              res.off("error", onError);
              if (error) {
                reject(error);
                return;
              }
              resolve();
            };
            const onDrain = () => done();
            const onClose = () => done();
            const onError = () =>
              done(new Error("Signal Matrix SSE response write failed."));
            res.once("drain", onDrain);
            res.once("close", onClose);
            res.once("error", onError);
          });
        }
      })
      .catch(() => {
        cleanup();
      })
      .finally(() => {
        pendingChunks = Math.max(0, pendingChunks - 1);
      });
    writeTail = pendingWrite;
    return pendingWrite;
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
  const registerCleanup = (nextCleanup: () => void) => {
    if (cleanedUp) {
      runCleanup(nextCleanup);
      return;
    }
    pendingCleanups.add(nextCleanup);
  };
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
    const cleanups = Array.from(pendingCleanups);
    pendingCleanups.clear();
    cleanups.forEach(runCleanup);
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  };

  res.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    await writeChunk("retry: 5000\n\n");
    if (cleanedUp) {
      return;
    }
    const setupUnsubscribe =
      (await setup({ writeEvent, writeComment, registerCleanup })) ??
      (() => {});
    registerCleanup(setupUnsubscribe);
    if (cleanedUp) {
      return;
    }
  } catch (error) {
    await writeEvent("error", {
      stream: "signal-matrix",
      event: "error",
      code: "signal_monitor_matrix_stream_setup_failed",
      detail:
        error instanceof Error
          ? error.message
          : "Signal Matrix stream setup failed.",
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
  await requireAdminCsrf(req);
  const body = UpdateSignalMonitorProfileBody.parse(req.body);
  const data = UpdateSignalMonitorProfileResponse.parse(
    await updateSignalMonitorProfile(body),
  );

  res.json(data);
});

router.post("/signal-monitor/evaluate", async (req, res) => {
  await requireAdminCsrf(req);
  const body = EvaluateSignalMonitorBody.parse(req.body ?? {});
  const data = EvaluateSignalMonitorResponse.parse(
    await evaluateSignalMonitor(body),
  );

  res.json(data);
});

router.get("/signal-monitor/matrix/stream", async (req, res) => {
  const query = StreamSignalMonitorMatrixQueryParams.parse(req.query);
  const scope = await resolveSignalMonitorMatrixStreamScope({
    // Canonical signal source: stream one feed regardless of any env param.
    environment: resolveSignalSourceEnvironment(),
    symbols: splitSignalMonitorMatrixStreamList(query.symbols),
    timeframes: splitSignalMonitorMatrixStreamList(query.timeframes),
    cells: parseSignalMonitorMatrixStreamCells(query.cells) as never,
    clientRole: query.clientRole,
    requestOrigin: query.requestOrigin,
    universe: query.universe,
  });

  if (!scope.symbols.length) {
    res.status(204).end();
    return;
  }

  await startSignalMonitorMatrixSse(
    req,
    res,
    async ({ writeEvent, registerCleanup }) => {
      const subscription = await subscribeSignalMonitorMatrixStream({
        scope,
        onEvent: (event) => writeEvent(event.event, event),
      });
      registerCleanup(() => subscription.unsubscribe());
      const bootstrap =
        await buildSignalMonitorMatrixStreamStoredBootstrapEvent(
          subscription.scope,
        );
      // Page the bootstrap into bounded frames instead of one ~10 MB write: a
      // single frame means one giant synchronous JSON.stringify (event-loop
      // stall on every subscriber connect) and one giant socket enqueue. The
      // frontend merge is per-cell for bootstrap and delta alike
      // (mergeSignalMatrixStreamSnapshot). Multiple bootstrap frames carry the
      // full coverage metadata and are staged client-side until the final page,
      // so the STA table never exposes an alphabetically partial universe.
      // Yield between frames so back-to-back stringifies cannot monopolize the
      // loop.
      for (const frame of buildSignalMonitorMatrixBootstrapFrames(bootstrap)) {
        await writeEvent(frame.event, frame);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
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
      };
    },
  );
});

// Bootstrap frames are sliced to this many states (~1-2 MB of JSON per frame
// at typical state width) so no single stringify/write scales with the whole
// universe (12k states at the 2000-symbol cap).
const SIGNAL_MONITOR_MATRIX_BOOTSTRAP_FRAME_STATES = 2_000;

export type SignalMonitorMatrixBootstrapPage = {
  index: number;
  count: number;
  offset: number;
  stateCount: number;
  complete: boolean;
};

export function buildSignalMonitorMatrixBootstrapFrames(
  bootstrap: SignalMonitorMatrixStreamBootstrapEvent,
  frameStateLimit = SIGNAL_MONITOR_MATRIX_BOOTSTRAP_FRAME_STATES,
): Array<
  SignalMonitorMatrixStreamBootstrapEvent & {
    bootstrapPage: SignalMonitorMatrixBootstrapPage;
  }
> {
  const stateCount = bootstrap.states.length;
  const pageSize = Math.max(1, Math.floor(Number(frameStateLimit) || 1));
  const pageCount = Math.max(1, Math.ceil(stateCount / pageSize));

  return Array.from({ length: pageCount }, (_value, index) => {
    const offset = index * pageSize;
    return {
      ...bootstrap,
      states: bootstrap.states.slice(offset, offset + pageSize),
      bootstrapPage: {
        index,
        count: pageCount,
        offset,
        stateCount,
        complete: index === pageCount - 1,
      },
    };
  });
}

// Short-TTL, in-flight-deduped cache for the heavy /signal-monitor/state poll.
// The matrix display polls this ~every 60s per tab; each miss runs a
// full-universe states read (symbols x timeframes — ~12k rows at the 2000-symbol
// cap) plus a zod parse of a multi-MB payload. Multiple tabs / overlapping
// polls would each pay the DB read. A 15s cache (fresher than the 60s poll) plus
// in-flight dedup collapses concurrent/near-in-time polls into a single read,
// relieving the scarce DB pool. Display-only and read-through (server-side
// trading reads the producer state directly, never this HTTP route), so it
// cannot affect trading. Still served via res.json so the (gzip) response and
// every header are byte-for-byte unchanged.
const SIGNAL_MONITOR_STATE_CACHE_MS = 15_000;
// Cache the SERIALIZED payload, not the object: the multi-MB response (~10 MB
// at the 2000-symbol cap) is otherwise re-stringified synchronously on every
// cache hit (and for every concurrent waiter), blocking the single event loop.
// Serializing once per miss and sending the string via RawJson keeps the bytes
// identical while skipping the repeat stringify.
const signalMonitorStateCache = new Map<string, { json: string; at: number }>();
const signalMonitorStateInFlight = new Map<string, Promise<string>>();
const SIGNAL_MONITOR_BREADTH_HISTORY_CACHE_MS = 5_000;
const signalMonitorBreadthHistoryCache = new Map<
  string,
  { json: string; at: number }
>();
const signalMonitorBreadthHistoryInFlight = new Map<string, Promise<string>>();

export async function getCachedSerializedSignalMonitorBreadthHistory(input: {
  cacheKey: string;
  compute: () => Promise<string>;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const cached = signalMonitorBreadthHistoryCache.get(input.cacheKey);
  if (cached && nowMs - cached.at < SIGNAL_MONITOR_BREADTH_HISTORY_CACHE_MS) {
    return cached.json;
  }

  let pending = signalMonitorBreadthHistoryInFlight.get(input.cacheKey);
  if (!pending) {
    const compute = (async () => {
      const json = await input.compute();
      signalMonitorBreadthHistoryCache.set(input.cacheKey, {
        json,
        at: input.nowMs ?? Date.now(),
      });
      return json;
    })();
    pending = compute;
    signalMonitorBreadthHistoryInFlight.set(input.cacheKey, compute);
    void compute
      .finally(() => {
        if (
          signalMonitorBreadthHistoryInFlight.get(input.cacheKey) === compute
        ) {
          signalMonitorBreadthHistoryInFlight.delete(input.cacheKey);
        }
      })
      .catch(() => {});
  }

  return pending;
}

export function resetSignalMonitorBreadthHistoryRouteCacheForTests() {
  signalMonitorBreadthHistoryCache.clear();
  signalMonitorBreadthHistoryInFlight.clear();
}

router.get("/signal-monitor/state", async (req, res) => {
  // Validate the request shape, but the request's own environment is overridden
  // by the resolved source environment below, so that resolved value is the only
  // input that changes the output (and thus the cache key).
  GetSignalMonitorStateQueryParams.parse(req.query);
  const environment = resolveSignalSourceEnvironment();

  const cached = signalMonitorStateCache.get(environment);
  if (cached && Date.now() - cached.at < SIGNAL_MONITOR_STATE_CACHE_MS) {
    res.json(new RawJson(cached.json));
    return;
  }

  let pending = signalMonitorStateInFlight.get(environment);
  if (!pending) {
    const compute = (async () => {
      // getSignalMonitorState assembles the response from typed rows in the exact
      // response-schema shape (schema-ordered keys, Date fields, no extra keys).
      // Re-validating it against the response schema here only re-walked the full
      // universe (~12k states) synchronously on the event loop (~0.4-1s per miss)
      // to reproduce bytes the handler already produces — a self-check paid on the
      // hot loop, the primary source of the periodic ~1s event-loop stalls.
      // Serialize the handler output directly; the shape contract is now enforced
      // off the hot path by the byte-parity test in
      // signal-monitor-state-serialize.test.ts (fails in CI if shaping/schema drift).
      const json = JSON.stringify(await getSignalMonitorState({ environment }));
      signalMonitorStateCache.set(environment, { json, at: Date.now() });
      return json;
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

  res.json(new RawJson(await pending));
});

router.get("/signal-monitor/breadth-history", async (req, res) => {
  const query = ListSignalMonitorBreadthHistoryQueryParams.parse(req.query);
  const environment = resolveSignalSourceEnvironment();
  const cacheKey = `${environment}:${query.range ?? "day"}`;
  const json = await getCachedSerializedSignalMonitorBreadthHistory({
    cacheKey,
    compute: async () =>
      JSON.stringify(
        ListSignalMonitorBreadthHistoryResponse.parse(
          await listSignalMonitorBreadthHistory({
            ...query,
            environment,
          }),
        ),
      ),
  });

  res.json(new RawJson(json));
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
