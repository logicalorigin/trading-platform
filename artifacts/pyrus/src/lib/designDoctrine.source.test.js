import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const designDoctrine = () =>
  readFileSync(new URL("../../../../DESIGN.md", import.meta.url), "utf8");

test("root design doctrine captures semantic color taxonomy", () => {
  const source = designDoctrine();

  assert.match(source, /^# PYRUS Design Doctrine/m);
  assert.match(source, /Directional market intent uses blue/);
  assert.match(source, /Financial outcome uses green for positive/);
  assert.match(source, /Operational health uses green for healthy/);
  assert.match(source, /Green is not banned/);
});

test("root design doctrine locks hierarchy, state, and accessibility rollout rules", () => {
  const source = designDoctrine();

  assert.match(source, /Every migrated screen must define a hierarchy matrix/);
  assert.match(source, /Every migrated screen and shared primitive must specify/);
  assert.match(source, /Live Trust Flow/);
  assert.match(source, /App UI Rejection Rules/);
  assert.match(source, /Responsive And Accessibility/);
  assert.match(source, /Not In Scope For The V1 Rollout/);
});
