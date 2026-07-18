export const IBKR_WEBSOCKIFY_PATH =
  "/api/broker-execution/ibkr-portal/gateway/websockify";

export function buildIbkrViewerWebSocketUrl(
  location: Pick<Location, "host" | "protocol">,
): string {
  const protocol =
    location.protocol === "https:"
      ? "wss:"
      : location.protocol === "http:"
        ? "ws:"
        : null;
  if (!protocol) {
    throw new Error("The IBKR viewer requires an HTTP origin.");
  }
  return `${protocol}//${location.host}${IBKR_WEBSOCKIFY_PATH}`;
}
