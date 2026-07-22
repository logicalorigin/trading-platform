import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import { createFlowUniverseManager } from "./flow-universe";
import { createFlowUniversePlanner } from "./flow-universe-planner";

function setHardResourcePressure(): void {
  const pressure = { dbPoolActive: 12, dbPoolWaiting: 8, dbPoolMax: 12 };
  updateApiResourcePressure(pressure);
  updateApiResourcePressure(pressure);
}

async function settleRefresh(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("flow-universe refresh reaches database admission despite unrelated global pressure", async () => {
  __resetApiResourcePressureForTests();
  setHardResourcePressure();
  let selectCalls = 0;
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        selectCalls += 1;
        throw new Error("refresh reached database admission");
      }) as never,
      update: (() => {
        throw new Error("unexpected update");
      }) as never,
      insert: (() => {
        throw new Error("unexpected insert");
      }) as never,
    },
    mode: "market",
    targetSize: 1,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
    now: () => new Date("2026-07-16T19:00:00.000Z"),
  });

  manager.getSymbols();
  await settleRefresh();
  assert.equal(manager.getCoverage().lastRefreshAt, null);
  assert.equal(selectCalls, 1);

  manager.getSymbols();
  await settleRefresh();
  assert.equal(selectCalls, 2);
  assert.equal(manager.getCoverage().lastRefreshAt, null);
  assert.equal(manager.getCoverage().lastGoodAt, null);

  __resetApiResourcePressureForTests();
});

test("flow-universe planner reaches database admission despite unrelated global pressure", async () => {
  __resetApiResourcePressureForTests();
  setHardResourcePressure();
  let selectCalls = 0;
  const query = {
    from() {
      return this;
    },
    leftJoin() {
      return this;
    },
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    async limit() {
      return [];
    },
  };
  const planner = createFlowUniversePlanner({
    db: {
      select: (() => {
        selectCalls += 1;
        return query;
      }) as never,
    },
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    refreshMs: 15 * 60_000,
    now: () => new Date("2026-07-16T19:00:00.000Z"),
  });
  const input = {
    targetSize: 1,
    batchSize: 1,
    lineBudget: 1,
    perScanLineBudget: 1,
    effectiveConcurrency: 1,
  };

  planner.getPlan(input);
  await settleRefresh();
  assert.equal(
    (planner.getPlan(input).diagnostics as { lastRefreshAt?: string | null })
      .lastRefreshAt,
    "2026-07-16T19:00:00.000Z",
  );
  assert.equal(selectCalls, 1);

  __resetApiResourcePressureForTests();
});

test("global API pressure does not gate flow observation persistence", async () => {
  __resetApiResourcePressureForTests();
  setHardResourcePressure();
  let insertCalls = 0;
  let insertedRows = 0;
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        throw new Error("unexpected select");
      }) as never,
      update: (() => {
        throw new Error("unexpected update");
      }) as never,
      insert: ((_: unknown) => {
        insertCalls += 1;
        return {
          values(rows: unknown[]) {
            insertedRows += rows.length;
            return {
              async onConflictDoUpdate() {},
            };
          },
        };
      }) as never,
    },
    mode: "market",
    targetSize: 1,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });

  let flushed = false;
  for (let index = 0; index < 250; index += 1) {
    manager.recordObservation({
      symbol: `FLOW${index}`,
      events: [],
    });
  }
  const drain = manager.drainObservationPersistence();
  void drain.then(() => {
    flushed = true;
  });
  await drain;

  assert.equal(insertCalls, 1);
  assert.equal(insertedRows, 250);
  assert.equal(flushed, true);
  __resetApiResourcePressureForTests();
});

test("flow observations retry a failed write without dropping the batch", async () => {
  __resetApiResourcePressureForTests();
  let insertCalls = 0;
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        throw new Error("unexpected select");
      }) as never,
      update: (() => {
        return {
          set() {
            return {
              async where() {},
            };
          },
        };
      }) as never,
      insert: ((_: unknown) => {
        const call = ++insertCalls;
        return {
          values() {
            return {
              async onConflictDoUpdate() {
                if (call === 1) {
                  throw Object.assign(
                    new Error("transient ranking write failure"),
                    { code: "08006" },
                  );
                }
              },
              async onConflictDoNothing() {},
            };
          },
        };
      }) as never,
    },
    mode: "market",
    targetSize: 1,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });

  for (let index = 0; index < 250; index += 1) {
    manager.recordObservation({
      symbol: `RETRY${index}`,
      events: [],
    });
  }
  await settleRefresh();
  assert.equal(insertCalls, 1);

  manager.recordObservation({
    symbol: "RETRY-LATER",
    events: [],
  });
  await manager.drainObservationPersistence();
  assert.equal(insertCalls, 3);
  assert.equal(manager.getCoverage().observationPersistenceStatus, "healthy");
  assert.equal(manager.getCoverage().observationPersistencePending, 0);
  __resetApiResourcePressureForTests();
});

