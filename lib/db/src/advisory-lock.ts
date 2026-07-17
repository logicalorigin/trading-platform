import pg from "pg";
import {
  createPostgresConnectionExhaustionGatedClient,
  postgresConnectionExhaustionGate,
} from "./connection-exhaustion-gate";
import { attachPostgresClientErrorHandler } from "./pool-error-handler";
import { parseOptionalPositiveInteger } from "./positive-integer";
import { resolveDatabaseRuntimeConfig } from "./runtime";

const { Client } = pg;
const ConnectionExhaustionGatedClient =
  createPostgresConnectionExhaustionGatedClient(
    Client,
    postgresConnectionExhaustionGate,
  );

export type AdvisoryLockRelease = () => Promise<void>;
export type AdvisoryLockLease = AdvisoryLockRelease & {
  readonly signal: AbortSignal;
  readonly fenceToken?: string;
};

type ClientLike = {
  connect: () => Promise<void>;
  end: () => Promise<void>;
  query: <Row>(sql: string, values?: unknown[]) => Promise<{ rows: Row[] }>;
  on: (event: "error", listener: (error: Error) => void) => unknown;
  off?: (event: "error", listener: (error: Error) => void) => unknown;
  removeListener?: (
    event: "error",
    listener: (error: Error) => void,
  ) => unknown;
};

type AdvisoryLockHolderOptions = {
  /**
   * Factory for the dedicated lock connection. Defaults to a single `pg.Client`
   * built from the resolved runtime database URL. Injectable for tests so the
   * helper can be exercised without a real Postgres connection.
   */
  createClient?: () => ClientLike;
  context?: string;
  teardownTimeoutMs?: number;
};

/**
 * Holds Postgres SESSION-level advisory locks on a single dedicated connection
 * that lives OUTSIDE the shared pool (lib/db/src/index.ts, hard-capped at 12).
 *
 * Background workers previously acquired their singleton "one runner at a time"
 * guard with `pg_try_advisory_xact_lock` on a pooled client and held that
 * client open, idle, in a transaction for the entire maintenance run - pinning
 * scarce shared-pool connections for the duration of broker/IBKR I/O. This
 * holder removes that contention: the lock lives on its own connection, so
 * maintenance work uses the shared pool normally and zero pooled connections
 * are held idle by the lock.
 *
 * Guarantees preserved:
 * - Exactly one holder per key across processes (session advisory lock).
 * - Self-healing: if the dedicated connection drops (crash/restart), Postgres
 *   auto-releases its session locks; the next acquire reconnects and re-takes
 *   the lock.
 */
