// Robinhood Agentic Trading (MCP) connect panel model helpers.
// Backend surface: GET /api/broker-execution/robinhood/readiness,
// POST /api/broker-execution/robinhood/connect (OAuth start),
// POST /api/broker-execution/robinhood/sync. The OAuth callback redirects the
// browser back to /?screen=settings&robinhood=<outcome>.

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

// Robinhood options upgrade deep link. The account-scoped variant
// (?account_number=<full number>) is intentionally NOT used: the sync response
// contract never exposes full account numbers, so we link to the generic
// upgrade flow where the user selects the account on their own device.
export const ROBINHOOD_UPGRADE_OPTIONS_URL =
  "https://applink.robinhood.com/upgrade_options";

// Formats the get_accounts option_level tier (e.g. "option_level_2") for
// display. Returns null when options are not approved (empty/unparseable).
export function formatRobinhoodOptionLevel(optionLevel) {
  const match = String(optionLevel || "").match(/(\d+)/u);
  return match ? `Level ${match[1]}` : null;
}

// Human-friendly copy for the per-account execution blocker codes emitted by
// artifacts/api-server/src/services/robinhood-account-sync.ts. Unmapped codes
// fall back to their raw value so new blockers still render.
export const ROBINHOOD_ACCOUNT_BLOCKER_LABELS = Object.freeze({
  "robinhood.account.non_agentic": "not an agentic account",
  "robinhood.account.agentic_unverified": "agentic status unverified",
  "robinhood.account.deactivated": "deactivated",
  "robinhood.account.closed": "closed",
  "robinhood.account.archived": "archived",
  "robinhood.account.status_unverified": "status unverified",
});

export function formatRobinhoodAccountBlockers(blockers) {
  const labels = Array.from(
    new Set(
      (Array.isArray(blockers) ? blockers : [])
        .map((code) => ROBINHOOD_ACCOUNT_BLOCKER_LABELS[code] || code)
        .filter(Boolean),
    ),
  );
  return labels.length ? labels.join(", ") : "blocked";
}

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
