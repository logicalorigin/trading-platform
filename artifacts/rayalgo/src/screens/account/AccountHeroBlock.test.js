import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountHeroBlock.jsx", import.meta.url), "utf8");

test("hero is a compact net-liq and day P&L row without section control", () => {
  assert.match(source, /data-testid="account-hero-block"/);
  assert.match(source, /fontSize:\s*fs\(isPhone \? 18 : 24\)/);
  assert.match(source, /background:\s*`\$\{dayTone\}12`/);
  assert.doesNotMatch(source, /marginLeft:\s*"auto"/);
  assert.doesNotMatch(source, /sectionControl/);
});

test("hero no longer renders all-time P&L", () => {
  assert.doesNotMatch(source, /totalPnl/);
  assert.doesNotMatch(source, /totalPnlPercent/);
  assert.doesNotMatch(source, /All-time/);
});
