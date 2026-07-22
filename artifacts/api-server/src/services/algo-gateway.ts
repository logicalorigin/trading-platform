import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";

export type AlgoGatewayReadinessReason = "market_session_quiet";

export type AlgoGatewayReadiness = {
  ready: boolean;
  reason: AlgoGatewayReadinessReason | null;
  message: string;
  diagnostics: Record<string, unknown>;
};

// Shadow execution and live provider-target dispatch both share only the
// exchange-session gate here. Each live target adapter owns its broker-specific
// readiness checks at the mutation boundary.
export function resolveAlgoShadowDisplayReadiness(
  now: Date = new Date(),
): AlgoGatewayReadiness {
  if (resolveUsEquityMarketStatus(now).session.key !== "rth") {
    return {
      ready: false,
      reason: "market_session_quiet",
      message: "Options strategy execution is outside the regular options session.",
      diagnostics: {},
    };
  }
  return {
    ready: true,
    reason: null,
    message: "Shadow options automation is ready (Massive market data).",
    diagnostics: {},
  };
}

// Signal Options live orders route through an explicitly armed provider target.
// The target dispatcher owns broker-specific readiness, so this upstream gate
// enforces only the options session.
export function resolveAlgoTargetDispatchReadiness(
  now: Date = new Date(),
): AlgoGatewayReadiness {
  const readiness = resolveAlgoShadowDisplayReadiness(now);
  return {
    ...readiness,
    message: readiness.ready
      ? "Provider-target options automation is ready for execution."
      : readiness.message,
    diagnostics: { executionPath: "provider_targets" },
  };
}
