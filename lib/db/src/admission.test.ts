import assert from "node:assert/strict";
import test from "node:test";

import {
  createDbAdmissionScheduler,
  currentDbLane,
  DbAdmissionTimeoutError,
  resolveDbAdmissionSchedulerConfig,
  runInDbLane,
  type DbLane,
} from "./admission";
import { parseOptionalPositiveInteger } from "./positive-integer";

type FakeQueryResult = {
  rows: Array<{ sql: string }>;
};

type FakeClient = {
  id: number;
  query: (sql: string) => Promise<FakeQueryResult>;
  release: () => unknown;
};

class FakePool {
  active = 0;
  maxActive = 0;
  queryLog: string[] = [];
  private nextId = 1;
  private waiters: Array<(client: FakeClient) => void> = [];

  constructor(readonly max: number) {}

  connect(): Promise<FakeClient> {
    if (this.active < this.max) {
      return Promise.resolve(this.checkout());
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private checkout(): FakeClient {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    const client: FakeClient = {
      id: this.nextId,
      query: async (sql: string) => {
        this.queryLog.push(sql);
        return { rows: [{ sql }] };
      },
      release: () => {
        this.active -= 1;
        const next = this.waiters.shift();
        if (next) {
          next(this.checkout());
        }
      },
    };
    this.nextId += 1;
    return client;
  }
}

const flushScheduler = async () => {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
};

const makeScheduler = (options?: {
  maxInFlight?: number;
  bulkMax?: number;
  backgroundMax?: number;
  agingMs?: number;
  now?: () => number;
  pool?: FakePool;
  acquireTimeoutMs?: number;
}) => {
  const pool = options?.pool ?? new FakePool(options?.maxInFlight ?? 10);
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    {
      maxInFlight: options?.maxInFlight ?? pool.max,
      agingMs: options?.agingMs ?? 5_000,
      acquireTimeoutMs: options?.acquireTimeoutMs,
      lanes: {
        bulk: { maxInFlight: options?.bulkMax ?? 6 },
        background: { maxInFlight: options?.backgroundMax ?? 2 },
      },
      now: options?.now,
    },
    () => pool.connect(),
  );
  return { pool, scheduler };
};

test("fractional and noncanonical admission limits fall back safely", async () => {
  const resolved = resolveDbAdmissionSchedulerConfig(12, {
    PYRUS_DB_LANE_AGING_MS: "0.5",
    PYRUS_DB_LANE_BULK_MAX: "07",
    PYRUS_DB_LANE_BACKGROUND_MAX: "2147483648",
  });
  assert.equal(resolved.agingMs, 5_000);
  assert.equal(resolved.lanes?.bulk?.maxInFlight, 6);
  assert.equal(resolved.lanes?.background?.maxInFlight, 2);

  const { scheduler } = makeScheduler({
    maxInFlight: 0.5,
    bulkMax: 0.5,
    pool: new FakePool(1),
  });
  let client: FakeClient | null = null;
  void scheduler.acquire("bulk").then((acquired) => {
    client = acquired;
  });
  await flushScheduler();
  assert.ok(client, "an invalid sub-unit limit must not deadlock admission");
  (client as FakeClient).release();
});

test("positive integer parsing stays within the shared timer ceiling", () => {
  for (const [value, expected] of [
    [undefined, undefined],
    ["", undefined],
    ["0", undefined],
    ["-1", undefined],
    ["+1", undefined],
    [" 1", undefined],
    ["01", undefined],
    ["1.0", undefined],
    ["1e3", undefined],
    ["1", 1],
    ["2147483647", 2_147_483_647],
    ["2147483648", undefined],
    ["9007199254740991", undefined],
  ] as const) {
    assert.equal(parseOptionalPositiveInteger(value), expected, value);
  }
});

test("direct admission timeout configuration rejects timer-overflow values", async () => {
  const pool = new FakePool(1);
  let allowUnderlying!: () => void;
  const underlyingAllowed = new Promise<void>((resolve) => {
    allowUnderlying = resolve;
  });
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1, acquireTimeoutMs: 2_147_483_648 },
    async () => {
      await underlyingAllowed;
      return pool.connect();
    },
  );
  let outcome: "pending" | "resolved" | "rejected" = "pending";
  let client: FakeClient | null = null;
  const observed = scheduler.acquire().then(
    (acquired) => {
      client = acquired;
      outcome = "resolved";
    },
    () => {
      outcome = "rejected";
    },
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(outcome, "pending");
  allowUnderlying();
  await observed;
  assert.equal(outcome, "resolved");
  client!.release();
});

