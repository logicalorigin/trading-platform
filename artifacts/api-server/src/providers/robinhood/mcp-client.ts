import { HttpError } from "../../lib/errors";
import { ROBINHOOD_TRADING_MCP_URL } from "../../services/robinhood-oauth";

// Minimal MCP client over Streamable HTTP (spec rev 2025-03-26) for the
// Robinhood Agentic Trading server. Servers may answer a JSON-RPC POST with
// either application/json or a text/event-stream body carrying the response
// message; both are handled here.
const MCP_PROTOCOL_VERSION = "2025-03-26";

export type RobinhoodMcpSessionOptions = {
  accessToken: string;
  fetchImpl?: typeof fetch;
  mcpUrl?: string;
  requestTimeoutMs?: number;
};

export type RobinhoodMcpToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
};

export type RobinhoodMcpRequestOptions = {
  timeoutMs?: number;
};

export type RobinhoodMcpToolSummary = {
  name: string;
  description: string | null;
};

type JsonRpcResponse = {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string };
};

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const ROBINHOOD_MCP_TIMEOUT_CODE = "robinhood_mcp_request_timeout";

export class RobinhoodMcpTimeoutError extends HttpError {
  readonly timeoutMs: number;

  constructor(input: { timeoutMs: number }) {
    super(504, "Robinhood MCP request timed out", {
      code: ROBINHOOD_MCP_TIMEOUT_CODE,
      expose: false,
      data: { timeoutMs: input.timeoutMs },
    });
    this.name = "RobinhoodMcpTimeoutError";
    this.timeoutMs = input.timeoutMs;
  }
}

export function isRobinhoodMcpTimeoutError(
  error: unknown,
): error is RobinhoodMcpTimeoutError {
  return error instanceof RobinhoodMcpTimeoutError;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseSseResponseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of body.split(/\n\n/u)) {
    const dataLines = event
      .split(/\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    if (!dataLines.length) {
      continue;
    }
    try {
      messages.push(JSON.parse(dataLines.join("\n")) as unknown);
    } catch {
      // Non-JSON SSE data (e.g. keepalives) is ignored.
    }
  }
  return messages;
}

export class RobinhoodMcpSession {
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly mcpUrl: string;
  private readonly requestTimeoutMs: number;
  private sessionId: string | null = null;
  private initialized = false;
  private nextRequestId = 1;

  constructor(options: RobinhoodMcpSessionOptions) {
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.mcpUrl = options.mcpUrl ?? ROBINHOOD_TRADING_MCP_URL;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    if (this.initialized) {
      headers["MCP-Protocol-Version"] = MCP_PROTOCOL_VERSION;
    }
    return headers;
  }

  private async post(
    payload: Record<string, unknown>,
    options: RobinhoodMcpRequestOptions = {},
  ): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let response: Response;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new RobinhoodMcpTimeoutError({ timeoutMs }));
        }, timeoutMs);
        timeout.unref?.();
      });
      const fetchPromise = this.fetchImpl(this.mcpUrl, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).then(
        (value) => value,
        (error: unknown) => {
          if (timedOut || controller.signal.aborted) {
            throw new RobinhoodMcpTimeoutError({ timeoutMs });
          }
          throw error;
        },
      );
      response = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      if (isRobinhoodMcpTimeoutError(error)) {
        throw error;
      }
      throw new HttpError(502, "Robinhood MCP request failed", {
        code: "robinhood_mcp_network_error",
        expose: false,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, "Robinhood MCP authorization was rejected", {
        code: "robinhood_mcp_unauthorized",
      });
    }
    return response;
  }

  private async postRequest(
    method: string,
    params: Record<string, unknown>,
    options: RobinhoodMcpRequestOptions = {},
  ): Promise<unknown> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const response = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method,
        params,
      },
      options,
    );

    if (!response.ok) {
      throw new HttpError(502, "Robinhood MCP request failed", {
        code: "robinhood_mcp_request_failed",
        expose: false,
        data: { method, status: response.status },
      });
    }

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const messages: unknown[] = contentType.includes("text/event-stream")
      ? parseSseResponseMessages(body)
      : (() => {
          try {
            return [JSON.parse(body) as unknown];
          } catch {
            return [];
          }
        })();

    const match = messages
      .map((message) => asRecord(message))
      .find((message) => message["id"] === id) as JsonRpcResponse | undefined;
    if (!match) {
      throw new HttpError(502, "Robinhood MCP returned an invalid response", {
        code: "robinhood_mcp_invalid_response",
        expose: false,
        data: { method },
      });
    }
    if (match.error) {
      throw new HttpError(502, "Robinhood MCP request was rejected", {
        code: "robinhood_mcp_request_rejected",
        expose: false,
        data: { method, upstreamMessage: match.error.message ?? null },
      });
    }
    return match.result;
  }

  private async postNotification(
    method: string,
    options: RobinhoodMcpRequestOptions = {},
  ): Promise<void> {
    const response = await this.post({ jsonrpc: "2.0", method }, options);
    // Notifications expect 202/200 with no body; drain defensively.
    await response.text().catch(() => undefined);
  }

  async initialize(options: RobinhoodMcpRequestOptions = {}): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.postRequest("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pyrus-api-server", version: "1.0" },
    }, options);
    this.initialized = true;
    await this.postNotification("notifications/initialized", options);
  }

  async listTools(
    options: RobinhoodMcpRequestOptions = {},
  ): Promise<RobinhoodMcpToolSummary[]> {
    await this.initialize(options);
    const result = asRecord(await this.postRequest("tools/list", {}, options));
    const tools = Array.isArray(result["tools"]) ? result["tools"] : [];
    return tools.map((tool) => {
      const record = asRecord(tool);
      return {
        name: typeof record["name"] === "string" ? record["name"] : "",
        description:
          typeof record["description"] === "string"
            ? record["description"]
            : null,
      };
    });
  }

  /**
   * Calls a tool and returns its payload: structuredContent when present,
   * otherwise the first text content block parsed as JSON (falling back to the
   * raw text when it is not JSON).
   */
  async callTool(
    call: RobinhoodMcpToolCall,
    options: RobinhoodMcpRequestOptions = {},
  ): Promise<unknown> {
    await this.initialize(options);
    const result = asRecord(
      await this.postRequest(
        "tools/call",
        {
          name: call.name,
          arguments: call.arguments ?? {},
        },
        options,
      ),
    );

    const contentBlocks = Array.isArray(result["content"])
      ? result["content"]
      : [];
    const firstText = contentBlocks
      .map((block) => asRecord(block))
      .find((block) => block["type"] === "text" && typeof block["text"] === "string");

    if (result["isError"] === true) {
      throw new HttpError(502, "Robinhood MCP tool call failed", {
        code: "robinhood_mcp_tool_error",
        expose: false,
        data: {
          tool: call.name,
          upstreamMessage:
            typeof firstText?.["text"] === "string" ? firstText["text"] : null,
        },
      });
    }

    if (result["structuredContent"] !== undefined) {
      return result["structuredContent"];
    }
    if (typeof firstText?.["text"] === "string") {
      try {
        return JSON.parse(firstText["text"]) as unknown;
      } catch {
        return firstText["text"];
      }
    }
    return null;
  }
}
