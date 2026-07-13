import { HttpError } from "../lib/errors";

export type RobinhoodSubmitReconciliationReason =
  | "request_timeout"
  | "network_error"
  | "invalid_response"
  | "request_failed"
  | "missing_order_id";

export function robinhoodSubmitReconciliationFailure(
  error: unknown,
): { reason: RobinhoodSubmitReconciliationReason; sourceCode: string } | null {
  if (!(error instanceof HttpError) || !error.code) return null;
  const reasonByCode: Record<string, RobinhoodSubmitReconciliationReason> = {
    robinhood_mcp_request_timeout: "request_timeout",
    robinhood_mcp_network_error: "network_error",
    robinhood_mcp_invalid_response: "invalid_response",
    robinhood_mcp_request_failed: "request_failed",
  };
  const reason = reasonByCode[error.code];
  return reason ? { reason, sourceCode: error.code } : null;
}