test("admission wait shares the configured pool acquisition timeout", async () => {
  const { scheduler } = makeScheduler({
    maxInFlight: 1,
    acquireTimeoutMs: 15,
  });
  const first = await scheduler.acquire();

  const error = await scheduler.acquire().then(
    () => null,
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof DbAdmissionTimeoutError);
  assert.equal(error.code, "DB_ADMISSION_TIMEOUT");
  assert.equal(error.kind, "acquire");
  assert.equal(error.lane, "interactive");
  assert.equal(error.timeoutMs, 15);
  assert.equal(error.retryAfterSeconds, 1);
  assert.equal(scheduler.getDiagnostics().interactive.queued, 0);
  assert.equal(scheduler.getDiagnostics().interactive.rejectedTotal, 1);
  assert.equal(scheduler.getDiagnostics().interactive.canceledTotal, 0);
  first.release();
  await flushScheduler();
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
});

test("a queued caller abort removes its middle entry and preserves FIFO progress", async () => {
  const { scheduler } = makeScheduler({ maxInFlight: 1 });
  const first = await scheduler.acquire();
  const controller = new AbortController();
  const cancelReason = new Error("request disconnected");
  const before = scheduler.acquire("bulk");
  const canceled = scheduler.acquire("bulk", {
    signal: controller.signal,
  });
  const next = scheduler.acquire("bulk");
  await flushScheduler();
  assert.equal(scheduler.getDiagnostics().bulk.queued, 3);

  controller.abort(cancelReason);
  await assert.rejects(canceled, (error: unknown) => error === cancelReason);
  assert.equal(scheduler.getDiagnostics().bulk.queued, 2);
  assert.equal(scheduler.getDiagnostics().bulk.canceledTotal, 1);
  assert.equal(scheduler.getDiagnostics().bulk.rejectedTotal, 0);

  first.release();
  const beforeClient = await before;
  beforeClient.release();
  const nextClient = await next;
  nextClient.release();
  assert.equal(scheduler.getDiagnostics().bulk.queued, 0);
  assert.equal(scheduler.getDiagnostics().bulk.inFlight, 0);
});

test("an already-aborted acquire never starts a physical acquisition", async () => {
  const controller = new AbortController();
  const cancelReason = new Error("request already gone");
  controller.abort(cancelReason);
  let acquireCount = 0;
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1 },
    () => {
      acquireCount += 1;
      return new FakePool(1).connect();
    },
  );

  await assert.rejects(
    scheduler.acquire("interactive", { signal: controller.signal }),
    (error: unknown) => error === cancelReason,
  );

  assert.equal(acquireCount, 0);
  assert.equal(scheduler.getDiagnostics().interactive.queued, 0);
  assert.equal(scheduler.getDiagnostics().interactive.canceledTotal, 1);
  assert.equal(scheduler.getDiagnostics().interactive.rejectedTotal, 0);
});

test("shedAfterMs rejects a queued lane entry with a typed timeout", async () => {
  const pool = new FakePool(1);
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    {
      maxInFlight: 1,
      lanes: {
        background: { maxInFlight: 1, shedAfterMs: 15 },
      },
    },
    () => pool.connect(),
  );
  const first = await scheduler.acquire();

  const error = await scheduler.acquire("background").then(
    () => null,
    (reason: unknown) => reason,
  );

  assert.ok(error instanceof DbAdmissionTimeoutError);
  assert.equal(error.kind, "shed");
  assert.equal(error.lane, "background");
  assert.equal(error.timeoutMs, 15);
  assert.equal(scheduler.getDiagnostics().background.queued, 0);
  assert.equal(scheduler.getDiagnostics().background.rejectedTotal, 1);
  assert.equal(scheduler.getDiagnostics().background.canceledTotal, 0);
  first.release();
});

test("shedAfterMs stops applying once physical acquisition starts", async () => {
  let resolveClient!: (client: FakeClient) => void;
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    {
      maxInFlight: 1,
      lanes: {
        background: { maxInFlight: 1, shedAfterMs: 15 },
      },
    },
    () =>
      new Promise<FakeClient>((resolve) => {
        resolveClient = resolve;
      }),
  );
  let outcome: "pending" | "resolved" | "rejected" = "pending";
  const pending = scheduler.acquire("background").then(
    (client) => {
      outcome = "resolved";
      return client;
    },
    (error: unknown) => {
      outcome = "rejected";
      throw error;
    },
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.equal(outcome, "pending");

  resolveClient({
    id: 1,
    query: async (sql) => ({ rows: [{ sql }] }),
    release() {},
  });
  const client = await pending;
  assert.equal(outcome, "resolved");
  client.release();
  assert.equal(scheduler.getDiagnostics().background.rejectedTotal, 0);
});