export function createAdvisoryLockHolder(
  options: AdvisoryLockHolderOptions = {},
) {
  const context = options.context ?? "advisory-lock";
  const createClient =
    options.createClient ?? (() => defaultLockClient(context));
  const teardownTimeoutMs =
    parseOptionalPositiveInteger(
      options.teardownTimeoutMs === undefined
        ? undefined
        : String(options.teardownTimeoutMs),
    ) ??
    parseOptionalPositiveInteger(process.env.DB_CONNECTION_TIMEOUT_MS) ??
    30_000;

  let client: ClientLike | null = null;
  let connecting: Promise<ClientLike> | null = null;
  let detachErrorHandler: (() => void) | null = null;
  const heldKeys = new Map<
    number,
    { client: ClientLike; controller: AbortController }
  >();
  const acquiringKeys = new Map<number, symbol>();
  let generation = 0;
  let closed = false;
  let closing: Promise<void> | null = null;
  let queryTail: Promise<void> = Promise.resolve();
  let detachedTeardown: Promise<void> = Promise.resolve();
  const clientTeardowns = new WeakMap<ClientLike, Promise<void>>();

  const closedError = () => new Error(`${context} holder is closed.`);

  const endClient = async (current: ClientLike): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(
          new Error(
            `${context} connection teardown timed out after ${teardownTimeoutMs}ms.`,
          ),
        );
      }, teardownTimeoutMs);
      timeout.unref?.();
    });
    try {
      await Promise.race([current.end(), timedOut]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  const trackClientTeardown = (current: ClientLike): Promise<void> => {
    const existing = clientTeardowns.get(current);
    if (existing) {
      return existing;
    }
    const ending = endClient(current);
    clientTeardowns.set(current, ending);
    const previous = detachedTeardown;
    detachedTeardown = Promise.allSettled([previous, ending]).then(
      (results) => {
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length === 1) {
          throw errors[0];
        }
        if (errors.length > 1) {
          throw new AggregateError(
            errors,
            `Failed to tear down detached ${context} connections`,
          );
        }
      },
    );
    void detachedTeardown.catch(() => {});
    return ending;
  };

  const detachClient = () => {
    const current = client;
    generation += 1;
    client = null;
    connecting = null;
    // Query serialization is connection-scoped. An unsettled query on the dead
    // generation must not block the replacement client's independent queue.
    queryTail = Promise.resolve();
    for (const lease of heldKeys.values()) {
      lease.controller.abort();
    }
    heldKeys.clear();
    acquiringKeys.clear();
    detachErrorHandler?.();
    detachErrorHandler = null;
    return current;
  };

  const dropClient = (expected: ClientLike): Promise<void> => {
    if (client !== expected) {
      return clientTeardowns.get(expected) ?? Promise.resolve();
    }
    const current = detachClient();
    // Postgres releases the session's advisory locks once the connection ends.
    return current ? trackClientTeardown(current) : Promise.resolve();
  };

  const getClient = async (): Promise<ClientLike> => {
    if (closed) {
      throw closedError();
    }
    if (client) {
      return client;
    }
    if (connecting) {
      return connecting;
    }

    const attemptGeneration = generation;
    const attempt = Promise.resolve().then(async () => {
      const next = createClient();
      let connectingError: Error | null = null;
      try {
        // A dropped lock connection releases all of its session locks. Surface
        // the drop so the next acquire reconnects instead of reusing it.
        detachErrorHandler = attachPostgresClientErrorHandler(next, {
          context,
          onError: (error) => {
            connectingError = error;
            void dropClient(next);
          },
        });
        await next.connect();
        if (connectingError) {
          throw connectingError;
        }
      } catch (error) {
        detachErrorHandler?.();
        detachErrorHandler = null;
        try {
          await trackClientTeardown(next);
        } catch (teardownError) {
          throw new AggregateError(
            [error, teardownError],
            `Failed to clean up ${context} connection attempt`,
            { cause: error },
          );
        }
        throw error;
      }
      if (closed || generation !== attemptGeneration) {
        try {
          await endClient(next);
        } catch (error) {
          throw new AggregateError(
            [error],
            `Failed to close late ${context} connection`,
          );
        }
        throw closedError();
      }
      client = next;
      return next;
    });
    connecting = attempt;

    try {
      return await attempt;
    } finally {
      if (connecting === attempt) {
        connecting = null;
      }
    }
  };

  const runQuery = <Row>(
    active: ClientLike,
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }> => {
    const queryGeneration = generation;
    const result = queryTail.then(() => {
      if (closed) {
        throw closedError();
      }
      if (generation !== queryGeneration || client !== active) {
        throw new Error(`${context} connection changed before lock query.`);
      }
      return active.query<Row>(sql, values);
    });
    queryTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /**
   * Attempt to take the session advisory lock for `key`. Resolves to a release
   * closure when acquired, or `null` when another holder already owns it.
   */
  const acquire = async (key: number): Promise<AdvisoryLockLease | null> => {
    if (closed) {
      throw closedError();
    }
    if (heldKeys.has(key) || acquiringKeys.has(key)) {
      return null;
    }
    const acquisition = Symbol();
    acquiringKeys.set(key, acquisition);
    const finishAcquiring = () => {
      if (acquiringKeys.get(key) === acquisition) {
        acquiringKeys.delete(key);
      }
    };

    let active: ClientLike;
    try {
      active = await getClient();
    } catch (error) {
      // Connection failed: nothing acquired, nothing to release. The next tick
      // retries from a clean state.
      finishAcquiring();
      throw error;
    }
    const acquireGeneration = generation;

    let locked = false;
    let fenceToken: string | undefined;
    try {
      const result = await runQuery<{
        locked: boolean;
        fenceToken?: string | null;
      }>(
        active,
        `with lock_attempt as materialized (
          select pg_try_advisory_lock($1) as locked
        )
        select
          locked,
          case when locked then txid_current()::text else null end as "fenceToken"
        from lock_attempt`,
        [key],
      );
      locked = result.rows[0]?.locked === true;
      const rawFenceToken = result.rows[0]?.fenceToken;
      if (
        rawFenceToken !== undefined &&
        rawFenceToken !== null &&
        !/^[1-9]\d*$/u.test(rawFenceToken)
      ) {
        throw new Error(`${context} returned an invalid fence token.`);
      }
      fenceToken = rawFenceToken ?? undefined;
    } catch (error) {
      // A failed acquire query means the lock was not taken. Drop the client so
      // a broken connection self-heals on the next acquire.
      try {
        await dropClient(active);
      } catch (teardownError) {
        throw new AggregateError(
          [error, teardownError],
          `Failed to clean up ${context} after lock acquisition failed`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      finishAcquiring();
    }

    if (!locked) {
      return null;
    }
    if (closed || generation !== acquireGeneration || client !== active) {
      throw closed
        ? closedError()
        : new Error(`${context} connection changed during lock acquisition.`);
    }

    const controller = new AbortController();
    const held = { client: active, controller };
    heldKeys.set(key, held);
    let released = false;
    const release: AdvisoryLockRelease = async () => {
      if (released) {
        return;
      }
      released = true;
      controller.abort();
      if (heldKeys.get(key) !== held) {
        return;
      }
      // If the connection dropped between acquire and release, Postgres already
      // released the session lock; there is nothing left to unlock.
      if (client !== active) {
        return;
      }
      try {
        await runQuery(active, "select pg_advisory_unlock($1)", [key]);
        if (heldKeys.get(key) === held) {
          heldKeys.delete(key);
        }
      } catch (unlockError) {
        // A failed unlock means the connection is unhealthy; drop it so the lock
        // is released by Postgres on disconnect and the next acquire reconnects.
        try {
          await dropClient(active);
        } catch (teardownError) {
          throw new AggregateError(
            [unlockError, teardownError],
            `Failed to release ${context} lock`,
            { cause: unlockError },
          );
        }
        throw unlockError;
      }
    };
    return Object.assign(release, {
      signal: controller.signal,
      ...(fenceToken ? { fenceToken } : {}),
    });
  };

  return {
    acquire,
    /** Tear down the dedicated connection (releases all held session locks). */
    close() {
      if (closing) {
        return closing;
      }
      closed = true;
      const pending = connecting;
      const current = detachClient();
      if (current) {
        trackClientTeardown(current);
      }
      closing = (async () => {
        const pendingEnd = pending?.catch((error) => {
          if (error instanceof AggregateError) {
            throw error;
          }
          // A failed or deliberately closed connect owns no live session.
        });
        const results = await Promise.allSettled([
          detachedTeardown,
          pendingEnd,
        ]);
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (errors.length === 1) {
          throw errors[0];
        }
        if (errors.length > 1) {
          throw new AggregateError(errors, `Failed to close ${context} holder`);
        }
      })();
      return closing;
    },
  };
}

function defaultLockClient(context: string): ClientLike {
  const config = resolveDatabaseRuntimeConfig();
  if (!config.url) {
    throw new Error(
      `Database connection env must be set to acquire the ${context}.`,
    );
  }
  const heliumDatabase = config.source === "replit-internal-dev-db";
  // A standalone Client (NOT the shared pool) so the lock never consumes one of
  // the 12 pooled connections. `ssl: false` for helium mirrors the shared pool.
  // Duplicates index.ts's timeout reads because importing from index.ts here
  // would be circular (index.ts re-exports this module).
  const idleTxTimeoutMs = parseOptionalPositiveInteger(
    process.env.DB_IDLE_TX_TIMEOUT_MS,
  );
  const resolvedIdleTxTimeoutMs = idleTxTimeoutMs ?? 10_000;
  const configuredConnectionTimeoutMs = parseOptionalPositiveInteger(
    process.env.DB_CONNECTION_TIMEOUT_MS,
  );
  const connectionTimeoutMillis = configuredConnectionTimeoutMs ?? 30_000;
  return new ConnectionExhaustionGatedClient({
    connectionString: config.url,
    application_name: "pyrus-advisory-lock",
    connectionTimeoutMillis,
    idle_in_transaction_session_timeout: resolvedIdleTxTimeoutMs,
    options: `-c idle_in_transaction_session_timeout=${resolvedIdleTxTimeoutMs}`,
    ...(heliumDatabase
      ? {
          ssl: false,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
        }
      : {}),
  }) as unknown as ClientLike;
}

/**
 * Process-wide dedicated lock holder shared by all background workers. Each
 * worker passes a distinct advisory-lock key, so a single dedicated connection
 * guards every worker's singleton without touching the shared pool.
 */
export const sharedAdvisoryLockHolder = createAdvisoryLockHolder({
  context: "background-worker-advisory-lock",
});
