import assert from "node:assert/strict";
import test from "node:test";

import {
  GetResearchHighBetaUniverseQueryParams,
  SearchUniverseTickersQueryParams,
} from "./generated/api.ts";

test("boolean query schemas parse explicit false strings as false", () => {
  assert.deepEqual(
    SearchUniverseTickersQueryParams.pick({ active: true, strictTrade: true }).parse({
      active: "false",
      strictTrade: "false",
    }),
    { active: false, strictTrade: false },
  );
  assert.deepEqual(
    GetResearchHighBetaUniverseQueryParams.pick({ dryRun: true, refresh: true }).parse({
      dryRun: "false",
      refresh: "false",
    }),
    { dryRun: false, refresh: false },
  );
});

test("boolean query schemas reject non-boolean strings", () => {
  assert.throws(() =>
    SearchUniverseTickersQueryParams.pick({ active: true }).parse({
      active: "definitely",
    }),
  );
});
