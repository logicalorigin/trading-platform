import type {
  IbkrMarketDataDesiredGeneration,
  IbkrMarketDataGenerationStatus,
} from "@workspace/ibkr-contracts";
import { HttpError } from "../lib/errors";
import { getIbkrBridgeRuntimeConfig } from "../lib/runtime";

export type IbkrAsyncSidecarMarketDataClient = {
  getMarketDataGeneration(): Promise<IbkrMarketDataGenerationStatus>;
  applyMarketDataGeneration(
    input: IbkrMarketDataDesiredGeneration,
  ): Promise<IbkrMarketDataGenerationStatus>;
};

const DEFAULT_SIDECAR_HOST = "127.0.0.1";
const DEFAULT_SIDECAR_PORT = 18_769;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const BRIDGE_PROXY_BASE_PATH = "/async-sidecar/";
const VALID_LINE_STATES = new Set([
  "desired",
  "subscribing",
  "live",
  "releasing",
  "released",
  "failed",
  "stale",
  "unexpected",
]);

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRequestTimeoutMs(): number {
  return readPositiveIntegerEnv(
    "IBKR_ASYNC_SIDECAR_REQUEST_TIMEOUT_MS",
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
}

function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function readFalseyEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "0" || raw === "false" || raw === "no" || raw === "off";
}

function readSidecarConnectionConfig(): {
  baseUrl: URL;
  headers: Record<string, string>;
} {
  const configuredUrl =
    process.env["IBKR_ASYNC_SIDECAR_URL"]?.trim() ||
    process.env["PYRUS_IBKR_SIDECAR_URL"]?.trim();
  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl);
      if (!isHttpUrl(url)) {
        throw new Error("URL must use HTTP or HTTPS.");
      }
      return { baseUrl: url, headers: {} };
    } catch (error) {
      throw new HttpError(503, "IBKR async sidecar URL is invalid.", {
        code: "ibkr_async_sidecar_url_invalid",
        cause: error,
      });
    }
  }

  const bridgeRuntime = readFalseyEnv("IBKR_ASYNC_SIDECAR_BRIDGE_PROXY_ENABLED")
    ? null
    : getIbkrBridgeRuntimeConfig();
  if (bridgeRuntime) {
    return {
      baseUrl: new URL(BRIDGE_PROXY_BASE_PATH, bridgeRuntime.baseUrl),
      headers: bridgeRuntime.apiToken
        ? { Authorization: `Bearer ${bridgeRuntime.apiToken}` }
        : {},
    };
  }

  const host =
    process.env["IBKR_ASYNC_SIDECAR_HOST"]?.trim() ||
    process.env["PYRUS_IBKR_SIDECAR_HOST"]?.trim() ||
    DEFAULT_SIDECAR_HOST;
  const port = readPositiveIntegerEnv(
    "IBKR_ASYNC_SIDECAR_PORT",
    readPositiveIntegerEnv("PYRUS_IBKR_SIDECAR_PORT", DEFAULT_SIDECAR_PORT),
  );
  const url = new URL("http://127.0.0.1");
  url.hostname = host;
  url.port = String(port);
  return { baseUrl: url, headers: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNumberOrNull(value: unknown): value is number | null {
  return (
    (typeof value === "number" && Number.isFinite(value)) || value === null
  );
}

function isLineOwner(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.owner === "string" &&
    isStringOrNull(value.ownerClass) &&
    typeof value.intent === "string" &&
    isStringOrNull(value.pool) &&
    isNumberOrNull(value.priority)
  );
}

function isLineContract(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStringOrNull(value.symbol) &&
    isStringOrNull(value.providerContractId)
  );
}

function isGenerationLineStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.lineKey === "string" &&
    (value.assetClass === "equity" || value.assetClass === "option") &&
    typeof value.state === "string" &&
    VALID_LINE_STATES.has(value.state) &&
    isLineContract(value.contract) &&
    Array.isArray(value.owners) &&
    value.owners.every(isLineOwner) &&
    isStringOrNull(value.subscribedAt) &&
    isStringOrNull(value.lastTickAt) &&
    isStringOrNull(value.releaseRequestedAt) &&
    isStringOrNull(value.error)
  );
}

function hasFiniteNumberField(
  value: Record<string, unknown>,
  field: string,
): boolean {
  return typeof value[field] === "number" && Number.isFinite(value[field]);
}

function isGenerationStatusSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasFiniteNumberField(value, "liveLineCount") &&
    hasFiniteNumberField(value, "liveEquityLineCount") &&
    hasFiniteNumberField(value, "liveOptionLineCount") &&
    hasFiniteNumberField(value, "subscribingLineCount") &&
    hasFiniteNumberField(value, "releasingLineCount") &&
    hasFiniteNumberField(value, "failedLineCount") &&
    hasFiniteNumberField(value, "unexpectedLineCount")
  );
}

function isThrottleStatus(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.throttled === "boolean" &&
    isNumberOrNull(value.queueDepth) &&
    isNumberOrNull(value.maxRequests) &&
    isNumberOrNull(value.requestsIntervalSec) &&
    isStringOrNull(value.lastThrottleStartAt) &&
    isStringOrNull(value.lastThrottleEndAt)
  );
}

