import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () =>
  readFileSync(new URL("./GexScreen.jsx", import.meta.url), "utf8");

test("GEX source coverage warning uses failure-point tooltip", () => {
  const gexSource = source();

  assert.match(gexSource, /FailurePointTooltip/);
  assert.match(gexSource, /buildFailurePoint/);
  assert.match(gexSource, /title: "GEX source coverage"/);
  assert.match(gexSource, /data-testid="gex-source-coverage-banner"/);
});
