import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as postprocessor from "./fix-api-zod-index.mjs";

const { fixBooleanQueryCoercion } = postprocessor;

test("normalizes boolean query coercion with current Orval quote style", () => {
  const fixed = fixBooleanQueryCoercion(`
import * as zod from "zod";
export const Query = zod.coerce
  .boolean();
`);

  assert.match(fixed, /const booleanQueryParam = zod\.preprocess/);
  assert.doesNotMatch(fixed, /zod\.coerce\.boolean\(\)/);
  assert.match(fixed, /export const Query = booleanQueryParam/);
});

test("Zod codegen does not emit a duplicate TypeScript schema tree", async () => {
  const config = await readFile(
    new URL("./orval.config.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(config, /^\s+schemas\s*:/mu);
});

test("removes Orval's unused schema exports from the public Zod index", () => {
  assert.equal(typeof postprocessor.removeGeneratedSchemaExports, "function");

  const fixed = postprocessor.removeGeneratedSchemaExports(`
export * from "./generated/types";
export * from './generated/api.schemas';
export * from "./generated/api";
`);

  assert.equal(fixed, '\nexport * from "./generated/api";\n');
});
