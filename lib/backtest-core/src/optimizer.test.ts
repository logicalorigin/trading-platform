import assert from "node:assert/strict";
import test from "node:test";

import { buildCandidatesForMode, buildWalkForwardWindows } from "./optimizer";

test("walk-forward windows reject inputs that cannot advance time", () => {
  const from = new Date("2024-01-01T00:00:00.000Z");
  const to = new Date("2026-01-01T00:00:00.000Z");

  for (const [label, args] of [
    ["zero training", [from, to, 0, 6, 6]],
    ["zero test", [from, to, 24, 0, 6]],
    ["zero step", [from, to, 24, 6, 0]],
    ["negative step", [from, to, 24, 6, -1]],
    ["fractional step", [from, to, 24, 6, 0.5]],
    ["overflowing step", [from, to, 24, 6, Number.MAX_SAFE_INTEGER]],
    ["invalid start", [new Date(Number.NaN), to, 24, 6, 6]],
    ["invalid end", [from, new Date(Number.NaN), 24, 6, 6]],
  ] as const) {
    assert.throws(
      () =>
        buildWalkForwardWindows(args[0], args[1], args[2], args[3], args[4]),
      RangeError,
      label,
    );
  }
});

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

test("grid sweeps reject more than 500 candidates before materializing them", () => {
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

  assert.throws(
    () =>
      buildCandidatesForMode(
        "grid",
        {},
        [
          {
            key: "first",
            values: Array.from({ length: 50 }, (_, index) => index),
          },
          { key: "second", values: guardedValues },
        ],
        100,
      ),
    (error: unknown) =>
      error instanceof RangeError &&
      error.message === "Optimizer sweeps are limited to 500 candidates.",
  );
});

test("empty sweep dimensions yield no candidates regardless of order or mode", () => {
  const populated = {
    key: "populated",
    values: Array.from({ length: 501 }, (_, index) => index),
  };
  const empty = { key: "empty", values: [] };

  for (const mode of ["grid", "random", "walk_forward"] as const) {
    assert.deepEqual(
      buildCandidatesForMode(mode, {}, [populated, empty], 4),
      [],
      `${mode} with the empty dimension last`,
    );
    assert.deepEqual(
      buildCandidatesForMode(mode, {}, [empty, populated], 4),
      [],
      `${mode} with the empty dimension first`,
    );
  }
});
