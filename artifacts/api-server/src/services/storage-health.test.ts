import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";

const priorDatabaseUrl = process.env["DATABASE_URL"];
const priorDatabaseSource = process.env["PYRUS_DATABASE_SOURCE"];
process.env["DATABASE_URL"] = "postgres://u:p@localhost:5432/testdb";
process.env["PYRUS_DATABASE_SOURCE"] = "database_url";

const [{ pool }, storageHealth] = await Promise.all([
  import("@workspace/db"),
  import("./storage-health"),
]);
const {
  __resetStorageHealthForTests,
  __setStorageHealthProbeForTests,
  getCachedStorageHealthSnapshot,
  markStorageHealthDegraded,
  refreshStorageHealthSnapshot,
} = storageHealth;

after(() => {
  if (priorDatabaseUrl === undefined) {
    delete process.env["DATABASE_URL"];
  } else {
    process.env["DATABASE_URL"] = priorDatabaseUrl;
  }
  if (priorDatabaseSource === undefined) {
    delete process.env["PYRUS_DATABASE_SOURCE"];
  } else {
    process.env["PYRUS_DATABASE_SOURCE"] = priorDatabaseSource;
  }
});

afterEach(() => {
  __resetStorageHealthForTests();
});

test("refreshStorageHealthSnapshot decomposes probe timing into laneWait/acquire/exec", async () => {
  __resetStorageHealthForTests();
  __setStorageHealthProbeForTests(async () => ({
    laneWaitMs: 5,
    acquireMs: 7,
    execMs: 11,
  }));

  const snapshot = await refreshStorageHealthSnapshot();

  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.laneWaitMs, 5);
  assert.equal(snapshot.acquireMs, 7);
  assert.equal(snapshot.execMs, 11);
  // pingMs stays the end-to-end total for backward compatibility.
  assert.equal(typeof snapshot.pingMs, "number");
});

test("a timing-less probe leaves components null but still records total pingMs", async () => {
  __resetStorageHealthForTests();
  __setStorageHealthProbeForTests(async () => {});

  const snapshot = await refreshStorageHealthSnapshot();

  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.laneWaitMs, null);
  assert.equal(snapshot.acquireMs, null);
  assert.equal(snapshot.execMs, null);
  assert.equal(typeof snapshot.pingMs, "number");
});

test("a failed probe reports total pingMs with null components", async () => {
  __resetStorageHealthForTests();
  __setStorageHealthProbeForTests(async () => {
    throw new Error("boom");
  });

  const snapshot = await refreshStorageHealthSnapshot();

  assert.equal(snapshot.reachable, false);
  assert.equal(snapshot.laneWaitMs, null);
  assert.equal(snapshot.acquireMs, null);
  assert.equal(snapshot.execMs, null);
  assert.equal(typeof snapshot.pingMs, "number");
});

test("storage health does not echo credential-bearing database errors", async () => {
  const secret = "storage-health-error-secret";
  const error = new Error(
    `connect failed for postgres://alice:${secret}@fallback.invalid/pyrus`,
  );
  __setStorageHealthProbeForTests(async () => {
    throw error;
  });

  const unavailable = await refreshStorageHealthSnapshot();
  assert.equal(unavailable.error, "Database operation failed");
  assert.equal(unavailable.dbError?.message, "Database operation failed");
  assert.equal(JSON.stringify(unavailable).includes(secret), false);

  const degraded = markStorageHealthDegraded("test_degraded", error);
  assert.equal(degraded.error, "Database operation failed");
  assert.equal(degraded.dbError?.message, "Database operation failed");
  assert.equal(JSON.stringify(degraded).includes(secret), false);
});

test("concurrent storage health refreshes share one probe", async () => {
  let probeCount = 0;
  let finishProbe = () => {};
  const blocked = new Promise<void>((resolve) => {
    finishProbe = resolve;
  });
  __setStorageHealthProbeForTests(async () => {
    probeCount += 1;
    await blocked;
  });

  const first = refreshStorageHealthSnapshot();
  const second = refreshStorageHealthSnapshot();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(probeCount, 1);

  finishProbe();
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
  assert.equal(firstSnapshot, secondSnapshot);
});

