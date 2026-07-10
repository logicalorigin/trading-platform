import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const spec = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);

const schemaBlock = (name) => {
  const start = spec.indexOf(`    ${name}:`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const next = /^    [A-Za-z0-9]+:/gm;
  next.lastIndex = start + name.length + 5;
  const end = next.exec(spec)?.index ?? spec.length;
  return spec.slice(start, end);
};

test("Account order contracts omit retired fallback metadata", () => {
  for (const name of ["AccountOrdersResponse", "OrdersResponse"]) {
    const schema = schemaBlock(name);
    for (const field of ["degraded", "reason", "stale", "debug"]) {
      assert.doesNotMatch(schema, new RegExp(`^        ${field}:`, "m"));
    }
  }
});

test("Account equity history no longer advertises runtime fallback data", () => {
  assert.doesNotMatch(schemaBlock("AccountEquityHistoryResponse"), /runtime_fallback/);
});
