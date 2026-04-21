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

function buildErrorMessage(status: number, statusText: string, body: unknown): string {
  const prefix = `HTTP ${status} ${statusText}`;

  if (typeof body === "string") {
    const trimmed = body.trim();
    return trimmed ? `${prefix}: ${trimmed}` : prefix;
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const detail =
      record["detail"] ??
      record["message"] ??
      record["error_description"] ??
      record["error"];

    if (typeof detail === "string" && detail.trim()) {
      return `${prefix}: ${detail.trim()}`;
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
    throw new HttpError(response.status, buildErrorMessage(response.status, response.statusText, payload), {
      code: "upstream_http_error",
      detail:
        typeof payload === "string"
          ? payload
          : payload && typeof payload === "object"
            ? JSON.stringify(payload)
            : undefined,
      data: payload,
      expose: response.status < 500,
    });
  }

  return payload as T;
}
