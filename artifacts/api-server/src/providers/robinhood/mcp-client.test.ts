import assert from "node:assert/strict";
import test from "node:test";

import { RobinhoodMcpSession } from "./mcp-client";

const MCP_URL = "https://agent.robinhood.com/mcp/trading";

type RecordedRequest = {
  headers: Headers;
  payload: Record<string, unknown>;
};

function jsonRpcResponse(
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sseResponse(messages: unknown[]): Response {
  const body = messages
    .map((message) => `event: message\ndata: ${JSON.stringify(message)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function buildFetchScript(
  responder: (request: RecordedRequest, index: number) => Response,
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(String(url), MCP_URL);
    const recorded: RecordedRequest = {
      headers: new Headers(init?.headers),
      payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    requests.push(recorded);
    return responder(recorded, requests.length - 1);
  };
  return { fetchImpl, requests };
}

function defaultResponder(request: RecordedRequest): Response {
  if (request.payload["method"] === "initialize") {
    return jsonRpcResponse(
      {
        jsonrpc: "2.0",
        id: request.payload["id"],
        result: { protocolVersion: "2025-03-26" },
      },
      { "Mcp-Session-Id": "session-1" },
    );
  }
  return new Response(null, { status: 202 });
}

test("initialize captures the MCP session id and sends the initialized notification", async () => {
  const { fetchImpl, requests } = buildFetchScript(defaultResponder);
  const session = new RobinhoodMcpSession({ accessToken: "tok", fetchImpl });
  await session.initialize();

  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.payload["method"], "initialize");
  assert.equal(requests[0]!.headers.get("Authorization"), "Bearer tok");
  assert.equal(requests[1]!.payload["method"], "notifications/initialized");
  assert.equal(requests[1]!.headers.get("Mcp-Session-Id"), "session-1");
});

test("callTool prefers structuredContent and forwards tool arguments", async () => {
  const { fetchImpl, requests } = buildFetchScript((request) => {
    if (request.payload["method"] === "tools/call") {
      return jsonRpcResponse({
        jsonrpc: "2.0",
        id: request.payload["id"],
        result: {
          content: [{ type: "text", text: '{"ignored":true}' }],
          structuredContent: { accounts: [{ id: "acct-1" }] },
        },
      });
    }
    return defaultResponder(request);
  });
  const session = new RobinhoodMcpSession({ accessToken: "tok", fetchImpl });

  const result = await session.callTool({
    name: "get_accounts",
    arguments: { cursor: null },
  });

  assert.deepEqual(result, { accounts: [{ id: "acct-1" }] });
  const call = requests.find(
    (request) => request.payload["method"] === "tools/call",
  );
  assert.deepEqual(call?.payload["params"], {
    name: "get_accounts",
    arguments: { cursor: null },
  });
});

test("callTool parses SSE-framed responses and JSON text content", async () => {
  const { fetchImpl } = buildFetchScript((request) => {
    if (request.payload["method"] === "tools/call") {
      return sseResponse([
        { jsonrpc: "2.0", id: 999, result: { content: [] } },
        {
          jsonrpc: "2.0",
          id: request.payload["id"],
          result: {
            content: [{ type: "text", text: '{"accounts":[{"id":"acct-2"}]}' }],
          },
        },
      ]);
    }
    return defaultResponder(request);
  });
  const session = new RobinhoodMcpSession({ accessToken: "tok", fetchImpl });

  const result = await session.callTool({ name: "get_accounts" });
  assert.deepEqual(result, { accounts: [{ id: "acct-2" }] });
});

test("callTool surfaces tool errors and 401s as HttpErrors", async () => {
  const { fetchImpl } = buildFetchScript((request) => {
    if (request.payload["method"] === "tools/call") {
      return jsonRpcResponse({
        jsonrpc: "2.0",
        id: request.payload["id"],
        result: {
          isError: true,
          content: [{ type: "text", text: "tool exploded" }],
        },
      });
    }
    return defaultResponder(request);
  });
  const session = new RobinhoodMcpSession({ accessToken: "tok", fetchImpl });
  await assert.rejects(
    session.callTool({ name: "get_accounts" }),
    (error: unknown) =>
      (error as { code?: string }).code === "robinhood_mcp_tool_error",
  );

  const unauthorized = new RobinhoodMcpSession({
    accessToken: "bad",
    fetchImpl: async () => new Response("authentication required", { status: 401 }),
  });
  await assert.rejects(
    unauthorized.callTool({ name: "get_accounts" }),
    (error: unknown) =>
      (error as { code?: string }).code === "robinhood_mcp_unauthorized",
  );
});