test("concurrent failed storage health refreshes share one probe", async () => {
  const failure = new Error("shared probe failure");
  let probeCount = 0;
  let finishProbe = () => {};
  const blocked = new Promise<void>((resolve) => {
    finishProbe = resolve;
  });
  __setStorageHealthProbeForTests(async () => {
    probeCount += 1;
    await blocked;
    throw failure;
  });

  const first = refreshStorageHealthSnapshot();
  const second = refreshStorageHealthSnapshot();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(probeCount, 1);

  finishProbe();
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
  assert.equal(firstSnapshot, secondSnapshot);
  assert.equal(firstSnapshot.error, "Database operation failed");
});

test("reset fences an older in-flight probe from the new cache", async () => {
  let finishFirst = () => {};
  const firstBlocked = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  __setStorageHealthProbeForTests(async () => {
    await firstBlocked;
    return { laneWaitMs: 1, acquireMs: 1, execMs: 1 };
  });

  const first = refreshStorageHealthSnapshot();
  await new Promise<void>((resolve) => setImmediate(resolve));
  __resetStorageHealthForTests();
  __setStorageHealthProbeForTests(async () => ({
    laneWaitMs: 2,
    acquireMs: 2,
    execMs: 2,
  }));
  const secondSnapshot = await refreshStorageHealthSnapshot();

  finishFirst();
  await first;

  assert.equal(getCachedStorageHealthSnapshot(), secondSnapshot);
  assert.equal(getCachedStorageHealthSnapshot().laneWaitMs, 2);
});

test("the default probe reports combined acquire time without a false lane split", async () => {
  const mutablePool = pool as unknown as { connect: typeof pool.connect };
  const originalConnect = mutablePool.connect;
  mutablePool.connect = (async () => ({
    async query(sql: string) {
      return {
        rows: sql.startsWith("select value") ? [{ value: "ok" }] : [],
      };
    },
    release() {},
  })) as typeof pool.connect;

  try {
    const snapshot = await refreshStorageHealthSnapshot();
    assert.equal(snapshot.laneWaitMs, null);
    assert.equal(Number.isFinite(snapshot.acquireMs), true);
    assert.equal(Number.isFinite(snapshot.execMs), true);
  } finally {
    mutablePool.connect = originalConnect;
  }
});

test("a failed rollback discards the probe client", async () => {
  const primaryFailure = new Error("primary probe failure");
  const rollbackFailure = new Error("rollback failure");
  let releaseError: unknown;
  const mutablePool = pool as unknown as { connect: typeof pool.connect };
  const originalConnect = mutablePool.connect;
  mutablePool.connect = (async () => ({
    async query(sql: string) {
      if (sql === "rollback") {
        throw rollbackFailure;
      }
      if (sql.startsWith("select value")) {
        throw primaryFailure;
      }
      return { rows: [] };
    },
    release(error?: unknown) {
      releaseError = error;
    },
  })) as typeof pool.connect;

  try {
    const snapshot = await refreshStorageHealthSnapshot();
    assert.equal(releaseError, rollbackFailure);
    assert.equal(snapshot.error, "Database operation failed");
    assert.equal(snapshot.dbError?.cause?.message, "Database operation failed");
  } finally {
    mutablePool.connect = originalConnect;
  }
});

test("a fractional probe interval falls back instead of disabling caching", async () => {
  const previousInterval = process.env["STORAGE_HEALTH_PROBE_INTERVAL_MS"];
  const mutablePool = pool as unknown as { connect: typeof pool.connect };
  const originalConnect = mutablePool.connect;
  let connectCount = 0;
  mutablePool.connect = (async () => {
    connectCount += 1;
    return {
      async query(sql: string) {
        return {
          rows: sql.startsWith("select value") ? [{ value: "ok" }] : [],
        };
      },
      release() {},
    };
  }) as typeof pool.connect;
  process.env["STORAGE_HEALTH_PROBE_INTERVAL_MS"] = "0.5";

  try {
    await refreshStorageHealthSnapshot();
    await refreshStorageHealthSnapshot();
    assert.equal(connectCount, 1);
  } finally {
    mutablePool.connect = originalConnect;
    if (previousInterval === undefined) {
      delete process.env["STORAGE_HEALTH_PROBE_INTERVAL_MS"];
    } else {
      process.env["STORAGE_HEALTH_PROBE_INTERVAL_MS"] = previousInterval;
    }
  }
});