test("a client acquired after caller abort is released without leaking a slot", async () => {
  let resolveFirst!: (client: FakeClient) => void;
  let attempts = 0;
  let lateReleaseCount = 0;
  const fallbackPool = new FakePool(1);
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1 },
    () => {
      attempts += 1;
      if (attempts > 1) return fallbackPool.connect();
      return new Promise<FakeClient>((resolve) => {
        resolveFirst = resolve;
      });
    },
  );
  const controller = new AbortController();
  const cancelReason = new Error("request disconnected");
  const pending = scheduler.acquire("interactive", {
    signal: controller.signal,
  });
  await flushScheduler();

  controller.abort(cancelReason);
  await assert.rejects(pending, (error: unknown) => error === cancelReason);
  resolveFirst({
    id: 1,
    query: async (sql) => ({ rows: [{ sql }] }),
    release: () => {
      lateReleaseCount += 1;
    },
  });
  await flushScheduler();

  assert.equal(lateReleaseCount, 1);
  assert.equal(scheduler.getDiagnostics().interactive.queued, 0);
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
  assert.equal(scheduler.getDiagnostics().interactive.admittedTotal, 0);
  assert.equal(scheduler.getDiagnostics().interactive.canceledTotal, 1);
  assert.equal(scheduler.getDiagnostics().interactive.rejectedTotal, 0);

  const next = await scheduler.acquire();
  next.release();
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
});

test("a burst of queued acquisition timeouts leaves no counted queue entries", async () => {
  const { scheduler } = makeScheduler({
    maxInFlight: 1,
    acquireTimeoutMs: 15,
  });
  const first = await scheduler.acquire();
  const waiting = Array.from({ length: 250 }, () => scheduler.acquire());

  const results = await Promise.allSettled(waiting);

  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(scheduler.getDiagnostics().interactive.queued, 0);
  assert.equal(scheduler.getDiagnostics().interactive.rejectedTotal, 250);
  assert.equal(scheduler.getDiagnostics().interactive.canceledTotal, 0);
  first.release();
  await flushScheduler();
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
});

test("a client acquired after timeout is released without consuming a slot", async () => {
  let resolveFirst!: (client: FakeClient) => void;
  let attempts = 0;
  let lateReleaseCount = 0;
  let asyncReleaseObserved = false;
  const fallbackPool = new FakePool(1);
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1, acquireTimeoutMs: 15 },
    () => {
      attempts += 1;
      if (attempts > 1) return fallbackPool.connect();
      return new Promise<FakeClient>((resolve) => {
        resolveFirst = resolve;
      });
    },
  );

  await assert.rejects(
    scheduler.acquire(),
    /timeout exceeded when trying to connect/i,
  );
  resolveFirst({
    id: 1,
    query: async (sql) => ({ rows: [{ sql }] }),
    release: () => {
      lateReleaseCount += 1;
      return {
        then: (
          _resolve: (value: unknown) => void,
          reject: (error: Error) => void,
        ) => {
          asyncReleaseObserved = true;
          reject(new Error("late async release failure"));
        },
      };
    },
  });
  await flushScheduler();

  assert.equal(lateReleaseCount, 1);
  assert.equal(asyncReleaseObserved, true);
  assert.deepEqual(scheduler.getDiagnostics().interactive, {
    queued: 0,
    inFlight: 0,
    admittedTotal: 0,
    rejectedTotal: 1,
    canceledTotal: 0,
    maxWaitMs: 0,
    recentWaitMsP95: 0,
  });

  const next = await scheduler.acquire();
  next.release();
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
});

test("an unwrappable acquired client is released and does not leak admission", async () => {
  let attempts = 0;
  let abandonedReleaseCount = 0;
  const fallbackPool = new FakePool(1);
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1, acquireTimeoutMs: 50 },
    () => {
      attempts += 1;
      if (attempts > 1) return fallbackPool.connect();
      return Object.freeze({
        id: 1,
        query: async (sql: string) => ({ rows: [{ sql }] }),
        release: () => {
          abandonedReleaseCount += 1;
        },
      });
    },
  );

  await assert.rejects(scheduler.acquire());
  await flushScheduler();
  assert.equal(abandonedReleaseCount, 1);
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);

  const next = await scheduler.acquire();
  next.release();
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
});

