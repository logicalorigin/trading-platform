import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("algo first-screen readiness exposes the frame before algo data settles", () => {
  const source = readLocalSource("./AlgoScreen.jsx");

  assert.match(
    source,
    /primaryReady: Boolean\(isVisible\),/,
  );
  assert.match(
    source,
    /derivedReady: algoDerivedReady,/,
  );
  assert.doesNotMatch(
    source,
    /primaryReady: Boolean\(isVisible && algoPrimaryDataReady\),/,
  );
});
