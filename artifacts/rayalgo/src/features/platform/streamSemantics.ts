export type StreamState =
  | "healthy"
  | "quiet"
  | "stale"
  | "delayed"
  | "capacity-limited"
  | "reconnecting"
  | "checking"
  | "login-required"
  | "offline"
  | "market-closed"
  | "no-subscribers";

export const STREAM_STATE_TOKEN: Record<StreamState, string> = {
  healthy: "--ra-stream-healthy",
  quiet: "--ra-stream-quiet",
  stale: "--ra-stream-stale",
  delayed: "--ra-stream-delayed",
  "capacity-limited": "--ra-stream-capacity-limited",
  reconnecting: "--ra-stream-reconnecting",
  checking: "--ra-stream-checking",
  "login-required": "--ra-stream-login-required",
  offline: "--ra-stream-offline",
  "market-closed": "--ra-stream-market-closed",
  "no-subscribers": "--ra-stream-no-subscribers",
};

export const STREAM_STATE_LABEL: Record<StreamState, string> = {
  healthy: "LIVE",
  quiet: "QUIET",
  stale: "STALE",
  delayed: "DELAYED",
  "capacity-limited": "CAPACITY",
  reconnecting: "RECONNECTING",
  checking: "CHECKING",
  "login-required": "LOGIN REQUIRED",
  offline: "OFFLINE",
  "market-closed": "CLOSED",
  "no-subscribers": "STANDBY",
};

const STREAM_STATE_SET = new Set<StreamState>(
  Object.keys(STREAM_STATE_TOKEN) as StreamState[],
);

const LEGACY_STREAM_STATE: Record<string, StreamState> = {
  live: "healthy",
  fresh: "healthy",
  ready: "healthy",
  online: "healthy",
  standby: "no-subscribers",
  idle: "no-subscribers",
  quote_standby: "no-subscribers",
  "quote-standby": "no-subscribers",
  no_quote_subscribers: "no-subscribers",
  "no-quote-subscribers": "no-subscribers",
  no_active_quote_consumers: "no-subscribers",
  "no-active-quote-consumers": "no-subscribers",
  no_subscribers: "no-subscribers",
  "no-subscribers": "no-subscribers",
  market_closed: "market-closed",
  "market-closed": "market-closed",
  market_session_quiet: "market-closed",
  "market-session-quiet": "market-closed",
  stale_stream: "stale",
  "stale-stream": "stale",
  lagging: "stale",
  capacity_limited: "capacity-limited",
  "capacity-limited": "capacity-limited",
  reconnect_needed: "reconnecting",
  "reconnect-needed": "reconnecting",
  reconnect: "reconnecting",
  retry: "reconnecting",
  login_required: "login-required",
  "login-required": "login-required",
};

export function canonicalizeStreamState(
  legacy: string | null | undefined,
  fallback: StreamState = "offline",
): StreamState {
  if (!legacy) {
    return fallback;
  }

  const normalized = String(legacy).trim().toLowerCase();
  const kebab = normalized.replaceAll("_", "-");
  if (STREAM_STATE_SET.has(normalized as StreamState)) {
    return normalized as StreamState;
  }
  if (STREAM_STATE_SET.has(kebab as StreamState)) {
    return kebab as StreamState;
  }
  return LEGACY_STREAM_STATE[normalized] || LEGACY_STREAM_STATE[kebab] || fallback;
}

export const streamStateToken = (state: string | null | undefined): string =>
  STREAM_STATE_TOKEN[canonicalizeStreamState(state)];

export const streamStateTokenVar = (state: string | null | undefined): string =>
  `var(${streamStateToken(state)})`;

export const streamStateBackgroundVar = (
  state: string | null | undefined,
  amount = 14,
): string =>
  `color-mix(in srgb, ${streamStateTokenVar(state)} ${amount}%, transparent)`;

export const streamStateBorderVar = (
  state: string | null | undefined,
  amount = 40,
): string =>
  `color-mix(in srgb, ${streamStateTokenVar(state)} ${amount}%, transparent)`;
