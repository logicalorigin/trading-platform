import { config } from "../config";
import { ApiError } from "../http/api-client";
import { capToolText, toToolText } from "../shape";

export interface ToolTextResult {
  // Matches the SDK's CallToolResult (zod passthrough) index signature.
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Success: shaped JSON text under the byte cap. */
export function ok(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: toToolText(value, config.maxResponseBytes) }] };
}

/** Failure: a compact, model-readable message. Never echoes raw upstream bodies. */
export function fail(message: string): ToolTextResult {
  return {
    content: [
      { type: "text", text: capToolText(message, config.maxResponseBytes) },
    ],
    isError: true,
  };
}

function errorName(error: unknown): string | null {
  if (error !== null && typeof error === "object" && "name" in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === "string" ? name : null;
  }
  return null;
}

/** Map a thrown error from an HTTP tool into a friendly tool failure. */
export function fromHttpError(endpoint: string, error: unknown): ToolTextResult {
  if (error instanceof ApiError) {
    return fail(
      `${endpoint} failed: HTTP ${error.status}. The API is reachable but returned an error — check the api-server logs.`,
    );
  }
  if (errorName(error) === "TimeoutError" || errorName(error) === "AbortError") {
    return fail(`${endpoint} timed out after ${config.apiTimeoutMs}ms.`);
  }
  return fail(`${endpoint} failed: API unreachable.`);
}

/** Map a thrown host-tool error without exposing filesystem or process detail. */
export function fromHostError(toolName: string, _error: unknown): ToolTextResult {
  return fail(`${toolName} failed: internal tool error.`);
}
