// Schwab Trader API connect panel model helpers.
// Backend surface: GET /api/broker-execution/schwab/readiness,
// POST /api/broker-execution/schwab/connect (OAuth start),
// POST /api/broker-execution/schwab/sync. The OAuth callback redirects the
// browser back to /?screen=settings&schwab=<outcome>.

export function canManageSchwabConnections(user) {
  return user?.role === "admin";
}

// Human-friendly copy for the readiness limitation codes emitted by
// artifacts/api-server/src/services/schwab-readiness.ts. Unmapped codes fall
// back to their raw value so new limitations still render.
export const SCHWAB_LIMITATION_LABELS = Object.freeze({
  "schwab.provider_research_required": "Provider research required before live trading",
  "schwab.order_tooling_unverified": "Order tooling unverified — execution gated",
  "schwab.weekly_reauth_required": "Schwab requires re-authorization every 7 days",
  "schwab.broker_reauth_required": "Reconnect Schwab to refresh authorization",
  "schwab.credential_encryption_key_missing": "Credential encryption key missing",
  "schwab.redirect_base_url_missing": "OAuth redirect base URL missing",
  "schwab.app_credentials_missing": "Schwab app key/secret missing",
});

export function formatSchwabLimitation(code) {
  return SCHWAB_LIMITATION_LABELS[code] || code;
}

export const SCHWAB_USER_STATUS_LABELS = Object.freeze({
  not_connected: "not connected",
  pending: "authorization pending",
  connected: "connected",
  expired: "reconnect required",
  disabled: "disabled",
});

export const SCHWAB_NEXT_ACTION_LABELS = Object.freeze({
  start_connect: "start connect",
  complete_authorization: "complete authorization",
  sync_accounts: "sync accounts",
  reconnect: "reconnect",
  manual_review: "manual review",
});

// Maps the browser-facing ?schwab=<outcome> callback flag to banner copy.
export function formatSchwabConnectOutcome(outcome) {
  switch (outcome) {
    case "connected":
      return { tone: "green", message: "Schwab connected. Sync accounts to load them." };
    case "denied":
      return { tone: "amber", message: "Schwab authorization was denied or cancelled." };
    case "error":
      return { tone: "amber", message: "Schwab authorization failed. Try connecting again." };
    default:
      return null;
  }
}

export function isSchwabReauthRequired(readiness) {
  const user = readiness?.user || null;
  return Boolean(
    readiness?.status === "reauth_required" ||
      readiness?.reauthRequired?.required === true ||
      user?.status === "expired" ||
      user?.nextAction === "reconnect" ||
      user?.executionBlockers?.includes("broker_reauth"),
  );
}

export function schwabConnectActionLabel({ connected, reauthRequired } = {}) {
  if (reauthRequired) return "Reconnect Schwab";
  return connected ? "Reconnect" : "Connect";
}
