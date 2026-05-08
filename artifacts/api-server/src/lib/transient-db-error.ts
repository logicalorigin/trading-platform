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
  /timeout exceeded when trying to connect/i,
  /terminating connection/i,
  /could not connect to server/i,
  /no response/i,
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
  if (text && TRANSIENT_POSTGRES_MESSAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return isTransientPostgresError(record["cause"], depth + 1);
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

export function createTransientPostgresBackoff(options: {
  backoffMs?: number;
  warningCooldownMs?: number;
} = {}) {
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
