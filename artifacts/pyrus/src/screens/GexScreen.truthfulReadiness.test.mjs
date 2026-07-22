import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./GexScreen.jsx", import.meta.url), "utf8");

test("GEX summary keeps unresolved exposure and source inputs visibly unknown", () => {
  assert.match(
    source,
    /: \{ zeroDTE: null, weekly: null, monthly: null \}/,
  );
  assert.match(source, /value=\{fmtPercent\(value\)\}/);
  assert.match(
    source,
    /const sourceInputSummary = dataReady[\s\S]*Sourced strikes[\s\S]*Provider IV[\s\S]*: "Sourced strikes — · Provider IV —"/,
  );
  assert.match(source, /\{sourceInputSummary\} · GEX uses provider gamma/);
});

test("GEX chart groups do not leave single cards in half-width desktop rows", () => {
  assert.match(
    source,
    /<div\s+style=\{\{\s*display: "grid",\s*gap: sp\(10\),\s*minWidth: 0,\s*gridColumn: isPhone \? "auto" : "1 \/ -1",\s*gridTemplateColumns: isPhone\s*\? "minmax\(0, 1fr\)"\s*: "repeat\(3, minmax\(0, 1fr\)\)",\s*\}\}\s*>[\s\S]*?<LazyIntradayCard[\s\S]*?<SignalsCard[\s\S]*?<SqueezeCard/,
  );
  assert.match(
    source,
    /gridTemplateColumns:\s*view === "table"\s*\? chartGridColumns\s*: "minmax\(0, 1fr\)"/,
  );
  assert.match(
    source,
    /<SectionHeading title="Open Interest Analysis" \/>\s*<Suspense[\s\S]*?<LazyOiChart/,
  );
  assert.match(
    source,
    /<SectionHeading title="Volume Profile" \/>\s*<Suspense[\s\S]*?<LazyVolumeProfileChart/,
  );
});

test("GEX controls and native tables retain their keyboard and touch contracts", () => {
  assert.match(
    source,
    /className="ra-textfield ra-touch-target-y"[\s\S]*?<GexTickerInput/,
  );
  assert.match(source, /aria-label="GEX by strike and expiration"/);
  assert.match(source, /aria-label="GEX strike profile"/);
  assert.match(
    source,
    /title="GEX chain unavailable"[\s\S]*?onClick=\{\(\) => gexQuery\.refetch\?\.\(\)\}/,
  );
});

test("GEX preserves cached chain data when a background refresh fails", () => {
  assert.match(
    source,
    /const chainError = gexQuery\.error && !gexData\s*\? gexQuery\.error\s*:\s*null;/,
  );
  assert.match(source, /const refreshError = gexData \? gexQuery\.error : null;/);
  assert.match(source, /if \(refreshError\) warnings\.push\("Refresh failed"\);/);
  assert.match(
    source,
    /buildSourceCoverageWarnings\(\{\s*data: gexData,\s*sourceCoverageRatio,\s*refreshError,\s*\}\)/,
  );
  assert.match(
    source,
    /\[gexData, refreshError, sourceCoverageRatio\]/,
  );
});