test("failed release installation cannot consume another checkout's slot", async () => {
  for (const setterMode of ["partial", "silent"] as const) {
    let attempts = 0;
    let physicalActive = 0;
    let maxPhysicalActive = 0;
    const scheduler = createDbAdmissionScheduler<FakeClient>(
      { maxInFlight: 2 },
      () => {
        attempts += 1;
        physicalActive += 1;
        maxPhysicalActive = Math.max(maxPhysicalActive, physicalActive);
        const client: FakeClient = {
          id: attempts,
          query: async (sql) => ({ rows: [{ sql }] }),
          release: () => {
            physicalActive -= 1;
          },
        };
        if (attempts !== 2) return client;
        return new Proxy(client, {
          set(target, property, value) {
            if (setterMode === "partial") {
              Reflect.set(target, property, value, target);
              return false;
            }
            return true;
          },
        });
      },
    );

    const first = await scheduler.acquire();
    await assert.rejects(scheduler.acquire());
    assert.equal(physicalActive, 1, setterMode);
    assert.equal(
      scheduler.getDiagnostics().interactive.inFlight,
      1,
      setterMode,
    );

    const third = await scheduler.acquire();
    assert.equal(maxPhysicalActive, 2, setterMode);
    first.release();
    third.release();
    assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
    assert.equal(physicalActive, 0, setterMode);
  }
});

test("a late acquisition failure frees the opening reservation", async () => {
  let rejectFirst!: (error: Error) => void;
  let attempts = 0;
  const fallbackPool = new FakePool(1);
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1, acquireTimeoutMs: 15 },
    () => {
      attempts += 1;
      if (attempts > 1) return fallbackPool.connect();
      return new Promise<FakeClient>((_resolve, reject) => {
        rejectFirst = reject;
      });
    },
  );

  await assert.rejects(
    scheduler.acquire(),
    /timeout exceeded when trying to connect/i,
  );
  rejectFirst(new Error("late physical connection failure"));
  await flushScheduler();

  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
  const next = await scheduler.acquire();
  next.release();
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 0);
});

test("an underlying acquisition failure increments rejected diagnostics once", async () => {
  const physicalError = new Error("database unavailable");
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1 },
    () => Promise.reject(physicalError),
  );

  await assert.rejects(
    scheduler.acquire("bulk"),
    (error: unknown) => error === physicalError,
  );

  assert.equal(scheduler.getDiagnostics().bulk.queued, 0);
  assert.equal(scheduler.getDiagnostics().bulk.inFlight, 0);
  assert.equal(scheduler.getDiagnostics().bulk.rejectedTotal, 1);
  assert.equal(scheduler.getDiagnostics().bulk.canceledTotal, 0);
});

test("bulk cap 2 limits concurrent acquisitions and preserves FIFO order", async () => {
  const { pool, scheduler } = makeScheduler({
    maxInFlight: 10,
    bulkMax: 2,
  });
  const acquired: FakeClient[] = [];
  const order: number[] = [];
  const requests = Array.from({ length: 5 }, (_, index) =>
    runInDbLane("bulk", () =>
      scheduler.acquire().then((client) => {
        acquired.push(client);
        order.push(index);
        return client;
      }),
    ),
  );

  await flushScheduler();

  assert.equal(pool.maxActive, 2);
  assert.equal(acquired.length, 2);
  assert.deepEqual(order, [0, 1]);
  assert.equal(scheduler.getDiagnostics().bulk.queued, 3);

  acquired[0].release();
  await flushScheduler();
  assert.deepEqual(order, [0, 1, 2]);

  acquired[1].release();
  await flushScheduler();
  assert.deepEqual(order, [0, 1, 2, 3]);

  acquired[2].release();
  await flushScheduler();
  assert.deepEqual(order, [0, 1, 2, 3, 4]);

  acquired[3].release();
  acquired[4].release();
  await Promise.all(requests);
  assert.equal(scheduler.getDiagnostics().bulk.inFlight, 0);
});

