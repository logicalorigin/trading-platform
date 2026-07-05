// Robinhood Agentic Trading (MCP) connect panel model helpers.
// Backend surface: GET /api/broker-execution/robinhood/readiness,
// POST /api/broker-execution/robinhood/connect (OAuth start),
// POST /api/broker-execution/robinhood/sync. The OAuth callback redirects the
// browser back to /?screen=settings&robinhood=<outcome>.

export function canManageRobinhoodConnections(user) {
  return user?.role === "admin";
}

// Human-friendly copy for the readiness limitation codes emitted by
// artifacts/api-server/src/services/robinhood-readiness.ts. Unmapped codes fall
// back to their raw value so new limitations still render.
export const ROBINHOOD_LIMITATION_LABELS = Object.freeze({
  "robinhood.provider_research_required": "Provider research required before live trading",
  "robinhood.agentic_account_only": "Agentic-enabled Robinhood account only",
  "robinhood.equities_long_only": "Equities, long-only",
  "robinhood.order_tooling_unverified": "Order tooling unverified — execution gated",
  "robinhood.credential_encryption_key_missing": "Credential encryption key missing",
  "robinhood.redirect_base_url_missing": "OAuth redirect base URL missing",
  "robinhood.oauth_metadata_unavailable": "Robinhood OAuth metadata unavailable",
});

export function formatRobinhoodLimitation(code) {
  return ROBINHOOD_LIMITATION_LABELS[code] || code;
}

export const ROBINHOOD_USER_STATUS_LABELS = Object.freeze({
  not_connected: "not connected",
  pending: "authorization pending",
  connected: "connected",
  disabled: "disabled",
});

export const ROBINHOOD_NEXT_ACTION_LABELS = Object.freeze({
  start_connect: "start connect",
  complete_authorization: "complete authorization",
  sync_accounts: "sync accounts",
  manual_review: "manual review",
});

// Maps the browser-facing ?robinhood=<outcome> callback flag to banner copy.
export function formatRobinhoodConnectOutcome(outcome) {
  switch (outcome) {
    case "connected":
      return { tone: "green", message: "Robinhood connected. Sync accounts to load them." };
    case "denied":
      return { tone: "amber", message: "Robinhood authorization was denied or cancelled." };
    case "error":
      return { tone: "amber", message: "Robinhood authorization failed. Try connecting again." };
    default:
      return null;
  }
}
