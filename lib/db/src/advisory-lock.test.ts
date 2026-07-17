import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import {
  createAdvisoryLockHolder,
  sharedAdvisoryLockHolder,
} from "./advisory-lock";
import type { AdvisoryLockLease } from "./index";

test("the package entry point exports the advisory lock lease contract", () => {
  const acceptLease = (_lease: AdvisoryLockLease) => undefined;
  assert.equal(typeof acceptLease, "function");
});

/**
 * In-memory stand-in for a single dedicated `pg.Client`. Models a Postgres
 * backend that owns a set of session advisory locks for one connection, so the
 * holder can be exercised without a real database.
 */
function createFakeBackend() {
  // Locks held across ALL live connections for this backend (cross-connection
  // contention, like Postgres). Keyed by lock key -> the connection id holding it.
  const heldByConnection = new Map<number, number>();
  let nextConnectionId = 1;
  let nextFenceToken = 1;
  let connectCount = 0;
  let endCount = 0;

  const createClient = () => {
    const connectionId = nextConnectionId++;
    let connected = false;
    let ended = false;
    const queries: string[] = [];
    const errorListeners = new Set<(error: Error) => void>();

    const client = {
      queries,
      connectionId,
      emitError(error: Error) {
        for (const listener of errorListeners) {
          listener(error);
        }
      },
      async connect() {
        connectCount += 1;
        connected = true;
      },
      async end() {
        endCount += 1;
        ended = true;
        // A dropped connection releases every session lock it held.
        for (const [key, owner] of heldByConnection) {
          if (owner === connectionId) {
            heldByConnection.delete(key);
          }
        }
      },
      async query<Row>(
        sql: string,
        values?: unknown[],
      ): Promise<{ rows: Row[] }> {
        queries.push(sql);
        assert.equal(connected, true, "query before connect");
        assert.equal(ended, false, "query after end");
        const key = Number(values?.[0]);
        if (sql.includes("pg_try_advisory_lock")) {
          const owner = heldByConnection.get(key);
          const locked = owner === undefined || owner === connectionId;
          if (locked) {
            heldByConnection.set(key, connectionId);
          }
          return {
            rows: [
              {
                locked,
                fenceToken: locked ? String(nextFenceToken++) : null,
              } as unknown as Row,
            ],
          };
        }
        if (sql.includes("pg_advisory_unlock")) {
          if (heldByConnection.get(key) === connectionId) {
            heldByConnection.delete(key);
          }
          return { rows: [{ unlocked: true } as unknown as Row] };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
      on(_event: "error", listener: (error: Error) => void) {
        errorListeners.add(listener);
        return client;
      },
      off(_event: "error", listener: (error: Error) => void) {
        errorListeners.delete(listener);
        return client;
      },
    };
    return client;
  };

  return {
    createClient,
    get connectCount() {
      return connectCount;
    },
    get endCount() {
      return endCount;
    },
    heldByConnection,
  };
}

test("acquire takes a session lock and returns a release closure", async () => {
  const backend = createFakeBackend();
  const lastClient: {
    current: ReturnType<typeof backend.createClient> | null;
  } = { current: null };
  const holder = createAdvisoryLockHolder({
    createClient: () => {
      const client = backend.createClient();
      lastClient.current = client;
      return client;
    },
  });

  const release = await holder.acquire(42);
  assert.notEqual(release, null, "first acquire should succeed");
  assert.equal(release?.fenceToken, "1");
  assert.equal(backend.connectCount, 1);

  // The lock path never opens a transaction or uses the xact-scoped variant -
  // confirming it does not hold a pooled connection open in a transaction.
  const queries = lastClient.current!.queries;
  assert.equal(queries.length, 1);
  assert.match(queries[0]!, /pg_try_advisory_lock\(\$1\)/u);
  assert.match(queries[0]!, /txid_current\(\)::text/u);
  assert.equal(
    queries.some((sql) => sql.includes("begin")),
    false,
  );
  assert.equal(
    queries.some((sql) => sql.includes("pg_try_advisory_xact_lock")),
    false,
  );

  await release!();
  assert.equal(
    lastClient.current!.queries.at(-1),
    "select pg_advisory_unlock($1)",
  );

  await holder.close();
});

test("second concurrent acquire of the same key fails, release frees it", async () => {
  const backend = createFakeBackend();
  const holder = createAdvisoryLockHolder({
    createClient: backend.createClient,
  });

  const first = await holder.acquire(7);
  assert.notEqual(first, null);

  // Same key, same single dedicated connection: Postgres treats a re-acquire on
  // the SAME session as re-entrant, so model contention with the cross-process
  // case by using a second holder with a distinct dedicated connection.
  // The product guarantee under test is the cross-process singleton, which our
  // single shared dedicated connection enforces via one backend lock table.
  const secondHolder = createAdvisoryLockHolder({
    createClient: backend.createClient,
  });
  const second = await secondHolder.acquire(7);
  assert.equal(second, null, "another holder must not take a held key");

  await first!();

  const third = await secondHolder.acquire(7);
  assert.notEqual(third, null, "key is acquirable again after release");

  await third!();
  await holder.close();
  await secondHolder.close();
});

test("same holder does not re-acquire a key already held on its session", async () => {
  const backend = createFakeBackend();
  const holder = createAdvisoryLockHolder({
    createClient: backend.createClient,
  });

  const first = await holder.acquire(9);
  assert.notEqual(first, null);

  // Postgres session advisory locks are re-entrant on the same connection. The
  // holder must enforce local singleton semantics before querying Postgres.
  const second = await holder.acquire(9);
  assert.equal(second, null, "same holder must not re-acquire a held key");

  await first!();

  const third = await holder.acquire(9);
  assert.notEqual(third, null, "key is acquirable again after local release");

  await third!();
  await holder.close();
});

test("distinct keys are independent on the shared dedicated connection", async () => {
  const backend = createFakeBackend();
  const holder = createAdvisoryLockHolder({
    createClient: backend.createClient,
  });

  const a = await holder.acquire(100);
  const b = await holder.acquire(200);
  assert.notEqual(a, null);
  assert.notEqual(
    b,
    null,
    "a distinct key is acquirable while another is held",
  );
  // Both keys held on a single dedicated connection (connect once).
  assert.equal(backend.connectCount, 1);

  await a!();
  await b!();
  await holder.close();
});

test("simultaneous distinct-key acquires serialize queries on the dedicated client", async () => {
  let releaseFirstQuery!: () => void;
  const firstQueryReleased = new Promise<void>((resolve) => {
    releaseFirstQuery = resolve;
  });
  let markFirstQueryStarted!: () => void;
  const firstQueryStarted = new Promise<void>((resolve) => {
    markFirstQueryStarted = resolve;
  });
  let inFlightQueries = 0;
  let maxInFlightQueries = 0;
  const client = {
    async connect() {},
    async end() {},
    async query<Row>(sql: string, values?: unknown[]) {
      inFlightQueries += 1;
      maxInFlightQueries = Math.max(maxInFlightQueries, inFlightQueries);
      try {
        if (sql.includes("pg_try_advisory_lock") && values?.[0] === 100) {
          markFirstQueryStarted();
          await firstQueryReleased;
        }
        return {
          rows: [
            (sql.includes("pg_try_advisory_lock")
              ? { locked: true }
              : { unlocked: true }) as Row,
          ],
        };
      } finally {
        inFlightQueries -= 1;
      }
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({ createClient: () => client });

  const first = holder.acquire(100);
  await firstQueryStarted;
  const second = holder.acquire(200);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const inFlightBeforeRelease = maxInFlightQueries;
  releaseFirstQuery();

  const [releaseFirst, releaseSecond] = await Promise.all([first, second]);
  assert.equal(
    inFlightBeforeRelease,
    1,
    "pg.Client must never receive overlapping advisory-lock queries",
  );
  await releaseFirst!();
  await releaseSecond!();
  await holder.close();
});

test("unlock and acquire queries do not overlap on the dedicated client", async () => {
  let releaseUnlockQuery!: () => void;
  const unlockQueryReleased = new Promise<void>((resolve) => {
    releaseUnlockQuery = resolve;
  });
  let markUnlockQueryStarted!: () => void;
  const unlockQueryStarted = new Promise<void>((resolve) => {
    markUnlockQueryStarted = resolve;
  });
  let inFlightQueries = 0;
  let maxInFlightQueries = 0;
  const client = {
    async connect() {},
    async end() {},
    async query<Row>(sql: string, values?: unknown[]) {
      inFlightQueries += 1;
      maxInFlightQueries = Math.max(maxInFlightQueries, inFlightQueries);
      try {
        if (sql.includes("pg_advisory_unlock") && values?.[0] === 100) {
          markUnlockQueryStarted();
          await unlockQueryReleased;
        }
        return {
          rows: [
            (sql.includes("pg_try_advisory_lock")
              ? { locked: true }
              : { unlocked: true }) as Row,
          ],
        };
      } finally {
        inFlightQueries -= 1;
      }
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({ createClient: () => client });
  const releaseFirst = await holder.acquire(100);
  maxInFlightQueries = 0;

  const unlocking = releaseFirst!();
  await unlockQueryStarted;
  const acquiringSecond = holder.acquire(200);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const inFlightBeforeRelease = maxInFlightQueries;
  releaseUnlockQuery();

  const releaseSecond = await acquiringSecond;
  await unlocking;
  assert.equal(
    inFlightBeforeRelease,
    1,
    "unlock and acquire must share the same pg.Client query queue",
  );
  await releaseSecond!();
  await holder.close();
});

test("simultaneous same-key acquires yield only one release closure", async () => {
  const backend = createFakeBackend();
  const holder = createAdvisoryLockHolder({
    createClient: backend.createClient,
  });

  const [first, second] = await Promise.all([
    holder.acquire(300),
    holder.acquire(300),
  ]);
  assert.equal([first, second].filter((release) => release !== null).length, 1);

  await (first ?? second)!();
  await holder.close();
});

test("a dropped lock connection self-heals on the next acquire", async () => {
  const backend = createFakeBackend();
  let last: ReturnType<typeof backend.createClient> | null = null;
  const holder = createAdvisoryLockHolder({
    createClient: () => {
      last = backend.createClient();
      return last;
    },
  });

  const release = await holder.acquire(55);
  assert.notEqual(release, null);
  assert.equal(backend.connectCount, 1);
  const lease = release as typeof release & { signal: AbortSignal };
  assert.equal(
    lease.signal instanceof AbortSignal,
    true,
    "an acquired lock must expose a cancellation signal",
  );
  assert.equal(lease.signal.aborted, false);

  // Simulate the dedicated connection dropping (crash/restart): Postgres
  // auto-releases the session lock; the holder must reconnect and re-acquire.
  last!.emitError(new Error("connection terminated unexpectedly"));
  assert.equal(
    lease.signal.aborted,
    true,
    "session loss must synchronously cancel the stale worker",
  );
  assert.equal(
    backend.heldByConnection.has(55),
    false,
    "drop released the lock",
  );

  const reacquired = await holder.acquire(55);
  assert.notEqual(
    reacquired,
    null,
    "next acquire reconnects and re-takes lock",
  );
  assert.equal(backend.connectCount, 2, "reconnected on a fresh connection");

  // Releasing the stale closure must be a no-op (its connection is gone).
  await release!();
  assert.equal(backend.heldByConnection.get(55), last!.connectionId);

  await reacquired!();
  await holder.close();
});

test("release and close cancel every affected advisory lease", async () => {
  const backend = createFakeBackend();
  const holder = createAdvisoryLockHolder({
    createClient: backend.createClient,
  });

  const released = await holder.acquire(60);
  const closedA = await holder.acquire(61);
  const closedB = await holder.acquire(62);
  assert.notEqual(released, null);
  assert.notEqual(closedA, null);
  assert.notEqual(closedB, null);

  const releasedLease = released as typeof released & { signal: AbortSignal };
  const closedLeaseA = closedA as typeof closedA & { signal: AbortSignal };
  const closedLeaseB = closedB as typeof closedB & { signal: AbortSignal };
  await released!();
  assert.equal(releasedLease.signal.aborted, true);
  assert.equal(closedLeaseA.signal.aborted, false);
  assert.equal(closedLeaseB.signal.aborted, false);

  await holder.close();
  assert.equal(closedLeaseA.signal.aborted, true);
  assert.equal(closedLeaseB.signal.aborted, true);
});

test("a failed connection does not suppress the next acquire for that key", async () => {
  let connectAttempts = 0;
  let endCount = 0;
  const holder = createAdvisoryLockHolder({
    createClient: () => {
      const client = {
        async connect() {
          connectAttempts += 1;
          if (connectAttempts === 1) {
            throw new Error("synthetic connect failure");
          }
        },
        async end() {
          endCount += 1;
        },
        async query<Row>() {
          return { rows: [{ locked: true } as Row] };
        },
        on() {
          return client;
        },
        off() {
          return client;
        },
      };
      return client;
    },
  });

  await assert.rejects(holder.acquire(77), /synthetic connect failure/);
  assert.equal(endCount, 1, "a failed connection attempt must be torn down");
  const release = await holder.acquire(77);

  assert.notEqual(release, null);
  assert.equal(connectAttempts, 2);
  await release!();
  await holder.close();
});

test("a synchronous client factory failure does not poison later acquire", async () => {
  let createAttempts = 0;
  const client = {
    async connect() {},
    async end() {},
    async query<Row>(sql: string) {
      return {
        rows: [
          (sql.includes("pg_try_advisory_lock")
            ? { locked: true }
            : { unlocked: true }) as Row,
        ],
      };
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({
    createClient: () => {
      createAttempts += 1;
      if (createAttempts === 1) {
        throw new Error("synthetic factory failure");
      }
      return client;
    },
  });

  await assert.rejects(holder.acquire(78), /synthetic factory failure/);
  const release = await holder.acquire(78);

  assert.equal(createAttempts, 2);
  assert.notEqual(release, null);
  await release!();
  await holder.close();
});

test("a listener attachment failure is torn down and remains retryable", async () => {
  let createAttempts = 0;
  let endCount = 0;
  const healthyClient = {
    async connect() {},
    async end() {
      endCount += 1;
    },
    async query<Row>(sql: string) {
      return {
        rows: [
          (sql.includes("pg_try_advisory_lock")
            ? { locked: true }
            : { unlocked: true }) as Row,
        ],
      };
    },
    on() {
      return healthyClient;
    },
    off() {
      return healthyClient;
    },
  };
  const holder = createAdvisoryLockHolder({
    createClient: () => {
      createAttempts += 1;
      if (createAttempts > 1) {
        return healthyClient;
      }
      return {
        ...healthyClient,
        on() {
          throw new Error("synthetic listener failure");
        },
      };
    },
  });

  await assert.rejects(holder.acquire(79), /synthetic listener failure/);
  assert.equal(endCount, 1, "the rejected client must be torn down");
  const release = await holder.acquire(79);

  assert.equal(createAttempts, 2);
  assert.notEqual(release, null);
  await release!();
  await holder.close();
});

test("an error during connect invalidates and tears down the candidate", async () => {
  const connectionError = new Error("synthetic connecting-client error");
  let errorListener: ((error: Error) => void) | null = null;
  let endCount = 0;
  const client = {
    async connect() {
      errorListener!(connectionError);
    },
    async end() {
      endCount += 1;
    },
    async query<Row>() {
      return { rows: [{ locked: true } as Row] };
    },
    on(_event: "error", listener: (error: Error) => void) {
      errorListener = listener;
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({ createClient: () => client });

  await assert.rejects(
    holder.acquire(80),
    (error) => error === connectionError,
  );
  assert.equal(endCount, 1);
  await holder.close();
});

test("a stale acquire cannot clear a replacement acquire marker", async () => {
  let rejectOldQuery!: (error: Error) => void;
  let markOldQueryStarted!: () => void;
  const oldQueryStarted = new Promise<void>((resolve) => {
    markOldQueryStarted = resolve;
  });
  const oldErrorListeners = new Set<(error: Error) => void>();
  const oldClient = {
    async connect() {},
    async end() {},
    query<Row>() {
      markOldQueryStarted();
      return new Promise<{ rows: Row[] }>((_resolve, reject) => {
        rejectOldQuery = reject;
      });
    },
    on(_event: "error", listener: (error: Error) => void) {
      oldErrorListeners.add(listener);
      return oldClient;
    },
    off(_event: "error", listener: (error: Error) => void) {
      oldErrorListeners.delete(listener);
      return oldClient;
    },
    emitError(error: Error) {
      for (const listener of oldErrorListeners) listener(error);
    },
  };

  let markReplacementQueryStarted!: () => void;
  const replacementQueryStarted = new Promise<void>((resolve) => {
    markReplacementQueryStarted = resolve;
  });
  let allowReplacementQuery!: () => void;
  const replacementQueryAllowed = new Promise<void>((resolve) => {
    allowReplacementQuery = resolve;
  });
  let replacementAcquireCount = 0;
  let replacementLockCount = 0;
  const replacementClient = {
    async connect() {},
    async end() {
      replacementLockCount = 0;
    },
    async query<Row>(sql: string) {
      if (sql.includes("pg_try_advisory_lock")) {
        replacementAcquireCount += 1;
        if (replacementAcquireCount === 1) {
          markReplacementQueryStarted();
          await replacementQueryAllowed;
        }
        replacementLockCount += 1;
        return { rows: [{ locked: true } as Row] };
      }
      replacementLockCount -= 1;
      return { rows: [{ unlocked: true } as Row] };
    },
    on() {
      return replacementClient;
    },
    off() {
      return replacementClient;
    },
  };

  let clientsCreated = 0;
  const holder = createAdvisoryLockHolder({
    context: "stale-acquire-marker",
    createClient: () =>
      ++clientsCreated === 1 ? oldClient : replacementClient,
  });

  const staleAcquire = holder.acquire(5);
  await oldQueryStarted;
  oldClient.emitError(new Error("old connection dropped"));
  const replacementAcquire = holder.acquire(5);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const replacementStartedBeforeOldSettled = replacementAcquireCount === 1;
  rejectOldQuery(new Error("old query failed"));
  await assert.rejects(staleAcquire, /old query failed/);
  await replacementQueryStarted;
  const overlappingAcquire = holder.acquire(5);
  allowReplacementQuery();

  const [replacementRelease, overlappingRelease] = await Promise.all([
    replacementAcquire,
    overlappingAcquire,
  ]);
  assert.equal(
    [replacementRelease, overlappingRelease].filter(Boolean).length,
    1,
  );
  await replacementRelease?.();
  await overlappingRelease?.();
  assert.equal(replacementAcquireCount, 1);
  assert.equal(replacementLockCount, 0);
  assert.equal(
    replacementStartedBeforeOldSettled,
    true,
    "replacement queries must not wait for an abandoned client generation",
  );
  await holder.close();
});

test("a stale unlock failure does not close the replacement connection", async () => {
  let rejectUnlock!: (error: Error) => void;
  let markUnlockStarted!: () => void;
  const unlockStarted = new Promise<void>((resolve) => {
    markUnlockStarted = resolve;
  });
  const clients: Array<{
    endCount: number;
    emitError: (error: Error) => void;
  }> = [];
  let clientNumber = 0;
  const holder = createAdvisoryLockHolder({
    context: "replacement-race",
    createClient: () => {
      const number = ++clientNumber;
      const errorListeners = new Set<(error: Error) => void>();
      const client = {
        endCount: 0,
        emitError(error: Error) {
          for (const listener of errorListeners) listener(error);
        },
        async connect() {},
        async end() {
          client.endCount += 1;
        },
        query<Row>(sql: string) {
          if (number === 1 && sql.includes("pg_advisory_unlock")) {
            markUnlockStarted();
            return new Promise<{ rows: Row[] }>((_resolve, reject) => {
              rejectUnlock = reject;
            });
          }
          return Promise.resolve({
            rows: [
              (sql.includes("pg_try_advisory_lock")
                ? { locked: true }
                : { unlocked: true }) as Row,
            ],
          });
        },
        on(_event: "error", listener: (error: Error) => void) {
          errorListeners.add(listener);
          return client;
        },
        off(_event: "error", listener: (error: Error) => void) {
          errorListeners.delete(listener);
          return client;
        },
      };
      clients.push(client);
      return client;
    },
  });

  const releaseFirst = await holder.acquire(1);
  const releasingFirst = assert.rejects(releaseFirst!(), /old unlock failed/);
  await unlockStarted;
  clients[0]!.emitError(new Error("old connection dropped"));
  const acquiringReplacement = holder.acquire(2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  rejectUnlock(new Error("old unlock failed"));

  await releasingFirst;
  const releaseReplacement = await acquiringReplacement;
  assert.notEqual(releaseReplacement, null);
  assert.equal(clients[1]!.endCount, 0);

  await releaseReplacement!();
  await holder.close();
});

test("close waits for the dedicated client to finish ending", async () => {
  let resolveEnd!: () => void;
  let endCount = 0;
  const client = {
    async connect() {},
    end() {
      endCount += 1;
      return new Promise<void>((resolve) => {
        resolveEnd = resolve;
      });
    },
    async query<Row>() {
      return { rows: [{ locked: true } as Row] };
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({ createClient: () => client });
  assert.notEqual(await holder.acquire(1), null);

  let closed = false;
  const closing = holder.close().then(() => {
    closed = true;
  });
  const closingAgain = holder.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false, "close must await client.end()");
  assert.equal(endCount, 1);

  resolveEnd();
  await Promise.all([closing, closingAgain]);
  assert.equal(closed, true);
  assert.equal(endCount, 1, "concurrent close calls must end the client once");
});

test("an unlock failure rejects after owning dropped-client teardown", async () => {
  let resolveEnd = () => {};
  let endStarted = false;
  const client = {
    async connect() {},
    end() {
      endStarted = true;
      return new Promise<void>((resolve) => {
        resolveEnd = resolve;
      });
    },
    async query<Row>(sql: string) {
      if (sql.includes("pg_advisory_unlock")) {
        throw new Error("unlock failed");
      }
      return { rows: [{ locked: true } as Row] };
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({ createClient: () => client });
  const release = await holder.acquire(5);
  assert.notEqual(release, null);

  let releaseSettled = false;
  const releasing = assert.rejects(release!(), /unlock failed/).finally(() => {
    releaseSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(endStarted, true);
  assert.equal(releaseSettled, false);

  resolveEnd();
  await releasing;
  assert.equal(releaseSettled, true);
  await holder.close();
});

test("close owns error-triggered detached teardown", async () => {
  let errorListener: ((error: Error) => void) | null = null;
  let resolveEnd = () => {};
  const client = {
    async connect() {},
    end() {
      return new Promise<void>((resolve) => {
        resolveEnd = resolve;
      });
    },
    async query<Row>() {
      return { rows: [{ locked: true } as Row] };
    },
    on(_event: "error", listener: (error: Error) => void) {
      errorListener = listener;
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({ createClient: () => client });
  assert.notEqual(await holder.acquire(6), null);

  errorListener!(new Error("connection dropped"));
  let closed = false;
  const closing = holder.close().then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false);

  resolveEnd();
  await closing;
});

test("close bounds a hung advisory connection teardown", async () => {
  const client = {
    async connect() {},
    end() {
      return new Promise<void>(() => {});
    },
    async query<Row>() {
      return { rows: [{ locked: true } as Row] };
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({
    createClient: () => client,
    teardownTimeoutMs: 10,
  });
  assert.notEqual(await holder.acquire(7), null);

  await assert.rejects(
    Promise.race([
      holder.close(),
      new Promise<void>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("test timed out waiting for bounded close")),
          100,
        );
      }),
    ]),
    /connection teardown timed out/i,
  );
});

test("close drains an in-flight connect and permanently closes the holder", async () => {
  let resolveConnect!: () => void;
  let resolveEnd!: () => void;
  let createCount = 0;
  let endCount = 0;
  const client = {
    connect() {
      return new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });
    },
    end() {
      endCount += 1;
      return new Promise<void>((resolve) => {
        resolveEnd = resolve;
      });
    },
    async query<Row>() {
      return { rows: [{ locked: true } as Row] };
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({
    createClient: () => {
      createCount += 1;
      return client;
    },
  });

  const acquiring = holder.acquire(2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const closing = holder.close();
  resolveConnect();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(endCount, 1);
  resolveEnd();

  await assert.rejects(acquiring, /closed/i);
  await closing;
  await assert.rejects(holder.acquire(3), /closed/i);
  assert.equal(createCount, 1, "closed holder must not create another client");
});

test("close fences an advisory-lock query already in flight", async () => {
  let resolveQuery!: (value: { rows: Array<{ locked: boolean }> }) => void;
  let queryStarted = false;
  let endCount = 0;
  const client = {
    async connect() {},
    async end() {
      endCount += 1;
    },
    query<Row>() {
      queryStarted = true;
      return new Promise<{ rows: Row[] }>((resolve) => {
        resolveQuery = resolve as typeof resolveQuery;
      });
    },
    on() {
      return client;
    },
    off() {
      return client;
    },
  };
  const holder = createAdvisoryLockHolder({ createClient: () => client });

  const acquiring = holder.acquire(4);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(queryStarted, true);
  await holder.close();
  assert.equal(endCount, 1);

  resolveQuery({ rows: [{ locked: true }] });
  await assert.rejects(
    acquiring,
    /closed/i,
    "an acquire must not report success after permanent close",
  );
});

test("default advisory clients have bounded connection attempts", async () => {
  const runtimeEnvKeys = [
    "DATABASE_URL",
    "LOCAL_DATABASE_URL",
    "PGHOST",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGPORT",
    "PGSSLMODE",
    "PGOPTIONS",
    "PYRUS_DATABASE_SOURCE",
    "DB_CONNECTION_TIMEOUT_MS",
    "DB_IDLE_TX_TIMEOUT_MS",
  ] as const;
  const previousEnv = new Map(
    runtimeEnvKeys.map((key) => [key, process.env[key]] as const),
  );
  for (const key of runtimeEnvKeys) {
    delete process.env[key];
  }
  Object.assign(process.env, {
    PGHOST: "helium",
    PGDATABASE: "pyrus_advisory_timeout_test",
    PGUSER: "runner",
    PGPASSWORD: "test-only",
    PGPORT: "5432",
    PGSSLMODE: "require",
    PGOPTIONS: "-c idle_in_transaction_session_timeout=0",
    DB_CONNECTION_TIMEOUT_MS: "0.5",
    DB_IDLE_TX_TIMEOUT_MS: "0.5",
  });

  const clientPrototype = pg.Client.prototype as unknown as {
    connect: (callback?: unknown) => Promise<unknown> | void;
  };
  const originalConnect = clientPrototype.connect;
  const connectionFailure = new Error("network disabled for timeout test");
  let capturedClient: pg.Client | null = null;
  clientPrototype.connect = function (this: pg.Client) {
    capturedClient = this;
    return Promise.reject(connectionFailure);
  };

  try {
    await assert.rejects(
      sharedAdvisoryLockHolder.acquire(1_930_514_099),
      (error) => error === connectionFailure,
    );
    assert.equal(
      (
        capturedClient as unknown as {
          _connectionTimeoutMillis?: number;
        }
      )?._connectionTimeoutMillis,
      30_000,
      "the dedicated Helium lock socket must share the pool connect ceiling",
    );
    assert.equal(
      (
        capturedClient as unknown as {
          connectionParameters?: {
            idle_in_transaction_session_timeout?: number | false;
          };
        }
      )?.connectionParameters?.idle_in_transaction_session_timeout,
      10_000,
      "an invalid sub-millisecond value must not disable the idle transaction ceiling",
    );
    assert.equal(
      (
        capturedClient as unknown as {
          connectionParameters?: { options?: string };
        }
      )?.connectionParameters?.options,
      "-c idle_in_transaction_session_timeout=10000",
      "ambient PGOPTIONS must not override the dedicated socket policy",
    );

    for (const key of runtimeEnvKeys) {
      delete process.env[key];
    }
    process.env.DATABASE_URL =
      "postgres://runner@db.example.invalid/pyrus_advisory_timeout_test";
    capturedClient = null;

    await assert.rejects(
      sharedAdvisoryLockHolder.acquire(1_930_514_100),
      (error) => error === connectionFailure,
    );
    assert.equal(
      (
        capturedClient as unknown as {
          _connectionTimeoutMillis?: number;
        }
      )?._connectionTimeoutMillis,
      30_000,
      "an external dedicated lock socket must retain the connect ceiling",
    );
  } finally {
    clientPrototype.connect = originalConnect;
    await sharedAdvisoryLockHolder.close();
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
