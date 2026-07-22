import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./TradeChainPanel.jsx", import.meta.url), "utf8");

test("option-chain header controls wrap within narrow desktop panels", () => {
  const start = source.indexOf('data-testid="trade-chain-header-controls"');
  assert.notEqual(start, -1);
  const headerControls = source.slice(start, start + 500);

  assert.match(headerControls, /flexWrap: "wrap"/);
  assert.match(headerControls, /minWidth: 0/);
});

test("option-chain contracts are keyboard actions with responsive row geometry", () => {
  assert.match(source, /import \{ useViewport \} from "\.\.\/\.\.\/lib\/responsive";/);
  assert.match(source, /const chainRowHeight = isTouchViewport \? 44 : ROW_HEIGHT;/);
  assert.match(
    source,
    /useDenseVirtualRows\(\{[\s\S]*?rowHeight: chainRowHeight,/,
  );
  assert.match(
    source,
    /<button\s+key=\{`\$\{side\}:\$\{row\.k\}`\}\s+type="button"\s+data-testid="trade-chain-contract-row"/,
  );
  assert.match(source, /aria-pressed=\{selectedSide\}/);
  assert.match(source, /className=\{joinMotionClasses\([\s\S]*?"ra-touch-target-y"/);
});

test("option-chain context, status, and recovery controls are named", () => {
  assert.match(source, /role="region"\s+aria-label=\{`\$\{ticker\} option chain`\}/);
  assert.match(source, /ariaLabel="Option chain expiration"/);
  assert.match(source, /className="ra-touch-target-y"[\s\S]*?<input[\s\S]*?Heatmap/);
  assert.match(source, /className="ra-touch-target"[\s\S]*?>\s*Retry/);
  assert.match(source, /role="status"\s+aria-live="polite"/);
});

test("option-chain header discloses modeled move and never invents an ATM strike", () => {
  assert.match(source, /Model estimate: 85% of the selected ATM row/);
  assert.match(source, /EST MOVE/);
  assert.match(source, /\{atmStrike \?\? MISSING_VALUE\}/);
  assert.doesNotMatch(source, /getAtmStrikeFromPrice/);
});
