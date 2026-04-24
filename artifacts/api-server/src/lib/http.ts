import { HttpError } from "./errors";

type QueryPrimitive = string | number | boolean | Date;
export type QueryValue = QueryPrimitive | QueryPrimitive[] | null | undefined;

function encodeQueryPrimitive(value: QueryPrimitive): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function withSearchParams(
  input: string | URL,
  params: Record<string, QueryValue>,
): URL {
  const url = input instanceof URL ? new URL(input.toString()) : new URL(input);

  Object.entries(params).forEach(([key, rawValue]) => {
    if (rawValue === null || rawValue === undefined) {
      return;
    }

    if (Array.isArray(rawValue)) {
      rawValue.forEach((value) => {
        if (value !== null && value !== undefined) {
          url.searchParams.append(key, encodeQueryPrimitive(value));
        }
      });
      return;
    }

    url.searchParams.set(key, encodeQueryPrimitive(rawValue));
  });

  return url;
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isJson =
    contentType.includes("application/json") || contentType.includes("+json");

  if (isJson) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  return text;
}

// Cap how much upstream body text we attach to errors. HTML error pages
// (e.g. Cloudflare 530 / proxy 502) are often 5–10 KB, and the same body
// would otherwise be serialized into the error's message + detail + data,
// flooding the log files (MB/min) and slowing the whole workspace.
const MAX_ERROR_BODY_CHARS = 300;

function truncateForError(value: string): string {
  if (value.length <= MAX_ERROR_BODY_CHARS) return value;
  return `${value.slice(0, MAX_ERROR_BODY_CHARS)}…[truncated ${value.length - MAX_ERROR_BODY_CHARS} chars]`;
}

function buildErrorMessage(status: number, statusText: string, body: unknown): string {
  const prefix = `HTTP ${status} ${statusText}`;

  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed ? `${prefix}: ${truncateForError(trimmed)}` : prefix;
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const detail =
      record["detail"] ??
      record["message"] ??
      record["error_description"] ??
      record["error"];

    if (typeof detail === "string" && detail.trim()) {
      return `${prefix}: ${truncateForError(detail.trim())}`;
    }
  }

  return prefix;
}

export async function fetchJson<T>(
  input: string | URL,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (error) {
    throw new HttpError(502, "Upstream request failed.", {
      code: "upstream_request_failed",
      cause: error,
      detail:
        error instanceof Error && error.message
          ? error.message
          : "The upstream service could not be reached.",
    });
  }

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    // Truncate large bodies (HTML error pages from Cloudflare/proxies) to
    // keep error logs small. Structured JSON payloads pass through as-is in
    // `data` for callers that need to inspect them.
    const detailString =
      typeof payload === "string"
        ? truncateForError(payload)
        : payload && typeof payload === "object"
          ? truncateForError(JSON.stringify(payload))
          : undefined;
    const dataForError =
      typeof payload === "string" && payload.length > MAX_ERROR_BODY_CHARS
        ? truncateForError(payload)
        : payload;

    throw new HttpError(response.status, buildErrorMessage(response.status, response.statusText, payload), {
      code: "upstream_http_error",
      detail: detailString,
      data: dataForError,
      expose: response.status < 500,
    });
  }

  return payload as T;
}
