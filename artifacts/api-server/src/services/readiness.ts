import type {
  DiagnosticSnapshotPayload,
  DiagnosticsLatestPayload,
} from "./diagnostics";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureSnapshot,
} from "./resource-pressure";

type JsonRecord = Record<string, unknown>;

export type ApiReadinessPayload = {
  generatedAt: string;
  liveness: {
    status: "ok";
  };
  appReadiness: {
    status: "ready" | "degraded" | "not_ready" | "unknown";
    reason: string | null;
    diagnosticsStatus: DiagnosticsLatestPayload["status"] | "unknown";
    diagnosticsSeverity: DiagnosticsLatestPayload["severity"] | "info";
  };
  brokerTradingReadiness: {
    status: "ready" | "blocked" | "unknown";
    ready: boolean;
    reason: string | null;
    checks: {
      configured: boolean | null;
      reachable: boolean | null;
      connected: boolean | null;
      authenticated: boolean | null;
      competing: boolean | null;
      healthFresh: boolean | null;
      streamFresh: boolean | null;
      strictReady: boolean | null;
    };
  };
  pressureLevel: ApiResourcePressureSnapshot["level"];
  degradedReasons: string[];
  manualTradingBlockedReason: string | null;
};

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const boolOrNull = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const findSnapshot = (
  diagnostics: DiagnosticsLatestPayload | null,
  subsystem: DiagnosticSnapshotPayload["subsystem"],
) =>
  diagnostics?.snapshots.find((snapshot) => snapshot.subsystem === subsystem) ??
  null;

function buildBrokerReadiness(
  diagnostics: DiagnosticsLatestPayload | null,
  brokerRuntime?: unknown,
): ApiReadinessPayload["brokerTradingReadiness"] {
  const ibkr = findSnapshot(diagnostics, "ibkr");
  if (!ibkr && brokerRuntime === undefined) {
    return {
      status: "unknown",
      ready: false,
      reason: "broker_diagnostics_unavailable",
      checks: {
        configured: null,
        reachable: null,
        connected: null,
        authenticated: null,
        competing: null,
        healthFresh: null,
        streamFresh: null,
        strictReady: null,
      },
    };
  }

  const metrics = asRecord(ibkr?.metrics);
  const runtimeMetrics =
    brokerRuntime === undefined
      ? null
      : brokerRuntime === null
        ? {
            configured: false,
            reachable: false,
            connected: false,
            authenticated: false,
            competing: false,
            healthFresh: false,
            streamFresh: false,
            strictReady: false,
          }
        : asRecord(brokerRuntime);
  const rawChecks = {
    configured:
      boolOrNull(runtimeMetrics?.["configured"]) ??
      boolOrNull(metrics["configured"]),
    reachable:
      boolOrNull(runtimeMetrics?.["reachable"]) ??
      boolOrNull(metrics["reachable"]),
    connected:
      boolOrNull(runtimeMetrics?.["connected"]) ??
      boolOrNull(metrics["connected"]),
    authenticated:
      boolOrNull(runtimeMetrics?.["authenticated"]) ??
      boolOrNull(metrics["authenticated"]),
    competing:
      boolOrNull(runtimeMetrics?.["competing"]) ??
      boolOrNull(metrics["competing"]),
    healthFresh:
      boolOrNull(runtimeMetrics?.["healthFresh"]) ??
      boolOrNull(metrics["healthFresh"]),
    streamFresh:
      boolOrNull(runtimeMetrics?.["streamFresh"]) ??
      boolOrNull(metrics["streamFresh"]),
    strictReady:
      boolOrNull(runtimeMetrics?.["strictReady"]) ??
      boolOrNull(metrics["strictReady"]),
  };
  const checks =
    rawChecks.configured === false
      ? {
          configured: false,
          reachable: false,
          connected: false,
          authenticated: false,
          competing: false,
          healthFresh: false,
          streamFresh: false,
          strictReady: false,
        }
      : rawChecks;
  const strictReason =
    textOrNull(runtimeMetrics?.["strictReason"]) ??
    textOrNull(metrics["strictReason"]);
  const reason =
    checks.configured === false
      ? "broker_not_configured"
      : checks.reachable === false
        ? "broker_unreachable"
        : checks.connected === false
          ? "gateway_disconnected"
          : checks.authenticated === false
            ? "gateway_login_required"
            : checks.competing === true
              ? "competing_broker_session"
              : checks.strictReady === false
                ? strictReason ?? "gateway_not_ready"
                : checks.streamFresh === false
                  ? "broker_stream_stale"
                  : checks.healthFresh === false
                    ? "broker_health_stale"
                    : null;

  return {
    status: reason ? "blocked" : "ready",
    ready: !reason,
    reason,
    checks,
  };
}
function buildAppReadiness(input: {
  diagnostics: DiagnosticsLatestPayload | null;
  pressure: ApiResourcePressureSnapshot;
}): ApiReadinessPayload["appReadiness"] {
  if (!input.diagnostics) {
    return {
      status: "unknown",
      reason: "diagnostics_unavailable",
      diagnosticsStatus: "unknown",
      diagnosticsSeverity: "info",
    };
  }

  if (input.diagnostics.status === "down") {
    return {
      status: "degraded",
      reason: "diagnostics_down",
      diagnosticsStatus: input.diagnostics.status,
      diagnosticsSeverity: input.diagnostics.severity,
    };
  }

  if (input.pressure.level === "high") {
    return {
      status: "degraded",
      reason: "api_resource_pressure_high",
      diagnosticsStatus: input.diagnostics.status,
      diagnosticsSeverity: input.diagnostics.severity,
    };
  }

  return {
    status: "ready",
    reason: null,
    diagnosticsStatus: input.diagnostics.status,
    diagnosticsSeverity: input.diagnostics.severity,
  };
}

