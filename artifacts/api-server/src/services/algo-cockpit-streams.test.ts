import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./algo-cockpit-streams.ts", import.meta.url), "utf8");

test("algo cockpit stream stays full-fidelity under high pressure", () => {
  const start = source.indexOf("export function shouldUsePrimaryOnlyAlgoCockpitPayload");
  assert.notEqual(start, -1, "Missing pressure gate");
  const end = source.indexOf("\nasync function", start + 1);
  const body = source.slice(start, end === -1 ? undefined : end);

  assert.match(body, /return false/);
  assert.doesNotMatch(body, /level === "high"/);
});

test("algo cockpit stream does not use pressure to serve primary-only payloads", () => {
  const start = source.indexOf("export async function fetchAlgoCockpitStreamPayload");
  assert.notEqual(start, -1, "Missing cockpit stream payload builder");
  const end = source.indexOf("\nexport function subscribeAlgoCockpitSnapshots", start + 1);
  assert.notEqual(end, -1, "Missing cockpit subscription builder");
  const fallbackEnd = source.indexOf("const target = await resolveAlgoCockpitTarget", start);
  const fallback = source.slice(start, fallbackEnd === -1 ? end : fallbackEnd);

  assert.doesNotMatch(fallback, /getApiResourcePressureSnapshot/);
  assert.doesNotMatch(fallback, /shouldUsePrimaryOnlyAlgoCockpitPayload/);
  assert.doesNotMatch(fallback, /return fetchAlgoCockpitPrimaryPayload\(input, stream\)/);
  assert.doesNotMatch(fallback, /phase: "full"/);
});