test("flow observations coalesce repeated symbols while a database write is active", async () => {
  __resetApiResourcePressureForTests();
  let insertCalls = 0;
  let releaseFirstWrite!: () => void;
  const firstWriteBlocked = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        throw new Error("unexpected select");
      }) as never,
      update: (() => ({
        set() {
          return {
            async where() {},
          };
        },
      })) as never,
      insert: ((_: unknown) => {
        const call = ++insertCalls;
        return {
          values() {
            return {
              async onConflictDoUpdate() {
                if (call === 1) {
                  await firstWriteBlocked;
                }
              },
              async onConflictDoNothing() {},
            };
          },
        };
      }) as never,
    },
    mode: "market",
    targetSize: 2,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });

  for (let index = 0; index < 250; index += 1) {
    manager.recordObservation({ symbol: `BLOCKED${index}`, events: [] });
  }
  await settleRefresh();
  assert.equal(insertCalls, 1);

  for (let index = 0; index < 100; index += 1) {
    manager.recordObservation({ symbol: "BLOCKED-LATER", events: [] });
  }
  assert.equal(manager.getCoverage().observationPersistenceCoalesced, 99);
  manager.recordObservation({ symbol: "BLOCKED-SECOND", events: [] });
  manager.recordObservation({ symbol: "BLOCKED-THIRD", events: [] });
  assert.equal(
    manager.getCoverage().observationPersistenceDiscarded,
    100,
    "deferred admission is bounded by the configured active universe",
  );

  releaseFirstWrite();
  await manager.drainObservationPersistence();
  assert.equal(
    insertCalls,
    2,
    "recovery should write the retained batch and one compacted state per symbol",
  );
  __resetApiResourcePressureForTests();
});

test("flow observation admission stays synchronous while a separate drain waits for persistence", async () => {
  __resetApiResourcePressureForTests();
  let insertCalls = 0;
  let releaseFirstWrite!: () => void;
  const firstWriteBlocked = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        throw new Error("unexpected select");
      }) as never,
      update: (() => {
        throw new Error("unexpected update");
      }) as never,
      insert: ((_: unknown) => {
        const call = ++insertCalls;
        return {
          values() {
            return {
              async onConflictDoUpdate() {
                if (call === 1) {
                  await firstWriteBlocked;
                }
              },
            };
          },
        };
      }) as never,
    },
    mode: "market",
    targetSize: 250,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });

  const admissionResults = Array.from({ length: 250 }, (_, index) =>
    manager.recordObservation({ symbol: `ADMIT${index}`, events: [] }),
  );
  await settleRefresh();
  assert.equal(insertCalls, 1);

  admissionResults.push(
    ...Array.from({ length: 2_000 }, () =>
      manager.recordObservation({ symbol: "ADMIT-LATER", events: [] }),
    ),
  );
  let drain: Promise<void> | null = null;
  try {
    assert.equal(
      admissionResults.every((result) => result === undefined),
      true,
      "fire-and-forget admission must not return promises retained by a blocked flush",
    );
    drain = manager.drainObservationPersistence();
    let drained = false;
    void drain.then(() => {
      drained = true;
    });
    await settleRefresh();
    assert.equal(
      drained,
      false,
      "the explicit drain must still await persistence",
    );
  } finally {
    releaseFirstWrite();
  }

  await drain;
  assert.equal(insertCalls, 2);
  assert.equal(manager.getCoverage().observationPersistencePending, 0);
  __resetApiResourcePressureForTests();
});

test("a row-local data error quarantines only the bad symbol", async () => {
  __resetApiResourcePressureForTests();
  const persistedSymbols: string[] = [];
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        throw new Error("unexpected select");
      }) as never,
      update: (() => {
        throw new Error("unexpected update");
      }) as never,
      insert: ((_: unknown) => ({
        values(rows: Array<{ symbol: string }>) {
          return {
            async onConflictDoUpdate() {
              if (rows.some((row) => row.symbol === "BAD-DATA")) {
                throw Object.assign(new Error("numeric value out of range"), {
                  code: "22003",
                });
              }
              persistedSymbols.push(...rows.map((row) => row.symbol));
            },
          };
        },
      })) as never,
    },
    mode: "market",
    targetSize: 250,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });

  for (let index = 0; index < 250; index += 1) {
    manager.recordObservation({
      symbol: index === 125 ? "BAD-DATA" : `ROW${index}`,
      events: [],
    });
  }
  await manager.drainObservationPersistence();

  assert.equal(manager.getCoverage().observationPersistenceStatus, "degraded");
  assert.equal(manager.getCoverage().observationPersistenceQuarantined, 1);
  assert.equal(persistedSymbols.includes("BAD-DATA"), false);
  assert.equal(new Set(persistedSymbols).size, 249);
  __resetApiResourcePressureForTests();
});

