import { z } from "zod";
import { readFlightRecorder, readIncidents } from "../host/flight-recorder";
import { readSupervisorState, readPortBindings } from "../host/procinfo";
import { checkHealthz } from "../host/healthz";

/**
 * A read-only host/supervisor tool. Unlike HttpTools these read local files,
 * /proc, and one localhost healthz probe — there is no OpenAPI for them, so the
 * input schema is hand-authored. They never send signals or mutate anything.
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
      "Current flight-recorder heartbeat: API process (pid, uptime, memoryMb, apiPressure, dbPool, requests) from api-current.json and the dev supervisor from current.json. The live runtime snapshot.",
    inputShape: {},
    run: () => readFlightRecorder(),
  },
  {
    name: "list_recorder_incidents",
    description:
      "Recent restart/incident classifications tailed from incidents.jsonl (severity, classification, evidence). Use to see why the app last restarted or degraded.",
    inputShape: {
      tailLines: z.number().int().positive().max(500).optional().describe("How many recent lines (default 50)"),
    },
    run: (args) => readIncidents(typeof args["tailLines"] === "number" ? (args["tailLines"] as number) : 50),
  },
  {
    name: "get_supervisor_state",
    description:
      "Dev/preview supervisor health: the runDevApp.mjs supervisor PIDs, whether each one's parent chain reaches pid2 (pid2Owned), and the supervisor lock file. Diagnoses the 'preview detached / crashed / ports did not open' failure mode.",
    inputShape: {},
    run: () => readSupervisorState(),
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
      "Probe GET /api/healthz on the local API (200 = serving). The cheapest liveness check; pair with get_supervisor_state when the preview looks down.",
    inputShape: {},
    run: () => checkHealthz(),
  },
];
