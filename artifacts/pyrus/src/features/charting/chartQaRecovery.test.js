import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("chart-heavy routes use specific loading shells instead of the generic app loader", () => {
  const source = readSource("../platform/screenRegistry.jsx");

  assert.match(source, /const SCREEN_ROUTE_SHELLS =/);
  ["account", "flow", "gex", "trade"].forEach((screenId) => {
    assert.match(source, new RegExp(`${screenId}:\\s*\\{`));
  });
  assert.match(source, /data-screen-route-shell=\{screenId\}/);
  assert.match(source, /Loading balances, positions, and account charts/);
  assert.match(source, /Loading gamma controls and strike profile charts/);
  assert.match(source, /Loading the active spot chart before secondary panels/);
});

test("account deferred chart panels render labeled loading states", () => {
  const source = readSource("../../screens/AccountScreen.jsx");
  const fallbackBlock =
    source.match(/const AccountPanelSuspenseFallback = \([\s\S]*?\n\);/)?.[0] ??
    "";

  assert.match(fallbackBlock, /role="status"/);
  assert.match(fallbackBlock, /aria-live="polite"/);
  assert.match(fallbackBlock, /aria-hidden="true"[\s\S]*ra-skeleton-shimmer/);
  assert.match(source, /title="Loading equity curve"/);
  assert.match(source, /title="Loading today snapshot"/);
  assert.match(source, /title="Loading trading analysis"/);
});

test("Recharts surfaces mount only after their chart frames have dimensions", () => {
  const measuredFrameSource = readSource("./MeasuredChartFrame.jsx");
  const gexSource = readSource("../../screens/GexScreen.jsx");
  const flowSource = readSource("../../screens/FlowScreen.jsx");
  const allocationSource = readSource("../../screens/account/AllocationPanel.jsx");
  const exposureSource = readSource("../../screens/account/PortfolioExposurePanel.jsx");

  assert.match(measuredFrameSource, /ResizeObserver/);
  assert.match(measuredFrameSource, /data-chart-container-ready/);
  assert.match(gexSource, /testId="gex-strike-profile-frame"/);
  assert.match(gexSource, /testId="gex-intraday-chart"/);
  assert.match(flowSource, /testId="flow-premium-tide-frame"/);
  assert.match(allocationSource, /MeasuredChartFrame/);
  assert.match(exposureSource, /MeasuredChartFrame/);
});

test("market mobile chart copy separates focused rendering from the saved grid preset", () => {
  const source = readSource("../market/MultiChartGrid.jsx");

  assert.match(source, /\$\{cfg\.count\}-chart desktop preset/);
  assert.match(source, /phone shows one focused chart/);
});
