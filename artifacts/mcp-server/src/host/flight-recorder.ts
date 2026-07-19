import { readFile } from "node:fs/promises";
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
  present: { apiCurrent: boolean };
}

export async function readFlightRecorder(): Promise<FlightRecorderSnapshot> {
  const dir = config.flightRecorderDir;
  const apiCurrent = await readJsonFile(path.join(dir, "api-current.json"));
  return {
    recorderDir: dir,
    apiCurrent,
    present: {
      apiCurrent: apiCurrent !== null,
    },
  };
}
