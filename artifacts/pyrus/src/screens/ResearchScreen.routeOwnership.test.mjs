import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("./ResearchScreen.jsx", import.meta.url),
  "utf8",
);
const observatorySource = readFileSync(
  new URL("../features/research/PhotonicsObservatory.jsx", import.meta.url),
  "utf8",
);

test("research has one route root and one page heading", () => {
  assert.match(routeSource, /return \(\s*<PhotonicsObservatory/);
  assert.doesNotMatch(routeSource, /<section\b|<header\b/);
  assert.doesNotMatch(routeSource, /Market research workspace/);

  assert.equal(
    (routeSource.match(/data-testid="research-screen"/g) ?? []).length,
    0,
    "the route shell must not create a second Research root",
  );
  assert.equal(
    (observatorySource.match(/data-testid="research-screen"/g) ?? []).length,
    1,
    "the visible Research surface must own the route root",
  );
  assert.equal(
    (observatorySource.match(/<h1\b/g) ?? []).length,
    1,
    "the Research surface must expose one page heading",
  );
});
