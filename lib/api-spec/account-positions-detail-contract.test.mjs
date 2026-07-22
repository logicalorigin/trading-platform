import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const openApiSource = readFileSync(
  new URL("./openapi.yaml", import.meta.url),
  "utf8",
);
const generatedTypesSource = readFileSync(
  new URL("../api-client-react/src/generated/api.schemas.ts", import.meta.url),
  "utf8",
);
const generatedZodSource = readFileSync(
  new URL("../api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing ${endMarker}`);
  return source.slice(start, end);
}

test("account positions publishes the fast/full detail query contract", () => {
  const operation = sourceSection(
    openApiSource,
    "  /accounts/{accountId}/positions:\n",
    "  /accounts/{accountId}/positions-at-date:\n",
  );

  assert.match(operation, /- name: detail\n\s+in: query\n\s+required: false/);
  assert.match(operation, /enum: \[fast, full\]/);
  assert.match(operation, /default: full/);
  assert.match(operation, /fast[\s\S]*full[\s\S]*Defaults to `full`/);
});

test("generated account positions clients expose the detail query", () => {
  const params = sourceSection(
    generatedTypesSource,
    "export type GetAccountPositionsParams = {\n",
    "export type GetAccountPositionsAtDateParams = {\n",
  );
  assert.match(params, /detail\?: GetAccountPositionsDetail;/);
  assert.match(
    generatedTypesSource,
    /export const GetAccountPositionsDetail = \{[\s\S]*fast: 'fast',[\s\S]*full: 'full',[\s\S]*\} as const;/,
  );

  const querySchema = sourceSection(
    generatedZodSource,
    "export const GetAccountPositionsQueryParams = zod.object({\n",
    "export const GetAccountPositionsResponse = zod.object({\n",
  );
  assert.match(querySchema, /"detail": zod\.enum\(\['fast', 'full'\]\)/);
});
