import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./app.ts", import.meta.url), "utf8");

test("bridge accepts large market-data generation payloads", () => {
  assert.match(source, /const BRIDGE_REQUEST_BODY_LIMIT = "2mb"/);
  assert.match(source, /express\.json\(\{\s*limit: BRIDGE_REQUEST_BODY_LIMIT\s*\}\)/);
  assert.match(
    source,
    /express\.urlencoded\(\{\s*extended: true,\s*limit: BRIDGE_REQUEST_BODY_LIMIT\s*\}\)/,
  );
});
