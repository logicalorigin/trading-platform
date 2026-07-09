import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config";
import { log } from "./log";
import { apiGet } from "./http/api-client";
import { ok, fail, fromHttpError } from "./tools/result";
import { httpTools } from "./tools/registry";
import { hostTools } from "./tools/host-tools";
import { diagnosticEventsTool } from "./tools/diagnostic-events";

const server = new McpServer({
  name: "pyrus-diagnostics",
  version: "0.1.0",
});

// Public read-only HTTP diagnostics.
for (const tool of httpTools) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const data = await apiGet(tool.endpoint);
        return ok(data);
      } catch (error) {
        return fromHttpError(tool.endpoint, error);
      }
    },
  );
}

// Direct DB read: the HTTP endpoint is intentionally user-authenticated.
server.registerTool(
  diagnosticEventsTool.name,
  {
    description: diagnosticEventsTool.description,
    inputSchema: diagnosticEventsTool.inputShape,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  (args: Record<string, unknown>) => diagnosticEventsTool.run(args ?? {}),
);

// Subsystem 3: read-only host/supervisor introspection (no signals).
for (const tool of hostTools) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args: Record<string, unknown>) => {
      try {
        return ok(await tool.run(args ?? {}));
      } catch (error) {
        return fail(`${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is the MCP wire; status goes to stderr only.
  log.info(
    `ready (stdio) — ${httpTools.length} http + 1 db + ${hostTools.length} host tools; API=${config.apiBaseUrl}`,
  );
}

main().catch((error: unknown) => {
  log.error("fatal", error);
  process.exit(1);
});
