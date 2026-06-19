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

test("algo cockpit pressure fallback serves the primary payload (not relabeled full-fresh)", () => {
  const start = source.indexOf("export async function fetchAlgoCockpitStreamPayload");
  assert.notEqual(start, -1, "Missing cockpit stream payload builder");
  const end = source.indexOf("\nexport function subscribeAlgoCockpitSnapshots", start + 1);
  assert.notEqual(end, -1, "Missing cockpit subscription builder");
  const fallbackEnd = source.indexOf("const target = await resolveAlgoCockpitTarget", start);
  const fallback = source.slice(start, fallbackEnd === -1 ? end : fallbackEnd);

  // Gate is still checked against the pressure snapshot.
  assert.match(
    fallback,
    /shouldUsePrimaryOnlyAlgoCockpitPayload\(getApiResourcePressureSnapshot\(\)\)/,
  );
  // Under pressure it returns the primary-only payload as-is (phase:"primary"),
  // and must NOT relabel it phase:"full" (that would set algoFullFresh on the
  // client and disable the HTTP cockpit refetch, so KPIs would never repopulate).
  assert.match(fallback, /return fetchAlgoCockpitPrimaryPayload\(input, stream\)/);
  assert.doesNotMatch(fallback, /phase: "full"/);
});
