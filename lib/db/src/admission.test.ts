import assert from "node:assert/strict";
import test from "node:test";

import {
  createDbAdmissionScheduler,
  currentDbLane,
  runInDbLane,
  type DbLane,
} from "./admission";

type FakeQueryResult = {
  rows: Array<{ sql: string }>;
};

type FakeClient = {
  id: number;
  query: (sql: string) => Promise<FakeQueryResult>;
  release: () => void;
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
}) => {
  const pool = options?.pool ?? new FakePool(options?.maxInFlight ?? 10);
  const scheduler = createDbAdmissionScheduler<FakeClient>(
    {
      maxInFlight: options?.maxInFlight ?? pool.max,
      agingMs: options?.agingMs ?? 5_000,
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
