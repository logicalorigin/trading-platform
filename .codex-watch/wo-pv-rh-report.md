# WO-PV-RH Report

## Finding

Confirmed real. Before editing, an injected `fetchImpl` in `RobinhoodMcpSession.initialize()` received no `AbortSignal`, and `post()` awaited `this.fetchImpl(...)` directly. A fetch that never settles could therefore keep Robinhood MCP broker operations pending indefinitely.

Pre-edit verification:

```sh
pnpm --filter @workspace/api-server exec tsx -e 'import assert from "node:assert/strict"; import { RobinhoodMcpSession } from "./src/providers/robinhood/mcp-client.ts"; void (async () => { let sawSignal = false; const fetchImpl: typeof fetch = async (_url, init) => { sawSignal = !!init?.signal; throw new Error("stop"); }; const session = new RobinhoodMcpSession({ accessToken: "tok", fetchImpl, mcpUrl: "https://example.test/mcp" }); await assert.rejects(() => session.initialize(), (error: unknown) => (error as { code?: string }).code === "robinhood_mcp_network_error"); assert.equal(sawSignal, false); })();'
```

Result: exit 0.

## Change

Updated `artifacts/api-server/src/providers/robinhood/mcp-client.ts` only.

- Added a default 15s Robinhood MCP request timeout configurable with `requestTimeoutMs`.
- Added optional per-call `timeoutMs` overrides on `initialize`, `listTools`, and `callTool`.
- Added an `AbortController` in `post()` and passed its signal through the existing `fetchImpl` seam.
- On timeout, aborts the request and throws `RobinhoodMcpTimeoutError` with code `robinhood_mcp_request_timeout`.
- Preserved existing non-timeout network, auth, invalid-response, and tool-error handling.

Allowed diff summary:

```text
.../src/providers/robinhood/mcp-client.ts          | 124 +++++++++++++++++----
1 file changed, 100 insertions(+), 24 deletions(-)
```

## Tests

Targeted hanging-fetch timeout probe:

```sh
pnpm --filter @workspace/api-server exec tsx -e 'import assert from "node:assert/strict"; import { RobinhoodMcpSession, ROBINHOOD_MCP_TIMEOUT_CODE } from "./src/providers/robinhood/mcp-client.ts"; void (async () => { let aborted = false; let sawSignal = false; const fetchImpl: typeof fetch = async (_url, init) => { const signal = init?.signal; sawSignal = signal instanceof AbortSignal; assert.equal(sawSignal, true); return await new Promise<Response>((_resolve, reject) => { signal?.addEventListener("abort", () => { aborted = true; reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }); }); }; const session = new RobinhoodMcpSession({ accessToken: "tok", fetchImpl, mcpUrl: "https://example.test/mcp", requestTimeoutMs: 10_000 }); const startedAt = Date.now(); await assert.rejects(() => session.initialize({ timeoutMs: 25 }), (error: unknown) => { assert.equal((error as { code?: string }).code, ROBINHOOD_MCP_TIMEOUT_CODE); assert.equal((error as { timeoutMs?: number }).timeoutMs, 25); return true; }); const elapsedMs = Date.now() - startedAt; assert.equal(sawSignal, true); assert.equal(aborted, true); assert.ok(elapsedMs < 1_000, `timeout took ${elapsedMs}ms`); })();'
```

Result: exit 0, no stdout.

Existing Robinhood MCP unit file:

```sh
pnpm --filter @workspace/api-server exec tsx --test src/providers/robinhood/mcp-client.test.ts
```

Output:

```text
✔ initialize captures the MCP session id and sends the initialized notification (45.627793ms)
✔ callTool prefers structuredContent and forwards tool arguments (2.65936ms)
✔ callTool parses SSE-framed responses and JSON text content (2.821143ms)
✔ callTool surfaces tool errors and 401s as HttpErrors (3.368806ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6475.592612
```
