import assert from "node:assert/strict";
import { test } from "node:test";
import { createAdvisoryLockHolder } from "./advisory-lock";

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
      async query<Row>(sql: string, values?: unknown[]): Promise<{ rows: Row[] }> {
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
          return { rows: [{ locked } as unknown as Row] };
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
  const lastClient: { current: ReturnType<typeof backend.createClient> | null } =
    { current: null };
  const holder = createAdvisoryLockHolder({
    createClient: () => {
      const client = backend.createClient();
      lastClient.current = client;
      return client;
    },
  });

  const release = await holder.acquire(42);
  assert.notEqual(release, null, "first acquire should succeed");
  assert.equal(backend.connectCount, 1);

  // The lock path never opens a transaction or uses the xact-scoped variant -
  // confirming it does not hold a pooled connection open in a transaction.
  const queries = lastClient.current!.queries;
  assert.deepEqual(queries, ["select pg_try_advisory_lock($1) as locked"]);
  assert.equal(
    queries.some((sql) => sql.includes("begin")),
    false,
  );
  assert.equal(
    queries.some((sql) => sql.includes("pg_try_advisory_xact_lock")),
    false,
  );

  await release!();
  assert.equal(lastClient.current!.queries.at(-1), "select pg_advisory_unlock($1)");

  await holder.close();
});

test("second concurrent acquire of the same key fails, release frees it", async () => {
  const backend = createFakeBackend();
  const holder = createAdvisoryLockHolder({ createClient: backend.createClient });

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
  const holder = createAdvisoryLockHolder({ createClient: backend.createClient });

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
  const holder = createAdvisoryLockHolder({ createClient: backend.createClient });

  const a = await holder.acquire(100);
  const b = await holder.acquire(200);
  assert.notEqual(a, null);
  assert.notEqual(b, null, "a distinct key is acquirable while another is held");
  // Both keys held on a single dedicated connection (connect once).
  assert.equal(backend.connectCount, 1);

  await a!();
  await b!();
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

  // Simulate the dedicated connection dropping (crash/restart): Postgres
  // auto-releases the session lock; the holder must reconnect and re-acquire.
  last!.emitError(new Error("connection terminated unexpectedly"));
  assert.equal(backend.heldByConnection.has(55), false, "drop released the lock");

  const reacquired = await holder.acquire(55);
  assert.notEqual(reacquired, null, "next acquire reconnects and re-takes lock");
  assert.equal(backend.connectCount, 2, "reconnected on a fresh connection");

  // Releasing the stale closure must be a no-op (its connection is gone).
  await release!();
  assert.equal(backend.heldByConnection.get(55), last!.connectionId);

  await reacquired!();
  await holder.close();
});
