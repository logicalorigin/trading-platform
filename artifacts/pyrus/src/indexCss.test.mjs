import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

const duplicateSelectors = (source) => {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rulePrelude = /(?:^|[{}])\s*([^@{};][^{};]*?)\s*\{/gm;
  const duplicates = [];
  for (const match of withoutComments.matchAll(rulePrelude)) {
    const selectors = match[1]
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean);
    const repeated = selectors.filter(
      (selector, index) => selectors.indexOf(selector) !== index,
    );
    if (repeated.length) {
      duplicates.push(...new Set(repeated));
    }
  }
  return duplicates;
};

test("CSS rule lists do not repeat identical selectors", () => {
  assert.deepEqual(duplicateSelectors(css), []);
});

test("unused semantic color and glow aliases stay out of the token surface", () => {
  for (const token of [
    "--ra-position-long",
    "--ra-position-short",
    "--ra-gex-call-wall",
    "--ra-gex-put-wall",
    "--ra-glow-live",
    "--ra-glow-stale",
    "--ra-glow-error",
    "--ra-glow-positive",
    "--ra-glow-negative",
  ]) {
    assert.doesNotMatch(css, new RegExp(token));
  }
});
