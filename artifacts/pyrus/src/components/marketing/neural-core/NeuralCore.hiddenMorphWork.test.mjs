import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./NeuralCore.tsx", import.meta.url), "utf8");

test("ambient clouds skip unused morph target generation", () => {
  assert.match(
    source,
    /const morphTargetsEnabled = Boolean\(p\.morph \|\| p\.morphDriveRef\);/,
  );
  assert.match(
    source,
    /if \(morphTargetsEnabled\) \{[\s\S]*?lockupTargets\([\s\S]*?ringTargets\(/,
  );
});

test("the neural renderer has one supported GPU path", () => {
  assert.doesNotMatch(source, /p\.mode|PointsMaterial|function vnoise/);
});
