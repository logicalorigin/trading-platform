import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./algo-cockpit-streams.ts", import.meta.url), "utf8");

test("algo cockpit stream downgrades full payload builds under high pressure", () => {
  const start = source.indexOf("export function shouldUsePrimaryOnlyAlgoCockpitPayload");
  assert.notEqual(start, -1, "Missing pressure gate");
  const end = source.indexOf("\nasync function", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);

  assert.match(body, /level === "high"/);
  assert.doesNotMatch(body, /return false/);
});

test("algo cockpit pressure fallback marks stream full-fresh without heavy sections", () => {
  const start = source.indexOf("export async function fetchAlgoCockpitStreamPayload");
  assert.notEqual(start, -1, "Missing cockpit stream payload builder");
  const end = source.indexOf("\nexport function subscribeAlgoCockpitSnapshots", start + 1);
  assert.notEqual(end, -1, "Missing cockpit subscription builder");
  const body = source.slice(start, end);

  assert.match(body, /shouldUsePrimaryOnlyAlgoCockpitPayload\(getApiResourcePressureSnapshot\(\)\)/);
  assert.match(body, /phase: "full"/);
  assert.match(body, /signalOptionsState: null/);
  assert.match(body, /cockpit: null/);
  assert.match(body, /performance: null/);
  assert.match(body, /signalMonitorProfile: null/);
});
