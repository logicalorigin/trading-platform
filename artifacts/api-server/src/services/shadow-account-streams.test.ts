import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./shadow-account-streams.ts", import.meta.url), "utf8");

test("shadow account stream snapshot uses live quote hydration", () => {
  const start = source.indexOf("export async function fetchShadowAccountSnapshotBase");
  assert.notEqual(start, -1, "Missing fetchShadowAccountSnapshotBase");
  const nextFunction = source.indexOf("\nexport function", start + 1);
  const body = source.slice(start, nextFunction === -1 ? undefined : nextFunction);

  assert.match(body, /getShadowAccountPositions\(\{ liveQuotes: true \}\)/);
  assert.doesNotMatch(body, /getShadowAccountPositions\(\{ liveQuotes: false \}\)/);
});
