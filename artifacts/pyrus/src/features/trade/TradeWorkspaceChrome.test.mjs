import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TradeWorkspaceChrome.jsx", import.meta.url),
  "utf8",
);

test("workspace tabs expose native selection, close, and keyboard reorder controls", () => {
  assert.match(source, /aria-label=\{`Select \$\{ticker\} workspace`\}/);
  assert.match(source, /aria-pressed=\{isActive\}/);
  assert.match(source, /aria-keyshortcuts="Alt\+ArrowLeft Alt\+ArrowRight"/);
  assert.match(source, /event\.key === "ArrowLeft" \? "before" : "after"/);
  assert.match(source, /aria-label=\{`Close \$\{ticker\} workspace`\}/);
  assert.doesNotMatch(source, /<div\s+onClick=\{\(\) => onSelect\(ticker\)\}/);
});

test("ticker header discloses modeled move and never invents an ATM strike", () => {
  assert.match(source, /Model estimate: 85% of the selected ATM row/);
  assert.match(source, /EST MOVE/);
  assert.match(source, /\{atmRow\?\.k \?\? MISSING_VALUE\}/);
  assert.doesNotMatch(source, /getAtmStrikeFromPrice/);
});
