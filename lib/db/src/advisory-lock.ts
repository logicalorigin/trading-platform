import pg from "pg";
import {
  createPostgresConnectionExhaustionGatedClient,
  postgresConnectionExhaustionGate,
} from "./connection-exhaustion-gate";
import { attachPostgresClientErrorHandler } from "./pool-error-handler";
import { resolveDatabaseRuntimeConfig } from "./runtime";

const { Client } = pg;
const ConnectionExhaustionGatedClient =
  createPostgresConnectionExhaustionGatedClient(
    Client,
    postgresConnectionExhaustionGate,
  );

export type AdvisoryLockRelease = () => Promise<void>;

type ClientLike = {
  connect: () => Promise<void>;
  end: () => Promise<void>;
  query: <Row>(
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>;
  on: (event: "error", listener: (error: Error) => void) => unknown;
  off?: (event: "error", listener: (error: Error) => void) => unknown;
  removeListener?: (event: "error", listener: (error: Error) => void) => unknown;
};

type AdvisoryLockHolderOptions = {
  /**
   * Factory for the dedicated lock connection. Defaults to a single `pg.Client`
   * built from the resolved runtime database URL. Injectable for tests so the
   * helper can be exercised without a real Postgres connection.
   */
  createClient?: () => ClientLike;
  context?: string;
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

  let client: ClientLike | null = null;
  let connecting: Promise<ClientLike> | null = null;
  let detachErrorHandler: (() => void) | null = null;
  const heldKeys = new Map<number, ClientLike>();
  const acquiringKeys = new Set<number>();
  let generation = 0;
  let closed = false;
  let closing: Promise<void> | null = null;

  const closedError = () => new Error(`${context} holder is closed.`);

  const detachClient = () => {
    const current = client;
    generation += 1;
    client = null;
    connecting = null;
    heldKeys.clear();
    acquiringKeys.clear();
    detachErrorHandler?.();
    detachErrorHandler = null;
    return current;
  };

  const dropClient = () => {
    const current = detachClient();
    if (current) {
      // Best-effort teardown so a future acquire starts from a clean client.
      // Postgres releases the session's advisory locks once the connection ends.
      void current.end().catch(() => {});
    }
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
    let attempt!: Promise<ClientLike>;
    attempt = (async () => {
      const next = createClient();
      // A dropped lock connection releases all of its session locks. Surface the
      // drop so the next acquire reconnects rather than reusing a dead client.
      detachErrorHandler = attachPostgresClientErrorHandler(next, {
        context,
        onError: () => {
          dropClient();
        },
      });
      try {
        await next.connect();
      } catch (error) {
        detachErrorHandler?.();
        detachErrorHandler = null;
        if (connecting === attempt) {
          connecting = null;
        }
        throw error;
      }
      if (closed || generation !== attemptGeneration) {
        try {
          await next.end();
        } catch (error) {
          throw new AggregateError(
            [error],
            `Failed to close late ${context} connection`,
          );
        }
        throw closedError();
      }
      client = next;
      if (connecting === attempt) {
        connecting = null;
      }
      return next;
    })();
    connecting = attempt;

    return attempt;
  };

  /**
   * Attempt to take the session advisory lock for `key`. Resolves to a release
   * closure when acquired, or `null` when another holder already owns it.
   */
  const acquire = async (key: number): Promise<AdvisoryLockRelease | null> => {
    if (closed) {
      throw closedError();
    }
    if (heldKeys.has(key) || acquiringKeys.has(key)) {
      return null;
    }
    acquiringKeys.add(key);

    let active: ClientLike;
    try {
      active = await getClient();
    } catch (error) {
      // Connection failed: nothing acquired, nothing to release. The next tick
      // retries from a clean state.
      dropClient();
      throw error;
    }
    const acquireGeneration = generation;

    let locked = false;
    try {
      const result = await active.query<{ locked: boolean }>(
        "select pg_try_advisory_lock($1) as locked",
        [key],
      );
      locked = result.rows[0]?.locked === true;
    } catch (error) {
      // A failed acquire query means the lock was not taken. Drop the client so
      // a broken connection self-heals on the next acquire.
      dropClient();
      throw error;
    } finally {
      acquiringKeys.delete(key);
    }

    if (!locked) {
      return null;
    }
    if (
      closed ||
      generation !== acquireGeneration ||
      client !== active
    ) {
      throw closed
        ? closedError()
        : new Error(`${context} connection changed during lock acquisition.`);
    }

    heldKeys.set(key, active);
    let released = false;
    return async () => {
      if (released) {
        return;
      }
      released = true;
      if (heldKeys.get(key) !== active) {
        return;
      }
      // If the connection dropped between acquire and release, Postgres already
      // released the session lock; there is nothing left to unlock.
      if (client !== active) {
        return;
      }
      try {
        await active.query("select pg_advisory_unlock($1)", [key]);
        heldKeys.delete(key);
      } catch {
        // A failed unlock means the connection is unhealthy; drop it so the lock
        // is released by Postgres on disconnect and the next acquire reconnects.
        dropClient();
      }
    };
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
      closing = (async () => {
        const currentEnd = current?.end();
        const pendingEnd = pending?.catch((error) => {
          if (error instanceof AggregateError) {
            throw error;
          }
          // A failed or deliberately closed connect owns no live session.
        });
        await Promise.all([currentEnd, pendingEnd]);
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
  let heliumDatabase = false;
  try {
    heliumDatabase = new URL(config.url).hostname === "helium";
  } catch {
    heliumDatabase = false;
  }
  // A standalone Client (NOT the shared pool) so the lock never consumes one of
  // the 12 pooled connections. `ssl: false` for helium mirrors the shared pool.
  // Duplicates index.ts's DB_IDLE_TX_TIMEOUT_MS read because importing from
  // index.ts here would be circular (index.ts re-exports this module).
  const idleTxTimeoutMs = Number(process.env.DB_IDLE_TX_TIMEOUT_MS);
  return new ConnectionExhaustionGatedClient({
    connectionString: config.url,
    application_name: "pyrus-advisory-lock",
    idle_in_transaction_session_timeout:
      Number.isFinite(idleTxTimeoutMs) && idleTxTimeoutMs > 0
        ? Math.floor(idleTxTimeoutMs)
        : 10_000,
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
