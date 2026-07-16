import assert from "node:assert/strict";
import test from "node:test";

import { fixBooleanQueryCoercion } from "./fix-api-zod-index.mjs";

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
