import { HttpError } from "../lib/errors";
import { getRuntimeDiagnostics } from "./platform";

export type AlgoGatewayReadinessReason =
  | "ibkr_not_configured"
  | "bridge_health_unavailable"
  | "gateway_socket_disconnected"
  | "gateway_login_required"
  | "accounts_unavailable"
  | "live_market_data_not_configured";

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

export function resolveAlgoGatewayReadiness(
  ibkrDiagnostics: unknown,
): AlgoGatewayReadiness {
  const ibkr = asRecord(ibkrDiagnostics);
  const configured = ibkr.configured === true;
  const healthFresh = ibkr.healthFresh === true;
  const connected = ibkr.connected === true;
  const authenticated = ibkr.authenticated === true;
  const accountsLoaded = ibkr.accountsLoaded === true;
  const configuredLiveMarketDataMode =
    ibkr.configuredLiveMarketDataMode === true;

  if (!configured) {
    return {
      ready: false,
      reason: "ibkr_not_configured",
      message: "IB Gateway bridge is not configured for algorithm execution.",
      diagnostics: ibkr,
    };
  }

  if (!healthFresh) {
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

  return {
    ready: true,
    reason: null,
    message: "IB Gateway is ready for algorithm execution.",
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
  throw new HttpError(503, "IB Gateway is required for algorithm execution.", {
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