function degradedReasons(input: {
  diagnostics: DiagnosticsLatestPayload | null;
  pressure: ApiResourcePressureSnapshot;
  appReadiness: ApiReadinessPayload["appReadiness"];
  brokerReadiness: ApiReadinessPayload["brokerTradingReadiness"];
}) {
  const reasons = new Set<string>();
  if (input.appReadiness.reason) {
    reasons.add(input.appReadiness.reason);
  }
  if (input.brokerReadiness.reason) {
    reasons.add(input.brokerReadiness.reason);
  }
  input.pressure.drivers.slice(0, 4).forEach((driver) => {
    reasons.add(
      driver.detail
        ? `${driver.kind}:${driver.level}:${driver.detail}`
        : `${driver.kind}:${driver.level}`,
    );
  });
  input.diagnostics?.events
    .filter((event) => event.status === "open")
    .slice(0, 4)
    .forEach((event) => reasons.add(event.code ?? event.category));
  return Array.from(reasons);
}

export function buildApiReadinessPayload(input: {
  brokerRuntime?: unknown;
  diagnostics: DiagnosticsLatestPayload | null;
  pressure?: ApiResourcePressureSnapshot;
  now?: Date;
}): ApiReadinessPayload {
  const pressure = input.pressure ?? getApiResourcePressureSnapshot();
  const appReadiness = buildAppReadiness({
    diagnostics: input.diagnostics,
    pressure,
  });
  const brokerReadiness = buildBrokerReadiness(
    input.diagnostics,
    input.brokerRuntime,
  );

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    liveness: { status: "ok" },
    appReadiness,
    brokerTradingReadiness: brokerReadiness,
    pressureLevel: pressure.level,
    degradedReasons: degradedReasons({
      diagnostics: input.diagnostics,
      pressure,
      appReadiness,
      brokerReadiness,
    }),
    manualTradingBlockedReason: brokerReadiness.ready
      ? null
      : brokerReadiness.reason,
  };
}
