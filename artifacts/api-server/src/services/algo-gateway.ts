import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import { HttpError } from "../lib/errors";
import { getAlgoGatewayReadinessSignals } from "./platform";

export type AlgoGatewayReadinessReason =
  | "ibkr_not_configured"
  | "bridge_health_unavailable"
  | "gateway_socket_disconnected"
  | "gateway_login_required"
  | "accounts_unavailable"
  | "live_market_data_not_configured"
  | "market_session_quiet";

export type AlgoGatewayReadiness = {
  ready: boolean;
  reason: AlgoGatewayReadinessReason | null;
  message: string;
  diagnostics: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasLiveStreamReadinessProof(ibkr: Record<string, unknown>): boolean {
  const streamState = typeof ibkr.streamState === "string" ? ibkr.streamState : "";
  return Boolean(
    ibkr.connected === true &&
      ibkr.authenticated === true &&
      ibkr.accountsLoaded === true &&
      (ibkr.strictReady === true ||
        (ibkr.streamFresh === true && streamState === "live")),
  );
}

export function resolveAlgoGatewayReadiness(
  ibkrDiagnostics: unknown,
  now: Date = new Date(),
): AlgoGatewayReadiness {
  const ibkr = asRecord(ibkrDiagnostics);
  const configured = ibkr.configured === true;
  const healthFresh = ibkr.healthFresh === true;
  const liveStreamReady = hasLiveStreamReadinessProof(ibkr);
  const connected = ibkr.connected === true;
  const authenticated = ibkr.authenticated === true;
  const accountsLoaded = ibkr.accountsLoaded === true;

  if (!configured) {
    return {
      ready: false,
      reason: "ibkr_not_configured",
      message: "IBKR Client Portal is not configured for live broker order execution.",
      diagnostics: ibkr,
    };
  }

  if (!healthFresh && !liveStreamReady) {
    return {
      ready: false,
      reason: "bridge_health_unavailable",
      message: "IBKR Client Portal health is unavailable or stale.",
      diagnostics: ibkr,
    };
  }

  if (!connected) {
    return {
      ready: false,
      reason: "gateway_socket_disconnected",
      message: "IBKR Client Portal is disconnected.",
      diagnostics: ibkr,
    };
  }

  if (!authenticated) {
    return {
      ready: false,
      reason: "gateway_login_required",
      message: "IBKR Client Portal is connected, but the broker session is not authenticated.",
      diagnostics: ibkr,
    };
  }

  if (!accountsLoaded) {
    return {
      ready: false,
      reason: "accounts_unavailable",
      message: "IBKR Client Portal is authenticated, but broker accounts are not loaded.",
      diagnostics: ibkr,
    };
  }

  // Execution gate: signal-options strategies only EXECUTE during the regular
  // options session. This is an
  // independent, time-based check (not derived from the runtime stream/strict status,
  // which no longer carries a market_session_quiet reason — time-of-day gates only
  // options execution, never equities, market data, or display). Equity after-hours
  // workflows use their own execution checks.
  if (resolveUsEquityMarketStatus(now).session.key !== "rth") {
    return {
      ready: false,
      reason: "market_session_quiet",
      message: "Options strategy execution is outside the regular options session.",
      diagnostics: ibkr,
    };
  }

  return {
    ready: true,
    reason: null,
    message: "IBKR Client Portal is ready for live broker order execution.",
    diagnostics: ibkr,
  };
}

export async function getAlgoGatewayReadiness(): Promise<AlgoGatewayReadiness> {
  // Read only the lightweight gateway readiness signals, not the full
  // getRuntimeDiagnostics blob. This call is on the cockpit/STA hot read path
  // (getAlgoDeploymentCockpit -> buildAlgoDeploymentCockpitPayload), where
  // building the full diagnostics added ~2s + ~540KB per read at startup.
  const ibkr = await getAlgoGatewayReadinessSignals();
  return resolveAlgoGatewayReadiness(ibkr);
}

export function throwAlgoGatewayNotReady(
  readiness: AlgoGatewayReadiness,
): never {
  throw new HttpError(503, "IBKR Client Portal is required for live broker order execution.", {
    code: "algo_gateway_not_ready",
    detail: readiness.message,
    data: {
      diagnostics: readiness,
    },
  });
}

export async function assertAlgoGatewayReady(): Promise<AlgoGatewayReadiness> {
  const readiness = await getAlgoGatewayReadiness();
  if (!readiness.ready) {
    throwAlgoGatewayNotReady(readiness);
  }
  return readiness;
}
