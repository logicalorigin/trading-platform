const TRANSIENT_POSTGRES_CODES = new Set([
  "08000",
  "08003",
  "08006",
  "08001",
  "08004",
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

const TRANSIENT_POSTGRES_MESSAGE_PATTERNS = [
  /connection terminated due to connection timeout/i,
  /connection terminated unexpectedly/i,
  /pool timed out while waiting for an open connection/i,
  /timeout exceeded when trying to connect/i,
  /terminating connection/i,
  /could not connect to server/i,
  /no response/i,
];

// Pool-acquire timeouts mean "all pooled connections are busy right now", not
// "the database is down". These are a subset of the transient patterns above and
// are classified separately so callers can choose to back off only on genuine
// connectivity failures rather than on local pool saturation.
const POOL_CONTENTION_MESSAGE_PATTERNS = [
  /pool timed out while waiting for an open connection/i,
  /timeout exceeded when trying to connect/i,
];

export const TRANSIENT_POSTGRES_BACKOFF_MS = 60_000;

type WarnLogger = {
  warn: (payload: unknown, message: string) => void;
};

export type TransientPostgresErrorSummary = {
  name: string | null;
  message: string;
  code: string | null;
  cause?: TransientPostgresErrorSummary;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

function textFromError(value: unknown): string {
  if (value instanceof Error) {
    return [value.name, value.message, value.stack].filter(Boolean).join("\n");
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

export function isTransientPostgresError(error: unknown, depth = 0): boolean {
  if (!error || depth > 6) {
    return false;
  }

  const record = asRecord(error);
  const code = record["code"] ?? record["errno"];
  if (typeof code === "string" && TRANSIENT_POSTGRES_CODES.has(code)) {
    return true;
  }

  const text = textFromError(error);
  if (
    text &&
    TRANSIENT_POSTGRES_MESSAGE_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return true;
  }

  return isTransientPostgresError(record["cause"], depth + 1);
}

export function isPoolContentionError(error: unknown, depth = 0): boolean {
  if (!error || depth > 6) {
    return false;
  }

  const text = textFromError(error);
  if (
    text &&
    POOL_CONTENTION_MESSAGE_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return true;
  }

  return isPoolContentionError(asRecord(error)["cause"], depth + 1);
}

// Server-side statement_timeout cancellations (SQLSTATE 57014, message
// "canceling statement due to statement timeout"). Under the 12-connection pool
// cap, a read that trips the 15s statement_timeout means "this query exceeded
// its server-side budget because the DB is under local load" — the same
// transient-load condition as a pool-acquire timeout, NOT a query/data defect.
// Kept SEPARATE from isTransientPostgresError (deliberately NOT folded into it)
// so only callers that can safely serve degraded/last-known coverage opt in;
// financial read/write paths must keep treating a timeout as a hard error rather
// than silently returning empty/stale data.
const STATEMENT_TIMEOUT_MESSAGE_PATTERN =
  /canceling statement due to statement timeout/i;

export function isStatementTimeoutError(error: unknown, depth = 0): boolean {
  if (!error || depth > 6) {
    return false;
  }

  const record = asRecord(error);
  const code = record["code"] ?? record["errno"];
  if (code === "57014") {
    return true;
  }

  const text = textFromError(error);
  if (text && STATEMENT_TIMEOUT_MESSAGE_PATTERN.test(text)) {
    return true;
  }

  return isStatementTimeoutError(record["cause"], depth + 1);
}

export function summarizeTransientPostgresError(
  error: unknown,
  depth = 0,
): TransientPostgresErrorSummary {
  const record = asRecord(error);
  const code = record["code"] ?? record["errno"];
  const cause = record["cause"];
  const summary = {
    name: error instanceof Error ? error.name : null,
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown database error",
    code: typeof code === "string" ? code : null,
  };

  if (cause && depth < 3) {
    return {
      ...summary,
      cause: summarizeTransientPostgresError(cause, depth + 1),
    };
  }

  return summary;
}

export function createTransientPostgresBackoff(
  options: {
    backoffMs?: number;
    warningCooldownMs?: number;
  } = {},
) {
  const backoffMs = options.backoffMs ?? TRANSIENT_POSTGRES_BACKOFF_MS;
  const warningCooldownMs = options.warningCooldownMs ?? backoffMs;
  let failedUntilMs = 0;
  let lastWarningAtMs = Number.NEGATIVE_INFINITY;

  return {
    isActive(nowMs: number): boolean {
      return failedUntilMs > nowMs;
    },
    clear(): void {
      failedUntilMs = 0;
    },
    markFailure(input: {
      error: unknown;
      logger: WarnLogger;
      message: string;
      nowMs: number;
    }): void {
      failedUntilMs = input.nowMs + backoffMs;
      if (input.nowMs - lastWarningAtMs < warningCooldownMs) {
        return;
      }
      lastWarningAtMs = input.nowMs;
      input.logger.warn(
        {
          dbError: summarizeTransientPostgresError(input.error),
          retryAfterMs: backoffMs,
        },
        input.message,
      );
    },
    resetForTest(): void {
      failedUntilMs = 0;
      lastWarningAtMs = Number.NEGATIVE_INFINITY;
    },
    snapshot() {
      return { failedUntilMs, lastWarningAtMs };
    },
  };
}
