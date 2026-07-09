import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidatesForMode } from "./optimizer";

test("walk-forward sampling avoids materializing grids above its 100-candidate threshold", () => {
  const guardedValues = new Proxy(
    Array.from({ length: 11 }, (_, index) => index),
    {
      get(target, property, receiver) {
        if (property === "map") {
          throw new Error("oversized grid was materialized");
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );

  const candidates = buildCandidatesForMode(
    "walk_forward",
    {},
    [
      { key: "first", values: guardedValues },
      { key: "second", values: Array.from({ length: 10 }, (_, index) => index) },
    ],
    4,
  );

  assert.ok(candidates.length > 0 && candidates.length <= 4);
});
