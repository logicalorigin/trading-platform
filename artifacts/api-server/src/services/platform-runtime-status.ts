export type IbkrRuntimeStreamState =
  | "offline"
  | "login_required"
  | "checking"
  | "delayed"
  | "live"
  | "quiet"
  | "stale"
  | "capacity_limited"
  | "reconnecting"
  | "reconnect_needed";

function isLikelyUsEquitySession(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 25 && minutes <= 16 * 60 + 5;
}

function streamStateDetail(
  state: IbkrRuntimeStreamState,
  reason: string,
): {
  streamState: IbkrRuntimeStreamState;
  streamStateReason: string;
} {
  return {
    streamState: state,
    streamStateReason: reason,
  };
}

export function isCapacityPressureBridgeError(value: unknown): boolean {
  const message = String(value ?? "").toLowerCase();
  return (
    message.includes("ibkr_bridge_lane_queue_full") ||
    message.includes("lane queue is full") ||
    message.includes("market data line") ||
    message.includes("max number of tickers") ||
    message.includes("ticker limit") ||
    message.includes("subscription limit")
  );
}

export function isRequestScopedBridgeHealthError(value: unknown): boolean {
  const message = String(value ?? "").toLowerCase();
  if (!message) {
    return false;
  }

  return (
    (message.includes("snapshot market data subscription") &&
      message.includes("generic")) ||
    (message.includes("error validating request") &&
      message.includes("market data")) ||
    message.includes("no security definition has been found") ||
    (message.includes("can't find eid") && message.includes("tickerid")) ||
    message.includes("ibkr_bridge_lane_timeout") ||
    message.includes("lane timed out after") ||
    (message.includes("historical market data service") &&
      message.includes("query cancelled")) ||
    isCapacityPressureBridgeError(message)
  );
}

export function sanitizeConnectedBridgeLastError(
  value: string | null | undefined,
  connected: boolean,
): string | null {
  if (!value) {
    return null;
  }
  if (connected && isRequestScopedBridgeHealthError(value)) {
    return null;
  }
  return value;
}

export function resolveIbkrRuntimeStreamState(input: {
  configured?: boolean;
  healthFresh?: boolean;
  bridgeReachable?: boolean;
  connected?: boolean;
  brokerServerConnected?: boolean;
  authenticated?: boolean;
  accountsLoaded?: boolean;
  configuredLiveMarketDataMode?: boolean;
  liveMarketDataAvailable?: boolean | null;
  streamFresh?: boolean;
  streamActive?: boolean;
  reconnectScheduled?: boolean;
  streamLastError?: string | null;
  streamPressure?: string | null;
  desiredSymbolCount?: number;
  now?: Date;
}): {
  streamState: IbkrRuntimeStreamState;
  streamStateReason: string;
} {
  const marketSessionActive = isLikelyUsEquitySession(input.now ?? new Date());
  if (!input.configured) return streamStateDetail("offline", "not_configured");
  const hasCapacityPressure =
    input.streamPressure === "capacity_limited" ||
    input.streamPressure === "backpressure";
  if (!input.healthFresh) {
    if (
      hasCapacityPressure &&
      (input.bridgeReachable || input.connected || input.authenticated)
    ) {
      return streamStateDetail("capacity_limited", input.streamPressure!);
    }
    if (input.streamFresh && (input.connected || input.authenticated)) {
      return streamStateDetail("live", "fresh_stream_event_health_stale");
    }
    if (input.bridgeReachable || input.connected || input.authenticated) {
      return streamStateDetail("checking", "health_stale");
    }
    return streamStateDetail("reconnect_needed", "bridge_unreachable");
  }
  if (!input.connected) {
    return streamStateDetail("reconnect_needed", "gateway_socket_disconnected");
  }
  if (input.brokerServerConnected === false) {
    return streamStateDetail("reconnect_needed", "gateway_server_disconnected");
  }
  if (!input.authenticated) {
    return streamStateDetail("login_required", "gateway_login_required");
  }
  if (!input.accountsLoaded) {
    return streamStateDetail("checking", "accounts_unavailable");
  }
  if (
    input.configuredLiveMarketDataMode === false ||
    input.liveMarketDataAvailable === false
  ) {
    return streamStateDetail("delayed", "live_market_data_not_configured");
  }
  if (!marketSessionActive) {
    return streamStateDetail("quiet", "market_session_quiet");
  }
  const desiredSymbolCount =
    input.desiredSymbolCount ?? (input.streamActive ? 1 : 0);
  if (desiredSymbolCount <= 0) {
    return streamStateDetail("quiet", "no_active_quote_consumers");
  }
  if (hasCapacityPressure) {
    return streamStateDetail("capacity_limited", input.streamPressure!);
  }
  if (input.reconnectScheduled) {
    return streamStateDetail("reconnecting", "quote_stream_reconnecting");
  }
  if (
    input.streamLastError &&
    isCapacityPressureBridgeError(input.streamLastError)
  ) {
    return streamStateDetail("capacity_limited", "capacity_error");
  }
  if (input.streamLastError) {
    return streamStateDetail("reconnecting", "quote_stream_error");
  }
  if (input.streamFresh) return streamStateDetail("live", "fresh_stream_event");
  if (!input.streamActive) {
    return streamStateDetail("checking", "quote_stream_starting");
  }
  return streamStateDetail("stale", "stream_not_fresh");
}

export function resolveIbkrRuntimeStrictReason(input: {
  healthFresh: boolean;
  connected: boolean;
  brokerServerConnected?: boolean;
  authenticated: boolean;
  accountsLoaded: boolean;
  configuredLiveMarketDataMode: boolean;
  streamFresh: boolean;
  streamActive?: boolean;
  desiredSymbolCount?: number;
  now?: Date;
}): string | null {
  const marketSessionActive = isLikelyUsEquitySession(input.now ?? new Date());
  if (
    !input.healthFresh &&
    input.streamFresh &&
    input.connected &&
    input.authenticated
  ) {
    return null;
  }
  if (!input.healthFresh) return "health_stale";
  if (!input.connected) return "gateway_socket_disconnected";
  if (input.brokerServerConnected === false) {
    return "gateway_server_disconnected";
  }
  if (!input.authenticated) return "gateway_login_required";
  if (!input.accountsLoaded) return "accounts_unavailable";
  if (!input.configuredLiveMarketDataMode) {
    return "live_market_data_not_configured";
  }
  if (!marketSessionActive) {
    return input.streamFresh ? null : "market_session_quiet";
  }
  const desiredSymbolCount =
    input.desiredSymbolCount ?? (input.streamActive ? 1 : 0);
  if (desiredSymbolCount <= 0) return null;
  if (!input.streamFresh) {
    return "stream_not_fresh";
  }
  return null;
}
