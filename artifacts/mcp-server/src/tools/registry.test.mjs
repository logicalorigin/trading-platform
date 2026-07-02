import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { httpTools } from "./registry.ts";

const openapiPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../lib/api-spec/openapi.yaml",
);
const openapi = readFileSync(openapiPath, "utf8");

test("registry is non-empty and names are unique", () => {
  assert.ok(httpTools.length > 0);
  const names = httpTools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "tool names must be unique");
});

test("every HTTP tool is read-only (GET) with a valid endpoint", () => {
  for (const tool of httpTools) {
    assert.equal(tool.method, "GET", `${tool.name} must be GET (read-only)`);
    assert.ok(tool.endpoint.startsWith("/"), `${tool.name} endpoint must start with /`);
  }
});

test("every tool references a resolvable api-zod response schema", () => {
  for (const tool of httpTools) {
    assert.equal(
      typeof tool.responseSchema?.parse,
      "function",
      `${tool.name} responseSchema must be a zod schema (api-zod export missing/renamed?)`,
    );
  }
});

test("every endpoint + operationId exists in openapi.yaml", () => {
  for (const tool of httpTools) {
    assert.ok(
      openapi.includes(`\n  ${tool.endpoint}:`),
      `${tool.name}: path "${tool.endpoint}" not found as a key in openapi.yaml`,
    );
    assert.ok(
      openapi.includes(`operationId: ${tool.operationId}`),
      `${tool.name}: operationId "${tool.operationId}" not found in openapi.yaml`,
    );
  }
});
