import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taxCenter = readFileSync(
  new URL("./TaxCenterPanel.jsx", import.meta.url),
  "utf8",
);
const taxSettings = readFileSync(
  new URL("../settings/TaxSettingsPanel.jsx", import.meta.url),
  "utf8",
);

const taxCenterMetric = taxCenter.slice(
  taxCenter.indexOf("const MiniStat"),
  taxCenter.indexOf("const TaxTabButton"),
);
const settingsMetric = taxSettings.slice(
  taxSettings.indexOf("function SummaryCell"),
  taxSettings.indexOf("function CheckboxRow"),
);

test("Tax Center uses the canonical flat stat treatment without reserving loaded height", () => {
  assert.match(taxCenterMetric, /<StatTile/);
  assert.doesNotMatch(taxCenterMetric, /border:|background:|borderRadius:/);
  assert.match(taxCenter, /repeat\(auto-fit,\s*minmax\(min\(100%,\s*\d+px\),\s*1fr\)\)/);
  assert.doesNotMatch(taxCenter, /isPhone\s*\?\s*"1fr"\s*:/);
  assert.doesNotMatch(taxCenter, /minHeight=\{isPhone\s*\?/);
});

test("Settings Tax summaries reuse the canonical flat stat treatment", () => {
  assert.match(settingsMetric, /<StatTile/);
  assert.doesNotMatch(settingsMetric, /border:|background:|borderRadius:/);
  assert.match(
    taxSettings,
    /const summaryGridStyle = \(phoneColumns = 0\)[\s\S]*?repeat\(auto-fit,/,
  );
  assert.match(taxSettings, /summaryGridStyle\(isPhone \? 2 : 0\)/);
  assert.equal(
    taxSettings.match(/summaryGridStyle\(isPhone \? 3 : 0\)/g)?.length,
    2,
  );
  assert.equal(taxSettings.match(/data-preserve-mobile-layout/g)?.length, 3);
});

test("Tax Center overview values follow the shared operational status tones", () => {
  assert.match(
    taxCenter,
    /label="Federal"[\s\S]*?tone=\{CSS_COLOR\[statusTone\(federal\.status\)\]\}/,
  );
  assert.match(
    taxCenter,
    /label="State"[\s\S]*?tone=\{CSS_COLOR\[statusTone\(state\.status\)\]\}/,
  );
});
