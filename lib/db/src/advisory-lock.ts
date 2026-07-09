import pg from "pg";
import { attachPostgresClientErrorHandler } from "./pool-error-handler";
import { resolveDatabaseRuntimeConfig } from "./runtime";

const { Client } = pg;

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

  const dropClient = () => {
    const current = client;
    client = null;
    connecting = null;
    heldKeys.clear();
    detachErrorHandler?.();
    detachErrorHandler = null;
    if (current) {
      // Best-effort teardown so a future acquire starts from a clean client.
      // Postgres releases the session's advisory locks once the connection ends.
      void current.end().catch(() => {});
    }
  };

  const getClient = async (): Promise<ClientLike> => {
    if (client) {
      return client;
    }
    if (connecting) {
      return connecting;
    }

    connecting = (async () => {
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
        connecting = null;
        throw error;
      }
      client = next;
      connecting = null;
      return next;
    })();

    return connecting;
  };

  /**
   * Attempt to take the session advisory lock for `key`. Resolves to a release
   * closure when acquired, or `null` when another holder already owns it.
   */
  const acquire = async (key: number): Promise<AdvisoryLockRelease | null> => {
    if (heldKeys.has(key)) {
      return null;
    }

    let active: ClientLike;
    try {
      active = await getClient();
    } catch (error) {
      // Connection failed: nothing acquired, nothing to release. The next tick
      // retries from a clean state.
      dropClient();
      throw error;
    }

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
    }

    if (!locked) {
      return null;
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
    async close() {
      dropClient();
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
  return new Client({
    connectionString: config.url,
    application_name: "pyrus-advisory-lock",
    idle_in_transaction_session_timeout:
      Number.isFinite(idleTxTimeoutMs) && idleTxTimeoutMs > 0
        ? Math.floor(idleTxTimeoutMs)
        : 10_000,
    ...(heliumDatabase ? { ssl: false } : {}),
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
