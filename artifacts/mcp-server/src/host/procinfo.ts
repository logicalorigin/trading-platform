import { readFile } from "node:fs/promises";
import { CANONICAL_PORTS } from "../config";

function parseListeningPorts(content: string): number[] {
  const ports: number[] = [];
  const lines = content.split("\n").slice(1); // drop header
  for (const line of lines) {
    const cols = line.trim().split(/\s+/u);
    if (cols.length < 4) continue;
    const local = cols[1]; // hex "IP:PORT"
    const state = cols[3]; // 0A = LISTEN
    if (state !== "0A" || local === undefined) continue;
    const portHex = local.split(":")[1];
    if (portHex === undefined) continue;
    const port = parseInt(portHex, 16);
    if (Number.isInteger(port)) ports.push(port);
  }
  return ports;
}

async function readListeningPorts(): Promise<Set<number>> {
  const ports = new Set<number>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const content = await readFile(file, "utf8");
      for (const port of parseListeningPorts(content)) ports.add(port);
    } catch {
      // ignore unavailable proc files
    }
  }
  return ports;
}

export interface PortBindings {
  canonical: Array<{ port: number; role: string; listening: boolean }>;
  note: string;
}

export async function readPortBindings(): Promise<PortBindings> {
  const listening = await readListeningPorts();
  const canonical = CANONICAL_PORTS.map((entry) => ({
    ...entry,
    listening: listening.has(entry.port),
  }));
  const apiUp = canonical.find((c) => c.port === 8080)?.listening ?? false;
  return {
    canonical,
    note: apiUp
      ? "API port 8080 is LISTENing."
      : "API port 8080 is NOT LISTENing — the API process is down or not bound.",
  };
}

// Test-only surface (consumed by procinfo.test.mjs).
export const __procinfoInternalsForTests = { parseListeningPorts };
