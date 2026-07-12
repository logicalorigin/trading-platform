type ConnectionExhaustionGateOptions = {
  backoffMs?: number;
  now?: () => number;
};

type PhysicalConnectionCallback<TClient> = (
  error: Error | null,
  client?: TClient,
) => void;

type PhysicalPostgresClient = {
  connect(): Promise<unknown>;
};

type PhysicalPostgresClientConstructor = new (
  ...args: any[]
) => PhysicalPostgresClient;

const DEFAULT_BACKOFF_MS = 5_000;

function isConnectionExhausted(error: unknown, depth = 0): boolean {
  if (!error || depth > 6 || typeof error !== "object") {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    record["code"] === "53300" ||
    isConnectionExhausted(record["cause"], depth + 1)
  );
}

/**
 * Stops a full Postgres server from turning every queued query into another
 * connection attempt. After SQLSTATE 53300, one caller probes recovery when the
 * cooldown expires; all other callers fail fast until that probe succeeds.
 */
export function createPostgresConnectionExhaustionGate(
  options: ConnectionExhaustionGateOptions = {},
) {
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const now = options.now ?? Date.now;
  let retryAtMs = 0;
  let lastError: unknown = null;
  let probeInFlight = false;

  return {
    async connect<T>(open: () => Promise<T>): Promise<T> {
      const halfOpen = lastError !== null;
      if (halfOpen && (now() < retryAtMs || probeInFlight)) {
        throw lastError;
      }
      if (halfOpen) {
        probeInFlight = true;
      }

      try {
        const connection = await open();
        if (halfOpen) {
          lastError = null;
          retryAtMs = 0;
        }
        return connection;
      } catch (error) {
        if (isConnectionExhausted(error)) {
          lastError = error;
          retryAtMs = now() + backoffMs;
        } else if (halfOpen) {
          lastError = null;
          retryAtMs = 0;
        }
        throw error;
      } finally {
        if (halfOpen) {
          probeInFlight = false;
        }
      }
    },
  };
}

/** Shared by every process-owned Postgres socket, including advisory locks. */
export const postgresConnectionExhaustionGate =
  createPostgresConnectionExhaustionGate();

/** Gates only new sockets; pg.Pool can still serve already-idle clients. */
export function createPostgresConnectionExhaustionGatedClient<
  TBase extends PhysicalPostgresClientConstructor,
>(
  BaseClient: TBase,
  gate = createPostgresConnectionExhaustionGate(),
): TBase {
  class GatedPostgresClient extends BaseClient {
    connect(): Promise<this>;
    connect(callback: PhysicalConnectionCallback<this>): void;
    connect(
      callback?: PhysicalConnectionCallback<this>,
    ): Promise<this> | void {
      const connection = gate.connect(async () => {
        await super.connect();
        return this;
      });
      if (!callback) {
        return connection;
      }
      void connection.then(
        (client) => callback(null, client),
        (error: unknown) =>
          callback(
            error instanceof Error ? error : new Error(String(error)),
          ),
      );
    }
  }

  return GatedPostgresClient as TBase;
}
