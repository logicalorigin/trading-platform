import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const internals = readFileSync(
  new URL("./MarketInternalsRail.jsx", import.meta.url),
  "utf8",
);
const scanner = readFileSync(
  new URL("./MarketUniverseTable.jsx", import.meta.url),
  "utf8",
);

test("Market internals uses a flat definition layout instead of cards inside cards", () => {
  assert.match(internals, /const InternalsMetric =/);
  assert.doesNotMatch(internals, /const InternalsTile =/);
  assert.match(internals, /<dl[\s\S]*?<InternalsMetric[\s\S]*?<InternalsMetric/);
  assert.match(internals, /label="VIXY Δ"/);
});

test("Market scanner loading and loaded rows share touch-safe geometry", () => {
  assert.match(scanner, /const SCANNER_ROW_HEIGHT = 34;/);
  assert.match(scanner, /const scannerRowHeight = flags\.isNarrow \? 44 : SCANNER_ROW_HEIGHT;/);
  assert.match(scanner, /<Skeleton[\s\S]{0,180}height=\{scannerRowHeight\}/);
  assert.match(scanner, /rowHeight=\{scannerRowHeight\}/);
  assert.match(
    scanner,
    /className: "ra-interactive ra-hover-accent-bg ra-touch-target-y"/,
  );
  assert.doesNotMatch(scanner, /ra-touch-target-y ra-press-feedback/);
  assert.match(scanner, /resolveMarketScannerState\(\{/);
  assert.match(scanner, /scannerState\.body === "error"/);
  assert.match(scanner, /scannerState\.body === "filtered-empty"/);
  assert.match(scanner, /ariaLabel="Market universe scanner"/);
  assert.match(scanner, /\{scannerState\.statusText\}/);
});

test("Market flow magnitude stays semantic without a decorative gradient", () => {
  const flowSpine = scanner.slice(
    scanner.indexOf("const ScannerFlowSpine"),
    scanner.indexOf("export function MarketUniverseScanner"),
  );
  assert.match(flowSpine, /className="market-scanner-flow-fill"/);
  assert.doesNotMatch(flowSpine, /linear-gradient/);
});
