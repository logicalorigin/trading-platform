import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("algo first-screen readiness waits for primary algo data", () => {
  const source = readLocalSource("./AlgoScreen.jsx");

  assert.match(
    source,
    /primaryReady: Boolean\(isVisible && algoPrimaryDataReady\),/,
  );
  assert.doesNotMatch(
    source,
    /primaryReady: Boolean\(isVisible\),\s*derivedReady: algoDerivedReady,/,
  );
});
