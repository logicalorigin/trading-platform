import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./DockedSheet.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const expandedBody = source.slice(
  source.indexOf("{/* Expanded body"),
  source.indexOf("{/* Footer bar"),
);
const expandedBodyAttributes = expandedBody.slice(
  expandedBody.indexOf("<div"),
  expandedBody.indexOf("style={{"),
);

test("docked-sheet inner body uses the shared reduced-motion transition hook", () => {
  assert.match(expandedBodyAttributes, /\bid=\{bodyId\}/);
  assert.match(expandedBodyAttributes, /\bclassName="ra-expandable-row-content"/);
  assert.match(
    expandedBodyAttributes,
    /\baria-hidden=\{expanded \? undefined : "true"\}/,
  );
  assert.match(expandedBodyAttributes, /\binert=\{!expanded\}/);
  assert.match(
    expandedBody,
    /transition:\s*"max-height[^"\n]+opacity[^"\n]+transform[^"\n]+"/,
  );
});

test("shared hook stops the inline transition for OS and app reduced motion", () => {
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.ra-row-hover,[^{}]*\.ra-expandable-row-content \{\s*transition: none !important;/,
  );
  assert.match(
    css,
    /html\[data-pyrus-reduced-motion="on"\] \.ra-row-hover,[^{}]*html\[data-pyrus-reduced-motion="on"\] \.ra-expandable-row-content \{\s*transition: none !important;/,
  );
});
