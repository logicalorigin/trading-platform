import { open, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";

async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export interface FlightRecorderSnapshot {
  recorderDir: string;
  apiCurrent: unknown; // api-current.json — API heartbeat (pid, memoryMb, apiPressure, dbPool, requests)
  supervisorCurrent: unknown; // current.json — supervisor heartbeat (pids, lifecycle, children)
  present: { apiCurrent: boolean; supervisorCurrent: boolean };
}

export async function readFlightRecorder(): Promise<FlightRecorderSnapshot> {
  const dir = config.flightRecorderDir;
  const apiCurrent = await readJsonFile(path.join(dir, "api-current.json"));
  const supervisorCurrent = await readJsonFile(path.join(dir, "current.json"));
  return {
    recorderDir: dir,
    apiCurrent,
    supervisorCurrent,
    present: {
      apiCurrent: apiCurrent !== null,
      supervisorCurrent: supervisorCurrent !== null,
    },
  };
}

export interface TailResult {
  file: string;
  lines: unknown[];
  truncated: boolean;
}

/** Bounded tail: reads only the last `maxBytes` of a (possibly huge) jsonl file. */
async function tailJsonl(file: string, maxLines: number, maxBytes: number): Promise<TailResult> {
  let handle;
  try {
    handle = await open(file, "r");
  } catch {
    return { file, lines: [], truncated: false };
  }
  try {
    const { size } = await handle.stat();
    const readBytes = Math.min(size, maxBytes);
    const start = size - readBytes;
    const buf = Buffer.alloc(readBytes);
    await handle.read(buf, 0, readBytes, start);
    const rawLines = buf
      .toString("utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    const startedMidFile = start > 0;
    // A mid-file start means the first line is probably partial — drop it.
    if (startedMidFile && rawLines.length > 0) {
      rawLines.shift();
    }
    const tail = rawLines.slice(-maxLines);
    const lines = tail.map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return { _unparsed: line };
      }
    });
    return { file, lines, truncated: startedMidFile || rawLines.length > maxLines };
  } finally {
    await handle.close();
  }
}

export async function readIncidents(tailLines: number): Promise<TailResult> {
  return tailJsonl(path.join(config.flightRecorderDir, "incidents.jsonl"), tailLines, 64 * 1024);
}
