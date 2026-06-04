import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  collectChartSourceDataIssues,
  collectCoverageDataIssues,
  collectDataIssuesFromRecord,
  collectQuoteDataIssues,
  getPrimaryDataIssue,
} from "./dataIssueModel.js";

const readSource = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("collectQuoteDataIssues surfaces stale delayed fallback quote state", () => {
  const issues = collectQuoteDataIssues(
    {
      freshness: "stale",
      marketDataMode: "delayed",
      source: "ibkr-fallback-cache",
      updatedAt: "2026-06-04T13:31:00.000Z",
    },
    { valueLabel: "Position quote", source: "account positions" },
  );

  assert.deepEqual(
    issues.map((issue) => issue.title),
    [
      "Stale position quote",
      "Delayed position quote",
      "Position quote using fallback data",
    ],
  );
  assert.equal(issues[0].source, "account positions");
  assert.equal(issues[0].observedAt, "2026-06-04T13:31:00.000Z");
});

test("collectDataIssuesFromRecord treats backend errors as primary critical issues", () => {
  const issues = collectDataIssuesFromRecord(
    {
      status: "error",
      lastError: "provider token=abc123 failed",
      sourceStatus: "degraded",
    },
    { valueLabel: "Signal matrix", source: "signals" },
  );
  const primary = getPrimaryDataIssue(issues);

  assert.equal(primary.severity, "critical");
  assert.equal(primary.title, "Signal matrix unavailable");
  assert.match(primary.summary, /token=\[redacted\]/);
});

test("collectDataIssuesFromRecord skips normal pending and quiet-market states", () => {
  assert.equal(
    collectDataIssuesFromRecord({ status: "loading" }, { valueLabel: "Flow" }).length,
    0,
  );
  assert.equal(
    collectDataIssuesFromRecord(
      { status: "empty", reason: "market-session-quiet" },
      { valueLabel: "Flow" },
    ).length,
    0,
  );
});

test("collectCoverageDataIssues surfaces partial backend coverage", () => {
  const issues = collectCoverageDataIssues(
    {
      loadedCount: 6,
      returnedCount: 10,
      coverageHealth: "lagging",
      degradedReason: "line_budget",
    },
    { valueLabel: "GEX source coverage", source: "gex" },
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, "GEX source coverage is partial");
  assert.deepEqual(issues[0].metrics.slice(0, 2), [
    ["Loaded", "6/10"],
    ["Ratio", "60%"],
  ]);
});

test("collectChartSourceDataIssues maps chart source booleans", () => {
  const issues = collectChartSourceDataIssues(
    {
      state: "fallback",
      isFallback: true,
      isStale: true,
      detail: "IBKR history unavailable",
    },
    { valueLabel: "Option chart" },
  );

  assert.deepEqual(
    issues.map((issue) => issue.title),
    ["Stale option chart", "Option chart using fallback data"],
  );
});

test("data issue markers stay on data surfaces instead of shell and settings chrome", () => {
  const shellSources = [
    ["App header", "./AppHeader.jsx"],
    ["Header status", "./HeaderStatusCluster.jsx"],
    ["Header broadcast", "./HeaderBroadcastScrollerStack.jsx"],
    ["Platform shell root", "./PlatformApp.jsx"],
    ["Settings", "../../screens/SettingsScreen.jsx"],
  ];

  for (const [label, path] of shellSources) {
    const source = readSource(path);
    assert.doesNotMatch(source, /DataIssueInlineIcon/, `${label} should not render data issue icons`);
    assert.doesNotMatch(source, /dataIssueModel/, `${label} should not infer data issues`);
  }

  const dataSurfaceSources = [
    "../../screens/account/PositionsPanel.jsx",
    "../../screens/TradeScreen.jsx",
    "../../screens/SignalsScreen.jsx",
    "../../screens/FlowScreen.jsx",
    "../../screens/GexScreen.jsx",
    "../../screens/MarketScreen.jsx",
  ];

  for (const path of dataSurfaceSources) {
    assert.match(readSource(path), /DataIssueInlineIcon/);
  }
});
