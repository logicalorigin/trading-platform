import {
  isPoolContentionError,
  isTransientPostgresError,
  summarizeTransientPostgresError,
  type TransientPostgresErrorSummary,
} from "../lib/transient-db-error";

export type SignalMonitorDbFallbackDiagnostics = {
  observedAt: string;
  operation: string;
  environment: string | null;
  sourceStatus: string | null;
  transient: boolean;
  poolContention: boolean;
  dbError: TransientPostgresErrorSummary;
};

let lastSignalMonitorDbFallback: SignalMonitorDbFallbackDiagnostics | null = null;

export function recordSignalMonitorDbFallback(
  error: unknown,
  input: {
    operation?: string | null;
    environment?: string | null;
    sourceStatus?: string | null;
    observedAt?: Date;
  } = {},
): SignalMonitorDbFallbackDiagnostics {
  const diagnostic: SignalMonitorDbFallbackDiagnostics = {
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    operation: input.operation || "unknown",
    environment: input.environment || null,
    sourceStatus: input.sourceStatus || null,
    transient: isTransientPostgresError(error),
    poolContention: isPoolContentionError(error),
    dbError: summarizeTransientPostgresError(error),
  };
  lastSignalMonitorDbFallback = diagnostic;
  return diagnostic;
}

export function getSignalMonitorDbFallbackDiagnostics():
  | SignalMonitorDbFallbackDiagnostics
  | null {
  return lastSignalMonitorDbFallback
    ? {
        ...lastSignalMonitorDbFallback,
        dbError: { ...lastSignalMonitorDbFallback.dbError },
      }
    : null;
}

export function resetSignalMonitorDbFallbackDiagnosticsForTests(): void {
  lastSignalMonitorDbFallback = null;
}
