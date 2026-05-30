import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CSS_COLOR } from "../../lib/uiTokens.jsx";
import {
  getGreekScenarioSummary,
  buildRiskLevelDisplayModel,
  getRiskGaugeColorStops,
} from "./PortfolioExposurePanel.jsx";

const source = readFileSync(new URL("./PortfolioExposurePanel.jsx", import.meta.url), "utf8");

test("portfolio exposure panel renders compact dashboard regions", () => {
  assert.match(source, /data-testid="portfolio-exposure-dashboard"/);
  assert.match(source, /data-testid="portfolio-exposure-metric-rail"/);
  assert.match(source, /data-testid="portfolio-exposure-main-grid"/);
  assert.match(source, /data-testid="portfolio-exposure-allocation"/);
  assert.match(source, /data-testid="portfolio-exposure-risk-level"/);
  assert.match(source, /data-testid="portfolio-exposure-notional"/);
  assert.match(source, /data-testid="portfolio-exposure-greek-scenarios"/);
  assert.match(source, /data-testid="portfolio-exposure-concentration"/);
  assert.match(source, /data-testid="portfolio-exposure-risk-strip"/);
});

test("portfolio exposure panel uses dense local composition instead of stacked subpanels", () => {
  assert.match(source, /PieChart/);
  assert.match(source, /ExposureMetricRail/);
  assert.match(source, /RiskStrip/);
  assert.match(source, /NotionalExposureStrip/);
  assert.match(source, /GreekScenarioStrip/);
  assert.match(source, /Notional Exposure/);
  assert.match(source, /Greek Scenarios/);
  assert.match(source, /label="Worst Shock"/);
  assert.doesNotMatch(source, /label="Worst Case"/);
  assert.match(source, /Gross Notional/);
  assert.match(source, /Net Direction/);
  assert.match(source, /Delta Adj/);
  assert.match(source, /Notional \/ NLV/);
  assert.match(source, /label=\{riskDisplay\.mode === "capital" \? "Buffer" : "Cushion"\}/);
  assert.match(source, /AllocationDonut/);
  assert.match(source, /RiskLevelGauge/);
  assert.match(source, /RadialStrokeGauge/);
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
  assert.doesNotMatch(source, /RiskLevelDonut/);
  assert.doesNotMatch(source, /from\s+"\.\/AllocationPanel"/);
  assert.doesNotMatch(source, /from\s+"\.\/RiskDashboardPanel"/);
  assert.doesNotMatch(source, /SectionHeader\s+title="Holdings"/);
  assert.doesNotMatch(source, /SectionHeader\s+title="Risk"/);
});

test("portfolio exposure panel tightens local density tokens", () => {
  assert.match(source, /const DashboardBlock = \(\{ title, children, compact = false \}\)/);
  assert.match(source, /minmax\(\$\{dim\(compact \? 52 : 74\)\}px, 0\.72fr\)/);
  assert.match(source, /height:\s*dim\(compact \? 56 : 76\)/);
  assert.match(source, /minmax\(\$\{dim\(92\)\}px, 1fr\)/);
  assert.match(source, /maxWidth:\s*dim\(92\)/);
  assert.match(source, /minmax\(\$\{dim\(68\)\}px, 1fr\)/);
  assert.match(source, /minmax\(\$\{dim\(44\)\}px, 1fr\)/);
  assert.match(source, /data-testid="portfolio-exposure-dashboard"[\s\S]*gap:\s*sp\(isPhone \? 3 : 4\)/);
  assert.match(source, /data-testid="portfolio-exposure-main-grid"[\s\S]*gap:\s*sp\(isPhone \? 3 : 4\)/);
  assert.doesNotMatch(source, /dim\(86\)/);
  assert.doesNotMatch(source, /dim\(88\)/);
  assert.doesNotMatch(source, /dim\(108\)/);
});

test("portfolio exposure risk level uses shared radial stroke gauge", () => {
  assert.match(source, /import \{ RadialStrokeGauge \}/);
  assert.match(source, /RISK_USED_GAUGE_COLOR_STOPS/);
  assert.match(source, /const RiskLevelGauge = /);
  assert.match(source, /<RadialStrokeGauge/);
  assert.match(source, /value=\{display\.riskPercent\}/);
  assert.match(source, /tickCount=\{compact \? 36 : 48\}/);
  assert.match(source, /tickWidth=\{compact \? 4 : 5\}/);
  assert.match(source, /startAngle=\{-135\}/);
  assert.match(source, /endAngle=\{135\}/);
  assert.match(source, /trackOpacity=\{0\.5\}/);
  assert.match(source, /activeOpacity=\{0\.98\}/);
  assert.match(source, /const gaugeColorStops = getRiskGaugeColorStops\(display\)/);
  assert.match(source, /colorStops=\{gaugeColorStops\}/);
  assert.match(source, /glow=\{!compact\}/);
  assert.match(source, /valueLabel=\{riskLabel\}/);
  assert.match(source, /levelLabel=\{display\.status\.label\}/);
  assert.match(source, /const shortGaugeLabel = compact \? undefined : "Risk Used"/);
  assert.match(source, /title=\{shortGaugeLabel\}/);
  assert.match(source, /ariaLabel=\{`\$\{display\.label\} risk used: \$\{riskLabel\}; \$\{display\.status\.label\}`\}/);
  assert.match(source, /animated=\{display\.riskPercent != null\}/);
  assert.match(source, /const AllocationDonut = /);
  assert.match(source, /<PieChart>/);
});

