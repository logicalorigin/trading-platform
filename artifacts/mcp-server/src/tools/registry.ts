import { z } from "zod";
import {
  GetReadinessResponse,
  GetRuntimeDiagnosticsResponse,
  GetLatestDiagnosticsResponse,
} from "@workspace/api-zod";

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
}

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
];
