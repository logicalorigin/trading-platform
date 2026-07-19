import { z } from "zod";
import { readFlightRecorder } from "../host/flight-recorder";
import { readPortBindings } from "../host/procinfo";
import { checkHealthz } from "../host/healthz";

/**
 * A read-only host tool. Unlike HttpTools these read local files, /proc, and one
 * localhost healthz probe — there is no OpenAPI for them, so the input schema is
 * hand-authored. They never send signals or mutate anything.
 */
export interface HostTool {
  name: string;
  description: string;
  inputShape: z.ZodRawShape;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

export const hostTools: HostTool[] = [
  {
    name: "get_flight_recorder",
    description:
      "Current API flight-recorder heartbeat (pid, uptime, memoryMb, apiPressure, dbPool, requests) from api-current.json.",
    inputShape: {},
    run: () => readFlightRecorder(),
  },
  {
    name: "get_port_bindings",
    description:
      "Which canonical dev ports are currently LISTENing (API 8080, web/preview 18747, pyrus_compute 18768/18770), parsed read-only from /proc/net/tcp. Use to confirm the API/web/compute are actually bound.",
    inputShape: {},
    run: () => readPortBindings(),
  },
  {
    name: "check_healthz",
    description:
      "Probe GET /api/healthz on the local API (200 = serving). The cheapest liveness check.",
    inputShape: {},
    run: () => checkHealthz(),
  },
];