test("risk gauge color stops follow account risk semantics", () => {
  const marginModel = buildRiskLevelDisplayModel({
    margin: {
      marginUsed: 12_500,
      marginAvailable: 80_000,
      maintenanceMargin: 9_400,
      maintenanceCushionPercent: 82,
    },
  });
  assert.equal(marginModel.riskPercent, 18);
  assert.equal(marginModel.status.label, "Safe");
  assert.deepEqual(getRiskGaugeColorStops(marginModel), [
    { offset: 0, color: CSS_COLOR.green },
    { offset: 0.49, color: CSS_COLOR.green },
    { offset: 0.5, color: CSS_COLOR.amber },
    { offset: 0.74, color: CSS_COLOR.amber },
    { offset: 0.75, color: CSS_COLOR.red },
    { offset: 1, color: CSS_COLOR.red },
  ]);

  const cashModel = buildRiskLevelDisplayModel({
    margin: {
      marginUsed: 0,
      marginAvailable: 50_000,
      maintenanceMargin: 0,
      providerFields: {
        marginUsed: "Cash account",
        marginAvailable: "Cash",
        maintenanceMargin: "None",
      },
    },
    exposure: {
      grossLong: 0,
      grossShort: 0,
      netExposure: 0,
    },
  });
  assert.equal(cashModel.status.label, "Cash");
  assert.equal(cashModel.riskPercent, 0);
  assert.deepEqual(getRiskGaugeColorStops(cashModel), [
    { offset: 0, color: CSS_COLOR.cyan },
    { offset: 1, color: CSS_COLOR.cyan },
  ]);
});

test("risk level model reports risk consumed using threshold zones", () => {
  const safeModel = buildRiskLevelDisplayModel({
    margin: {
      marginAvailable: 80_000,
      maintenanceMargin: 9_400,
      maintenanceCushionPercent: 82,
    },
  });
  assert.equal(safeModel.riskPercent, 18);
  assert.equal(safeModel.status.label, "Safe");

  const watchModel = buildRiskLevelDisplayModel({
    margin: {
      marginAvailable: 25_000,
      maintenanceMargin: 25_000,
      maintenanceCushionPercent: 50,
    },
  });
  assert.equal(watchModel.riskPercent, 50);
  assert.equal(watchModel.status.label, "Watch");

  const riskModel = buildRiskLevelDisplayModel({
    margin: {
      marginAvailable: 10_000,
      maintenanceMargin: 30_000,
      maintenanceCushionPercent: 25,
    },
  });
  assert.equal(riskModel.riskPercent, 75);
  assert.equal(riskModel.status.label, "Risk");
});

test("portfolio exposure panel has a phone compact mode for two-up overview", () => {
  assert.match(source, /isPhone = false/);
  assert.match(source, /title=\{isPhone \? "Exposure" : "Portfolio Exposure"\}/);
  assert.match(source, /subtitle=\{isPhone \? undefined : subtitle \?\? "Holdings, risk, and concentration"\}/);
  assert.match(source, /compact=\{isPhone\}/);
  assert.match(source, /maxItems=\{compact \? 3 : 4\}/);
  assert.match(source, /gridTemplateColumns:\s*isPhone[\s\S]*"minmax\(0, 1fr\)"/);
  assert.match(source, /isPhone \? null : <SectorList/);
  assert.match(source, /isPhone \? null : \(\s*<NotionalExposureStrip/);
  assert.match(source, /isPhone \? null : \(\s*<GreekScenarioStrip/);
  assert.match(source, /isPhone \? null : renderRiskStrip\(\)/);
});

test("greek scenario summary stays hidden until enabled and sorts scenarios", () => {
  assert.equal(getGreekScenarioSummary(null), null);
  assert.equal(getGreekScenarioSummary({ enabled: false }), null);

  const summary = getGreekScenarioSummary({
    enabled: true,
    status: "completed",
    result: {
      scenarioCount: 2,
      scenarios: [
        { estimatedPnl: 125, spotShock: 0.02, ivShockVolPoints: 5, dayOffset: 1 },
        { estimatedPnl: -80, spotShock: -0.02, ivShockVolPoints: -5, dayOffset: 1 },
      ],
      managementFlags: [{ symbol: "SPY 500C", reasons: ["theta_burden"] }],
    },
  });

  assert.equal(summary.scenarioCount, 2);
  assert.equal(summary.worst.estimatedPnl, -80);
  assert.equal(summary.best.estimatedPnl, 125);
  assert.equal(summary.flags[0].symbol, "SPY 500C");
});

test("portfolio exposure panel guards per-half loading and error states", () => {
  assert.match(source, /allocationInitialLoading/);
  assert.match(source, /riskInitialLoading/);
  assert.match(source, /allocationQuery\.isPending/);
  assert.match(source, /allocationQuery\.isLoading/);
  assert.match(source, /allocationQuery\.error/);
  assert.match(source, /riskQuery\.isPending/);
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
  assert.equal(model.status.label, "Watch");
  assert.equal(Number(model.bufferPercent.toFixed(4)), 38.5965);
  assert.equal(Number(model.riskPercent.toFixed(4)), 61.4035);
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
  assert.equal(model.riskPercent, 18);
  assert.deepEqual(
    model.rows.map((row) => row.label),
    ["Excess", "Maintenance"],
  );
});
