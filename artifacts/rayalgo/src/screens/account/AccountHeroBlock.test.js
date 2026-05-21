import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountHeroBlock.jsx", import.meta.url), "utf8");
const accountScreenSource = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");

test("hero owns net liq, day P&L, and the performance summary", () => {
  assert.match(source, /data-testid="account-hero-block"/);
  assert.match(source, /data-testid="account-hero-primary-row"/);
  assert.match(source, /data-testid="account-hero-performance-summary"/);
  assert.match(source, /data-testid="account-hero-performance-grid"/);
  assert.match(source, /fontSize:\s*fs\(isPhone \? 18 : 24\)/);
  assert.match(source, /background:\s*`\$\{dayTone\}12`/);
  assert.match(source, /returnsModel/);
  assert.match(source, /label:\s*"Adj return"/);
  assert.match(source, /label:\s*"P&L Δ"/);
  assert.doesNotMatch(source, /marginLeft:\s*"auto"/);
  assert.doesNotMatch(source, /sectionControl/);
});

test("hero carries the full former performance metric set", () => {
  for (const label of [
    "Trades",
    "Real",
    "Open",
    "Win",
    "PF",
    "Exp",
    "MaxDD",
    "CurDD",
    "Vol",
    "Sharpe",
    "Sort",
    "Fees",
    "Div",
    "Int",
  ]) {
    assert.match(source, new RegExp(`label:\\s*"${label}"`));
  }
  assert.match(source, /formatAccountSignedMoney\(transferAdjustedPnl/);
  assert.match(source, /equity\.returnPercentDiscrepancy/);
});

test("account screen wires returns model into the hero", () => {
  assert.match(
    accountScreenSource,
    /<AccountHeroBlock[\s\S]*?returnsModel=\{returnsModel\}[\s\S]*?range=\{range\}/,
  );
});

test("hero no longer renders all-time P&L", () => {
  assert.doesNotMatch(source, /totalPnl/);
  assert.doesNotMatch(source, /totalPnlPercent/);
  assert.doesNotMatch(source, /All-time/);
});