test("interactive acquisitions bypass lane caps while bulk is queued", async () => {
  const { scheduler } = makeScheduler({
    maxInFlight: 4,
    bulkMax: 1,
  });
  const acquired: string[] = [];
  const bulkRequests: Array<Promise<FakeClient>> = [];

  for (let index = 0; index < 3; index += 1) {
    bulkRequests.push(
      runInDbLane("bulk", () =>
        scheduler.acquire().then((client) => {
          acquired.push(`bulk-${index}`);
          return client;
        }),
      ),
    );
  }
  await flushScheduler();
  assert.equal(scheduler.getDiagnostics().bulk.queued, 2);

  const interactive = runInDbLane("interactive", () =>
    scheduler.acquire().then((client) => {
      acquired.push("interactive");
      return client;
    }),
  );
  await flushScheduler();

  assert.deepEqual(acquired, ["bulk-0", "interactive"]);
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 1);

  const interactiveClient = await interactive;
  interactiveClient.release();

  const firstBulk = await bulkRequests[0];
  firstBulk.release();
  await flushScheduler();

  const secondBulk = await bulkRequests[1];
  secondBulk.release();
  await flushScheduler();

  const thirdBulk = await bulkRequests[2];
  thirdBulk.release();
  await Promise.all(bulkRequests);
});

test("aging admits an old bulk entry before a fresh interactive burst", async () => {
  let nowMs = 0;
  const { scheduler } = makeScheduler({
    maxInFlight: 1,
    bulkMax: 1,
    agingMs: 5_000,
    now: () => nowMs,
  });
  const order: string[] = [];

  const firstBulk = await runInDbLane("bulk", () => scheduler.acquire());
  const oldBulk = runInDbLane("bulk", () =>
    scheduler.acquire().then((client) => {
      order.push("old-bulk");
      return client;
    }),
  );
  await flushScheduler();
  assert.equal(scheduler.getDiagnostics().bulk.queued, 1);

  nowMs = 6_000;
  const interactiveRequests = ["interactive-1", "interactive-2"].map((label) =>
    runInDbLane("interactive", () =>
      scheduler.acquire().then((client) => {
        order.push(label);
        return client;
      }),
    ),
  );

  firstBulk.release();
  await flushScheduler();

  assert.deepEqual(order, ["old-bulk"]);
  const oldBulkClient = await oldBulk;
  oldBulkClient.release();
  await flushScheduler();

  const firstInteractive = await interactiveRequests[0];
  firstInteractive.release();
  await flushScheduler();

  const secondInteractive = await interactiveRequests[1];
  secondInteractive.release();
});

test("an unreleased checkout keeps its slot and double release frees only one", async () => {
  const { scheduler } = makeScheduler({ maxInFlight: 1 });
  const acquired: string[] = [];

  const first = await scheduler.acquire();
  const second = scheduler.acquire().then((client) => {
    acquired.push("second");
    return client;
  });
  const third = scheduler.acquire().then((client) => {
    acquired.push("third");
    return client;
  });
  await flushScheduler();

  assert.equal(scheduler.getDiagnostics().interactive.queued, 2);
  first.release();
  first.release();
  await flushScheduler();

  assert.deepEqual(acquired, ["second"]);
  assert.equal(scheduler.getDiagnostics().interactive.inFlight, 1);
  assert.equal(scheduler.getDiagnostics().interactive.queued, 1);

  const secondClient = await second;
  secondClient.release();
  await flushScheduler();
  assert.deepEqual(acquired, ["second", "third"]);

  const thirdClient = await third;
  thirdClient.release();
});

test("long admission waits remain nonnegative in percentile diagnostics", async () => {
  let nowMs = 0;
  let resolveClient!: (client: FakeClient) => void;
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    { maxInFlight: 1, now: () => nowMs },
    () =>
      new Promise<FakeClient>((resolve) => {
        resolveClient = resolve;
      }),
  );
  const pending = scheduler.acquire();
  await flushScheduler();

  nowMs = 2_147_483_648;
  resolveClient({
    id: 1,
    query: async (sql) => ({ rows: [{ sql }] }),
    release() {},
  });
  const client = await pending;

  assert.equal(scheduler.getDiagnostics().interactive.maxWaitMs, 2_147_483_648);
  assert.equal(
    scheduler.getDiagnostics().interactive.recentWaitMsP95,
    2_147_483_648,
  );
  client.release();
});

test("acquisitions outside runInDbLane use the interactive lane", async () => {
  const { scheduler } = makeScheduler({ maxInFlight: 2 });
  assert.equal(currentDbLane(), "interactive");

  const first = await scheduler.acquire();
  const second = await scheduler.acquire();
  const diagnostics = scheduler.getDiagnostics();

  assert.equal(diagnostics.interactive.inFlight, 2);
  assert.equal(diagnostics.bulk.inFlight, 0);
  assert.equal(diagnostics.background.inFlight, 0);

  first.release();
  second.release();
});

