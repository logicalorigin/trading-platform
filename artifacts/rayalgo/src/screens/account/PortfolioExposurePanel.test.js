import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PortfolioExposurePanel.jsx", import.meta.url), "utf8");

test("portfolio exposure panel renders Holdings, Risk, and Top Concentration sections", () => {
  assert.match(source, /SectionHeader\s+title="Holdings"/);
  assert.match(source, /SectionHeader\s+title="Risk"/);
  assert.match(source, /SectionHeader\s+title="Top Concentration"/);
});

test("portfolio exposure panel composes allocation + risk content from existing modules", () => {
  assert.match(source, /from\s+"\.\/AllocationPanel"/);
  assert.match(source, /from\s+"\.\/RiskDashboardPanel"/);
  assert.match(source, /buildAccountRiskDisplayModel/);
});

test("portfolio exposure panel guards per-half loading and error states", () => {
  assert.match(source, /allocationQuery\.isLoading/);
  assert.match(source, /allocationQuery\.error/);
  assert.match(source, /riskQuery\.isLoading/);
  assert.match(source, /riskQuery\.error/);
});
