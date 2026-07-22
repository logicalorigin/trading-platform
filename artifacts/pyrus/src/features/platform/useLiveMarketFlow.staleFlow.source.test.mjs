import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(here, "useLiveMarketFlow.js"), "utf8");
const stateSource = readFileSync(join(here, "flowSourceState.js"), "utf8");

// Preserved stale tape is only useful if the staleness flag survives every
// response boundary between mergeFlowEventsSnapshot and the screen-level
// `responses.some((response) => Boolean(response.staleFlowEvents))` read.

test("symbol responses carry staleFlowEvents through the response boundary", () => {
  assert.match(
    hookSource,
    /staleFlowEvents:\s*Boolean\(value\.staleFlowEvents\)/,
    "symbolResponses map must forward staleFlowEvents from the merged snapshot",
  );
});

test("the aggregate response builder carries staleFlowEvents", () => {
  assert.match(
    stateSource,
    /staleFlowEvents:\s*Boolean\(snapshot\?\.staleFlowEvents\)/,
    "buildAggregateFlowResponse must forward staleFlowEvents from the merged snapshot",
  );
});

test("the hook still derives screen-level staleness from responses", () => {
  assert.match(
    hookSource,
    /responses\.some\(\(response\)\s*=>\s*\n?\s*Boolean\(response\.staleFlowEvents\)/,
    "screen-level staleFlowEvents must remain derived from the responses array",
  );
});
