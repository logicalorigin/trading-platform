import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

test("account position source documents provider-aware provenance", () => {
  const start = source.indexOf("    AccountPositionRow:\n");
  const end = source.indexOf("\n    AccountPositionsResponse:\n", start);
  assert.notEqual(start, -1, "Missing AccountPositionRow schema");
  assert.notEqual(end, -1, "Missing AccountPositionRow schema boundary");
  const schema = source.slice(start, end);
  const sourcePropertyStart = schema.indexOf("        source:\n");
  const sourcePropertyEnd = schema.indexOf("        sourceType:\n", sourcePropertyStart);
  const sourceProperty = schema.slice(sourcePropertyStart, sourcePropertyEnd);

  for (const value of [
    "IBKR_POSITIONS",
    "SNAPTRADE_POSITIONS",
    "ROBINHOOD_POSITIONS",
    "SCHWAB_POSITIONS",
    "BROKER_POSITIONS",
    "MIXED_BROKER_POSITIONS",
  ]) {
    assert.match(sourceProperty, new RegExp(value));
  }
});