test("a JavaScript programming error disables the writer instead of retrying forever", async () => {
  __resetApiResourcePressureForTests();
  let insertCalls = 0;
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        throw new Error("unexpected select");
      }) as never,
      update: (() => {
        throw new Error("unexpected update");
      }) as never,
      insert: ((_: unknown) => {
        insertCalls += 1;
        return {
          values() {
            return {
              async onConflictDoUpdate() {
                throw new TypeError("invalid ranking writer expression");
              },
            };
          },
        };
      }) as never,
    },
    mode: "market",
    targetSize: 250,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });

  for (let index = 0; index < 250; index += 1) {
    manager.recordObservation({ symbol: `PROGRAMMING${index}`, events: [] });
  }
  const settled = manager.drainObservationPersistence();
  await settleRefresh();
  assert.equal(insertCalls, 1);
  assert.equal(manager.getCoverage().observationPersistenceStatus, "terminal");
  await settled;

  updateApiResourcePressure({
    dbPoolActive: 0,
    dbPoolWaiting: 0,
    dbPoolMax: 12,
  });
  await settleRefresh();
  assert.equal(insertCalls, 1);
  __resetApiResourcePressureForTests();
});

test("a known permanent flow persistence error disables the volatile retry treadmill", async () => {
  __resetApiResourcePressureForTests();
  let insertCalls = 0;
  const manager = createFlowUniverseManager({
    db: {
      select: (() => {
        throw new Error("unexpected select");
      }) as never,
      update: (() => {
        throw new Error("unexpected update");
      }) as never,
      insert: ((_: unknown) => {
        insertCalls += 1;
        return {
          values() {
            return {
              async onConflictDoUpdate() {
                throw Object.assign(new Error("ranking table is missing"), {
                  code: "42P01",
                });
              },
            };
          },
        };
      }) as never,
    },
    mode: "market",
    targetSize: 250,
    refreshMs: 15 * 60_000,
    markets: ["stocks"],
    minPrice: 0,
    minDollarVolume: 0,
    fallbackSymbols: [],
  });

  for (let index = 0; index < 250; index += 1) {
    manager.recordObservation({ symbol: `TERMINAL${index}`, events: [] });
  }
  await manager.drainObservationPersistence();
  assert.equal(insertCalls, 1);
  assert.equal(manager.getCoverage().observationPersistenceStatus, "terminal");

  manager.recordObservation({ symbol: "TERMINAL-LATER", events: [] });
  updateApiResourcePressure({
    dbPoolActive: 0,
    dbPoolWaiting: 0,
    dbPoolMax: 12,
  });
  await settleRefresh();
  assert.equal(
    insertCalls,
    1,
    "a schema defect must not retry on every pressure tick",
  );
  assert.equal(manager.getCoverage().observationPersistenceDiscarded, 251);
  __resetApiResourcePressureForTests();
});

for (const code of ["42601", "42804"] as const) {
  test(`PostgreSQL query-shape error ${code} disables flow persistence without row bisection`, async () => {
    __resetApiResourcePressureForTests();
    let insertCalls = 0;
    const manager = createFlowUniverseManager({
      db: {
        select: (() => {
          throw new Error("unexpected select");
        }) as never,
        update: (() => {
          throw new Error("unexpected update");
        }) as never,
        insert: ((_: unknown) => {
          insertCalls += 1;
          return {
            values() {
              return {
                async onConflictDoUpdate() {
                  throw Object.assign(
                    new Error("invalid ranking writer query"),
                    {
                      code,
                    },
                  );
                },
              };
            },
          };
        }) as never,
      },
      mode: "market",
      targetSize: 250,
      refreshMs: 15 * 60_000,
      markets: ["stocks"],
      minPrice: 0,
      minDollarVolume: 0,
      fallbackSymbols: [],
    });

    Array.from({ length: 250 }, (_, index) =>
      manager.recordObservation({ symbol: `QUERY${index}`, events: [] }),
    );
    await manager.drainObservationPersistence();

    assert.equal(insertCalls, 1);
    assert.equal(
      manager.getCoverage().observationPersistenceStatus,
      "terminal",
    );
    assert.equal(manager.getCoverage().observationPersistenceQuarantined, 0);
    assert.equal(manager.getCoverage().observationPersistenceDiscarded, 250);
    __resetApiResourcePressureForTests();
  });
}