function parseGenerationStatus(
  value: unknown,
): IbkrMarketDataGenerationStatus {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    (value.mode !== "observer" && value.mode !== "executor") ||
    value.source !== "ib-async-sidecar" ||
    !isStringOrNull(value.generationId) ||
    !isStringOrNull(value.appliedGenerationId) ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.lines) ||
    !value.lines.every(isGenerationLineStatus) ||
    !isGenerationStatusSummary(value.summary) ||
    !isThrottleStatus(value.throttle)
  ) {
    throw new HttpError(
      502,
      "IBKR async sidecar generation status was invalid.",
      {
        code: "ibkr_async_sidecar_generation_status_invalid",
        data: value,
      },
    );
  }

  return value as IbkrMarketDataGenerationStatus;
}

function parseJsonPayload(text: string, contentType: string): unknown {
  if (!text) {
    return null;
  }
  if (!contentType.toLowerCase().includes("application/json")) {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new HttpError(502, "IBKR async sidecar returned invalid JSON.", {
      code: "ibkr_async_sidecar_invalid_json",
      cause: error,
      detail: text.slice(0, 1_000),
    });
  }
}

function buildSidecarErrorMessage(
  statusCode: number,
  statusText: string,
  payload: unknown,
): string {
  if (isRecord(payload)) {
    const detail = payload.detail;
    if (typeof detail === "string" && detail.trim()) {
      return `IBKR async sidecar returned ${statusCode}: ${detail.trim()}`;
    }
  }
  return `IBKR async sidecar returned ${statusCode}${statusText ? ` ${statusText}` : ""}.`;
}

function errorDetail(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}

function joinSidecarUrl(baseUrl: URL, path: string): URL {
  const normalizedBase = baseUrl.href.endsWith("/")
    ? baseUrl
    : new URL(`${baseUrl.href}/`);
  return new URL(path.replace(/^\/+/, ""), normalizedBase);
}

export class IbkrAsyncSidecarClient
  implements IbkrAsyncSidecarMarketDataClient
{
  private readonly baseUrl: URL;
  private readonly headers: Record<string, string>;
  private readonly requestTimeoutMs: number;

  constructor(input: {
    baseUrl?: URL;
    headers?: Record<string, string>;
    requestTimeoutMs?: number;
  } = {}) {
    const config = input.baseUrl
      ? { baseUrl: input.baseUrl, headers: input.headers ?? {} }
      : readSidecarConnectionConfig();
    this.baseUrl = config.baseUrl;
    this.headers = input.headers ?? config.headers;
    this.requestTimeoutMs = input.requestTimeoutMs ?? readRequestTimeoutMs();
  }

  async getMarketDataGeneration(): Promise<IbkrMarketDataGenerationStatus> {
    return parseGenerationStatus(
      await this.requestJson("/market-data/generation"),
    );
  }

  async applyMarketDataGeneration(
    input: IbkrMarketDataDesiredGeneration,
  ): Promise<IbkrMarketDataGenerationStatus> {
    return parseGenerationStatus(
      await this.requestJson("/market-data/generation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      }),
    );
  }

  private async requestJson(
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const url = joinSidecarUrl(this.baseUrl, path);
    const controller = new AbortController();
    const inputSignal = init.signal;
    let didTimeout = false;
    const timeout =
      this.requestTimeoutMs > 0
        ? setTimeout(() => {
            didTimeout = true;
            controller.abort();
          }, this.requestTimeoutMs)
        : null;
    timeout?.unref?.();
    const abortFromInput = () => controller.abort(inputSignal?.reason);

    if (inputSignal?.aborted) {
      controller.abort(inputSignal.reason);
    } else {
      inputSignal?.addEventListener("abort", abortFromInput, { once: true });
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...this.headers,
          Accept: "application/json",
          ...(init.headers
            ? Object.fromEntries(new Headers(init.headers).entries())
            : {}),
        },
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = parseJsonPayload(
        text,
        response.headers.get("content-type") ?? "",
      );
      if (!response.ok) {
        throw new HttpError(
          response.status,
          buildSidecarErrorMessage(response.status, response.statusText, payload),
          {
            code: "ibkr_async_sidecar_http_error",
            data: payload,
            detail: typeof payload === "string" ? payload : undefined,
            expose: response.status < 500,
          },
        );
      }
      return payload;
    } catch (error) {
      if (didTimeout) {
        throw new HttpError(
          504,
          `IBKR async sidecar request to ${path} timed out after ${this.requestTimeoutMs}ms.`,
          {
            code: "ibkr_async_sidecar_request_timeout",
            cause: error,
          },
        );
      }
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(502, "IBKR async sidecar request failed.", {
        code: "ibkr_async_sidecar_request_failed",
        cause: error,
        detail: errorDetail(error),
      });
    } finally {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      inputSignal?.removeEventListener("abort", abortFromInput);
    }
  }
}
