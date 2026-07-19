import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

export const config = {
  // Where the PYRUS API lives. Default assumes co-location in this workspace.
  apiBaseUrl: strEnv("PYRUS_MCP_API_BASE_URL", "http://localhost:8080").replace(/\/+$/u, ""),
  apiTimeoutMs: intEnv("PYRUS_MCP_API_TIMEOUT_MS", 20_000),
  // Backstop so a giant payload can't blow the LLM context. ~32 KB.
  maxResponseBytes: intEnv("PYRUS_MCP_MAX_RESPONSE_BYTES", 32_768),
  // Matches runtime-flight-recorder.ts default.
  flightRecorderDir: strEnv(
    "PYRUS_FLIGHT_RECORDER_DIR",
    path.join(repoRoot, ".pyrus-runtime", "flight-recorder"),
  ),
} as const;

// Canonical dev ports — pinned from .replit, runDevApp.mjs, reap-dev-port.mjs.
export const CANONICAL_PORTS: ReadonlyArray<{ port: number; role: string }> = [
  { port: 8080, role: "api" },
  { port: 18747, role: "web/preview" },
  { port: 18768, role: "pyrus_compute" },
  { port: 18770, role: "pyrus_compute" },
];
