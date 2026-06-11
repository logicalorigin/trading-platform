import assert from "node:assert/strict";
import test from "node:test";

import {
  hasLegacyAlgoBranding,
  normalizeLegacyAlgoBranding,
  normalizeLegacyAlgoBrandText,
} from "./algo-branding";

test("renames legacy brand tokens in strings", () => {
  assert.equal(normalizeLegacyAlgoBrandText("RayAlgo"), "Pyrus");
  assert.equal(normalizeLegacyAlgoBrandText("rayReplica"), "pyrusSignals");
  assert.equal(
    normalizeLegacyAlgoBrandText("RayReplica Signal Options Shadow Paper"),
    "Pyrus Signals Options Shadow Paper",
  );
  assert.equal(
    normalizeLegacyAlgoBrandText("status: RAYALGO online"),
    "status: PYRUS online",
  );
});

test("normalizes nested objects, arrays, and keys", () => {
  const input = {
    rayAlgo: "RayAlgo deployment",
    nested: [{ note: "powered by RayReplica" }, "clean"],
    count: 3,
  };
  assert.deepEqual(normalizeLegacyAlgoBranding(input), {
    pyrus: "Pyrus deployment",
    nested: [{ note: "powered by Pyrus Signals" }, "clean"],
    count: 3,
  });
});

test("preserves non-branding primitives, Dates, null/undefined", () => {
  const d = new Date("2026-06-11T00:00:00.000Z");
  assert.equal(normalizeLegacyAlgoBranding(d), d);
  assert.equal(normalizeLegacyAlgoBranding(42), 42);
  assert.equal(normalizeLegacyAlgoBranding(null), null);
  assert.equal(normalizeLegacyAlgoBranding(undefined), undefined);
  assert.equal(normalizeLegacyAlgoBrandText("nothing to change here"), "nothing to change here");
});

test("clean values are returned by reference (no needless rebuild)", () => {
  // Perf-contract: payloads with no legacy branding skip the recursive rebuild
  // and come back as the same reference (output is JSON-identical either way).
  const clean = { a: 1, b: ["x", "y"], c: { d: "hello" } };
  assert.equal(normalizeLegacyAlgoBranding(clean), clean);
  assert.equal(normalizeLegacyAlgoBranding(clean.b), clean.b);

  const dirty = { a: "RayAlgo" };
  assert.notEqual(normalizeLegacyAlgoBranding(dirty), dirty);
  assert.deepEqual(normalizeLegacyAlgoBranding(dirty), { a: "Pyrus" });
});

test("hasLegacyAlgoBranding detects/ignores branding", () => {
  assert.equal(hasLegacyAlgoBranding({ x: "RayReplica" }), true);
  assert.equal(hasLegacyAlgoBranding({ x: "clean" }), false);
});