test("scheduler tick wrapper propagates lane to nested async db calls", async () => {
  const { scheduler } = makeScheduler({
    maxInFlight: 2,
    bulkMax: 1,
  });

  const tick = () =>
    runInDbLane("bulk", async () => {
      await Promise.resolve();
      const nestedDbCall = async () => {
        assert.equal(currentDbLane(), "bulk");
        const client = await scheduler.acquire();
        try {
          assert.equal(currentDbLane(), "bulk");
          return client.query("select scheduled_bulk_tick");
        } finally {
          client.release();
        }
      };
      return nestedDbCall();
    });

  const result = await tick();

  assert.deepEqual(result.rows, [{ sql: "select scheduled_bulk_tick" }]);
  assert.equal(scheduler.getDiagnostics().bulk.admittedTotal, 1);
  assert.equal(scheduler.getDiagnostics().interactive.admittedTotal, 0);
});

test("randomized mixed traffic preserves lane caps, pool cap, and counters", async () => {
  const pool = new FakePool(7);
  const { scheduler } = makeScheduler({
    pool,
    maxInFlight: 7,
    bulkMax: 3,
    backgroundMax: 2,
    agingMs: 25,
  });
  let seed = 0x5eed;
  const nextInt = (max: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % max;
  };
  const lanes: DbLane[] = ["interactive", "bulk", "background"];
  const active: FakeClient[] = [];
  const requests: Array<Promise<FakeClient>> = [];

  for (let index = 0; index < 200; index += 1) {
    const lane = lanes[nextInt(lanes.length)];
    requests.push(
      runInDbLane(lane, () =>
        scheduler.acquire().then((client) => {
          active.push(client);
          return client;
        }),
      ),
    );
  }
  await flushScheduler();

  const assertInvariants = () => {
    const diagnostics = scheduler.getDiagnostics();
    const totalInFlight =
      diagnostics.interactive.inFlight +
      diagnostics.bulk.inFlight +
      diagnostics.background.inFlight;

    assert.ok(diagnostics.bulk.inFlight <= 3);
    assert.ok(diagnostics.background.inFlight <= 2);
    assert.ok(totalInFlight <= pool.max);
    assert.equal(totalInFlight, pool.active);
  };

  let released = 0;
  while (released < 200) {
    await flushScheduler();
    assertInvariants();
    assert.ok(active.length > 0);

    const releaseIndex = nextInt(active.length);
    const [client] = active.splice(releaseIndex, 1);
    client.release();
    released += 1;
  }

  await Promise.all(requests);
  await flushScheduler();

  const diagnostics = scheduler.getDiagnostics();
  assert.equal(diagnostics.interactive.queued, 0);
  assert.equal(diagnostics.bulk.queued, 0);
  assert.equal(diagnostics.background.queued, 0);
  assert.equal(diagnostics.interactive.inFlight, 0);
  assert.equal(diagnostics.bulk.inFlight, 0);
  assert.equal(diagnostics.background.inFlight, 0);
  assert.equal(
    diagnostics.interactive.admittedTotal +
      diagnostics.bulk.admittedTotal +
      diagnostics.background.admittedTotal,
    200,
  );
});

test("fake pool wiring supports acquire-query-release usage", async () => {
  const pool = new FakePool(3);
  const { scheduler } = makeScheduler({
    pool,
    maxInFlight: 3,
    bulkMax: 2,
    backgroundMax: 1,
  });

  const runQuery = async (lane: DbLane, sql: string) =>
    runInDbLane(lane, async () => {
      const client = await scheduler.acquire();
      try {
        return await client.query(sql);
      } finally {
        client.release();
      }
    });

  const results = await Promise.all([
    runQuery("bulk", "select bulk_1"),
    runQuery("bulk", "select bulk_2"),
    runQuery("background", "select background_1"),
    runQuery("interactive", "select interactive_1"),
    runQuery("interactive", "select interactive_2"),
  ]);

  assert.equal(pool.maxActive, 3);
  assert.deepEqual(
    results.flatMap((result) => result.rows.map((row) => row.sql)).sort(),
    [
      "select background_1",
      "select bulk_1",
      "select bulk_2",
      "select interactive_1",
      "select interactive_2",
    ],
  );
});
