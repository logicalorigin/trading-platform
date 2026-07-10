import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./bridge-streams.ts", import.meta.url),
  "utf8",
);

function functionSource(name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return source.slice(start, nextExport >= 0 ? nextExport : source.length);
}

test("order stream snapshots propagate the canonical broker read", () => {
  const body = functionSource("fetchOrderSnapshotPayload");

  assert.match(body, /orders:\s*await listIbkrOrders\(input\)/);
  assert.doesNotMatch(body, /Promise\.race|orderSnapshotCache|ReadSuppression/);
  assert.doesNotMatch(
    body,
    /isWorkBackedOff|isTransientWorkError|orders:\s*\[\]/,
  );
});
