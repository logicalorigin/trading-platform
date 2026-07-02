import { z } from "zod";
import {
  GetReadinessResponse,
  GetRuntimeDiagnosticsResponse,
  GetLatestDiagnosticsResponse,
  ListDiagnosticEventsResponse,
  GetIbkrLineUsageResponse,
  GetIbkrLaneArchitectureResponse,
  ListBrokerConnectionsResponse,
} from "@workspace/api-zod";
import type { QueryValue } from "../http/api-client";

/**
 * A read-only HTTP diagnostic tool. `responseSchema` is the generated api-zod
 * schema for the endpoint — referencing it by named import ties each tool to the
 * OpenAPI source of truth: if codegen renames/drops the operation, this file
 * fails to compile. `method` is fixed to GET (read-only invariant).
 */
export interface HttpTool {
  name: string;
  description: string;
  method: "GET";
  endpoint: string;
  operationId: string;
  responseSchema: z.ZodTypeAny;
  inputShape: z.ZodRawShape;
  buildQuery?: (args: Record<string, unknown>) => Record<string, QueryValue>;
}

const str = (args: Record<string, unknown>, key: string): string | undefined =>
  typeof args[key] === "string" ? (args[key] as string) : undefined;

export const httpTools: HttpTool[] = [
  // --- Subsystem 1: API request routing & pressure -------------------------
  {
    name: "get_readiness",
    description:
      "Overall API readiness: liveness, app readiness, broker trading readiness, the current resource pressureLevel (normal/watch/high), and degradedReasons. Start here to see if the API is healthy or under pressure.",
    method: "GET",
    endpoint: "/readiness",
    operationId: "getReadiness",
    responseSchema: GetReadinessResponse,
    inputShape: {},
  },
  {
    name: "get_diagnostics",
    description:
      "Latest diagnostics rollup: per-subsystem snapshots, severity, open events, thresholds, and footerMemoryPressure (RSS/heap %, dominant pressure drivers). The detailed companion to get_readiness.",
    method: "GET",
    endpoint: "/diagnostics/latest",
    operationId: "getLatestDiagnostics",
    responseSchema: GetLatestDiagnosticsResponse,
    inputShape: {},
  },
  {
    name: "get_runtime_diagnostics",
    description:
      "Runtime bridge/connectivity metrics, API memory/heap/event-loop, market-data stream state, and order-capability diagnostics. Use to inspect the live process and bridge health.",
    method: "GET",
    endpoint: "/diagnostics/runtime",
    operationId: "getRuntimeDiagnostics",
    responseSchema: GetRuntimeDiagnosticsResponse,
    inputShape: {},
  },
  {
    name: "list_diagnostic_events",
    description:
      "Diagnostic events/incidents (open and resolved). Filter by subsystem, severity (info|warning), and an ISO from/to time window.",
    method: "GET",
    endpoint: "/diagnostics/events",
    operationId: "listDiagnosticEvents",
    responseSchema: ListDiagnosticEventsResponse,
    inputShape: {
      subsystem: z.string().optional().describe("Filter to one diagnostics subsystem"),
      severity: z.enum(["info", "warning"]).optional(),
      from: z.string().optional().describe("ISO timestamp lower bound"),
      to: z.string().optional().describe("ISO timestamp upper bound"),
    },
    buildQuery: (args) => ({
      subsystem: str(args, "subsystem"),
      severity: str(args, "severity"),
      from: str(args, "from"),
      to: str(args, "to"),
    }),
  },
  // --- Subsystem 2: provider / data-source routing -------------------------
  {
    name: "get_ibkr_line_usage",
    description:
      "IBKR line-usage snapshot: admission, bridge status, and quote/option-quote stream health (active consumers, reconnect counts, last-event age, data-freshness age, last error) plus provider diagnostics. The 'is the data flowing and from where' view.",
    method: "GET",
    endpoint: "/settings/ibkr-line-usage",
    operationId: "getIbkrLineUsage",
    responseSchema: GetIbkrLineUsageResponse,
    inputShape: {},
  },
  {
    name: "get_ibkr_lanes",
    description:
      "IBKR lane architecture: lane policy, nodes/edges/memberships, governor config, and bridge pressure (normal/degraded/backoff/stalled). Use to diagnose how broker requests are routed across lanes.",
    method: "GET",
    endpoint: "/settings/ibkr-lanes",
    operationId: "getIbkrLaneArchitecture",
    responseSchema: GetIbkrLaneArchitectureResponse,
    inputShape: {},
  },
  {
    name: "list_broker_connections",
    description:
      "Configured broker and market-data connections (provider, mode shadow/live, status, capabilities). The inventory of where data and orders can be routed.",
    method: "GET",
    endpoint: "/broker-connections",
    operationId: "listBrokerConnections",
    responseSchema: ListBrokerConnectionsResponse,
    inputShape: {},
  },
];
