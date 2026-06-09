import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import { HttpError } from "../lib/errors";
import { getRuntimeDiagnostics } from "./platform";

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
      ibkr.configuredLiveMarketDataMode === true &&
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
  const configuredLiveMarketDataMode =
    ibkr.configuredLiveMarketDataMode === true;

  if (!configured) {
    return {
      ready: false,
      reason: "ibkr_not_configured",
      message: "IB Gateway bridge is not configured for options strategy execution.",
      diagnostics: ibkr,
    };
  }

  if (!healthFresh && !liveStreamReady) {
    return {
      ready: false,
      reason: "bridge_health_unavailable",
      message: "IB Gateway bridge health is unavailable or stale.",
      diagnostics: ibkr,
    };
  }

  if (!connected) {
    return {
      ready: false,
      reason: "gateway_socket_disconnected",
      message: "IB Gateway bridge is reachable, but the TWS socket is disconnected.",
      diagnostics: ibkr,
    };
  }

  if (!authenticated) {
    return {
      ready: false,
      reason: "gateway_login_required",
      message: "IB Gateway is connected, but the broker session is not authenticated.",
      diagnostics: ibkr,
    };
  }

  if (!accountsLoaded) {
    return {
      ready: false,
      reason: "accounts_unavailable",
      message: "IB Gateway is authenticated, but broker accounts are not loaded.",
      diagnostics: ibkr,
    };
  }

  if (!configuredLiveMarketDataMode) {
    return {
      ready: false,
      reason: "live_market_data_not_configured",
      message: "IB Gateway is authenticated, but live market-data mode is not configured.",
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
    message: "IB Gateway is ready for options strategy execution.",
    diagnostics: ibkr,
  };
}

export async function getAlgoGatewayReadiness(): Promise<AlgoGatewayReadiness> {
  const runtime = await getRuntimeDiagnostics();
  return resolveAlgoGatewayReadiness(asRecord(runtime).ibkr);
}

export function throwAlgoGatewayNotReady(
  readiness: AlgoGatewayReadiness,
): never {
  throw new HttpError(503, "IB Gateway is required for options strategy execution.", {
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
