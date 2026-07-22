import assert from "node:assert/strict";
import test from "node:test";

import { resolveCompanyVertical, THEMES } from "./researchThemes.js";

test("regular themes preserve a valid native vertical", () => {
  assert.equal(
    resolveCompanyVertical({ v: "tactical", s: "Laser" }, THEMES.drones),
    "tactical",
  );
});

test("regular themes map an unknown native vertical by one authored sub-layer", () => {
  assert.equal(
    resolveCompanyVertical({ v: "missiles", s: "Laser" }, THEMES.drones),
    "counter",
  );
});

test("regular themes do not guess when sub-layer mapping is ambiguous or absent", () => {
  const theme = {
    verticals: {
      first: { subs: ["Shared"] },
      second: { subs: ["Shared"] },
    },
  };

  assert.equal(resolveCompanyVertical({ v: "legacy", s: "Shared" }, theme), "legacy");
  assert.equal(resolveCompanyVertical({ v: "legacy", s: "Missing" }, theme), "legacy");
});

test("drone layout uses Moog's canonical dotted ticker", () => {
  assert.deepEqual(THEMES.drones.positions["MOG.A"], [360, 435]);
  assert.equal(THEMES.drones.positions.MOG_A, undefined);
});
