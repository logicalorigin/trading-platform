import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRiskLevelDisplayModel } from "./PortfolioExposurePanel.jsx";

const source = readFileSync(new URL("./PortfolioExposurePanel.jsx", import.meta.url), "utf8");

test("portfolio exposure panel renders compact dashboard regions", () => {
  assert.match(source, /data-testid="portfolio-exposure-dashboard"/);
  assert.match(source, /data-testid="portfolio-exposure-metric-rail"/);
  assert.match(source, /data-testid="portfolio-exposure-main-grid"/);
  assert.match(source, /data-testid="portfolio-exposure-allocation"/);
  assert.match(source, /data-testid="portfolio-exposure-risk-level"/);
  assert.match(source, /data-testid="portfolio-exposure-concentration"/);
  assert.match(source, /data-testid="portfolio-exposure-risk-strip"/);
});

test("portfolio exposure panel uses dense local composition instead of stacked subpanels", () => {
  assert.match(source, /PieChart/);
  assert.match(source, /ExposureMetricRail/);
  assert.match(source, /RiskStrip/);
  assert.match(source, /label=\{riskDisplay\.mode === "capital" \? "Buffer" : "Cushion"\}/);
  assert.match(source, /RiskLevelDonut/);
  assert.match(source, /Risk Level/);
  assert.match(source, /maintenanceCushionPercent/);
  assert.match(source, /marginAvailable/);
  assert.match(source, /maintenanceMargin/);
  assert.match(source, /Deployed/);
  assert.match(source, /Cash BP/);
  assert.match(source, /Cash Buffer/);
  assert.match(source, /label="Leverage"/);
  assert.match(source, /label="Available"/);
  assert.match(source, /label="Maint"/);
  assert.match(source, /label="Beta Δ"/);
  assert.match(source, /label="Greeks"/);
  assert.match(source, /buildAccountRiskDisplayModel/);
  assert.doesNotMatch(source, /from\s+"\.\/AllocationPanel"/);
  assert.doesNotMatch(source, /from\s+"\.\/RiskDashboardPanel"/);
  assert.doesNotMatch(source, /SectionHeader\s+title="Holdings"/);
  assert.doesNotMatch(source, /SectionHeader\s+title="Risk"/);
});

test("portfolio exposure panel guards per-half loading and error states", () => {
  assert.match(source, /allocationQuery\.isLoading/);
  assert.match(source, /allocationQuery\.error/);
  assert.match(source, /riskQuery\.isLoading/);
  assert.match(source, /riskQuery\.error/);
});

test("risk level model hydrates shadow cash trading as deployed capital versus cash buffer", () => {
  const model = buildRiskLevelDisplayModel({
    margin: {
      leverageRatio: 0.62,
      marginUsed: 0,
      marginAvailable: 22_000,
      maintenanceMargin: 0,
      maintenanceCushionPercent: null,
      providerFields: {
        marginUsed: "Shadow cash account",
        marginAvailable: "Cash",
        maintenanceMargin: "None",
        maintenanceCushionPercent: "Cash account",
      },
    },
    exposure: {
      grossLong: 35_000,
      grossShort: 0,
      netExposure: 35_000,
    },
  });

  assert.equal(model.mode, "capital");
  assert.equal(model.label, "Cash Buffer");
  assert.equal(model.status.label, "Active");
  assert.equal(Number(model.bufferPercent.toFixed(4)), 38.5965);
  assert.deepEqual(
    model.rows.map((row) => row.label),
    ["Deployed", "Cash"],
  );
  assert.equal(model.deployedValue, 35_000);
  assert.equal(model.cashValue, 22_000);
});

test("risk level model keeps IBKR margin accounts on maintenance cushion", () => {
  const model = buildRiskLevelDisplayModel({
    margin: {
      marginUsed: 12_500,
      marginAvailable: 80_000,
      maintenanceMargin: 9_400,
      maintenanceCushionPercent: 82,
      providerFields: {
        marginUsed: "InitMarginReq",
        marginAvailable: "ExcessLiquidity",
        maintenanceMargin: "MaintMarginReq",
        maintenanceCushionPercent: "Cushion",
      },
    },
  });

  assert.equal(model.mode, "margin");
  assert.equal(model.label, "Maintenance Cushion");
  assert.equal(model.status.label, "Safe");
  assert.equal(model.bufferPercent, 82);
  assert.deepEqual(
    model.rows.map((row) => row.label),
    ["Excess", "Maintenance"],
  );
});
