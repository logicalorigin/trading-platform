import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PortfolioExposurePanel,
  buildRiskLevelDisplayModel,
  getGreekScenarioSummary,
} from "./PortfolioExposurePanel.jsx";

globalThis.React = React;

const allocationQuery = {
  data: {},
  error: null,
  isLoading: false,
  isPending: false,
  fetchStatus: "idle",
  refetch: () => undefined,
};

const renderPanel = (riskQuery, allocationQueryOverride = allocationQuery) =>
  renderToStaticMarkup(
    React.createElement(PortfolioExposurePanel, {
      allocationQuery: allocationQueryOverride,
      riskQuery,
      positionsResponse: null,
      currency: "USD",
    }),
  );

test("degraded_upstream 503 renders a soft retrying state instead of the raw error", () => {
  const html = renderPanel({
    data: null,
    error: null,
    failureReason: {
      status: 503,
      data: { code: "degraded_upstream" },
      message: "HTTP 503 Internal Server Error",
    },
    isLoading: true,
    isPending: true,
    isFetching: true,
    fetchStatus: "fetching",
    refetch: () => undefined,
  });

  assert.match(html, /temporarily degraded, retrying…/i);
  assert.doesNotMatch(html, /HTTP 503 Internal Server Error/);
});

test("degraded risk payload hides cached metrics behind the unavailable state", () => {
  const html = renderPanel({
    data: {
      accountId: "shadow",
      degraded: true,
      degradedReason: "statement_timeout",
      asOf: "2026-07-09T20:00:00.000Z",
      margin: {
        marginUsed: 12_345,
        maintenanceMargin: 6_789,
      },
      concentration: {
        topPositions: [{ symbol: "STALE", marketValue: 12_345 }],
      },
      greeks: {},
    },
    error: null,
    failureReason: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    fetchStatus: "idle",
    refetch: () => undefined,
  });

  assert.match(html, /temporarily degraded, retrying…/i);
  assert.doesNotMatch(html, /stale · as of/i);
  assert.doesNotMatch(html, /12,345|6,789|STALE/);
});

test("non-degraded 500 keeps the existing hard error and Retry control", () => {
  const html = renderPanel({
    data: null,
    error: {
      status: 500,
      data: { code: "internal_error" },
      message: "HTTP 500 Internal Server Error",
    },
    failureReason: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    fetchStatus: "idle",
    refetch: () => undefined,
  });

  assert.match(html, /HTTP 500 Internal Server Error/);
  assert.match(html, />Retry</);
  assert.doesNotMatch(html, /temporarily degraded/i);
});

test("missing allocation exposure renders unavailable values instead of zero", () => {
  const html = renderPanel({
    data: {
      degraded: false,
      margin: {},
      greeks: {},
      concentration: { topPositions: [] },
    },
    error: null,
    failureReason: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    fetchStatus: "idle",
    refetch: () => undefined,
  });
  const railStart = html.indexOf(
    'data-testid="portfolio-exposure-metric-rail"',
  );
  const railEnd = html.indexOf(
    'data-testid="portfolio-exposure-main-grid"',
    railStart,
  );
  const rail = html.slice(railStart, railEnd);

  assert.ok(railStart >= 0 && railEnd > railStart, "expected the exposure metric rail");
  assert.match(rail, /Gross[\s\S]*?—/u);
  assert.match(rail, /Net[\s\S]*?—/u);
  assert.doesNotMatch(rail, /\$0/u);
});

test("cash-capital risk requires both cash and deployed populations", () => {
  const cashAccount = {
    maintenanceMargin: 0,
    marginUsed: 0,
    providerFields: { marginUsed: "Cash account" },
  };

  const missingCash = buildRiskLevelDisplayModel({
    margin: cashAccount,
    exposure: { grossLong: 100 },
  });
  const missingDeployed = buildRiskLevelDisplayModel({
    margin: { ...cashAccount, marginAvailable: 100 },
    exposure: {},
  });
  const partialAllocation = buildRiskLevelDisplayModel({
    margin: cashAccount,
    allocationRows: [
      { label: "Cash", value: 100 },
      { label: "Stocks", value: 50 },
      { label: "Options", value: null },
    ],
  });

  for (const model of [missingCash, missingDeployed, partialAllocation]) {
    assert.equal(model.mode, "capital");
    assert.equal(model.hasData, false);
    assert.equal(model.bufferPercent, null);
    assert.equal(model.riskPercent, null);
    assert.equal(model.rows[0]?.label, "Pending");
  }
});

test("cash-capital risk accepts explicit zero populations", () => {
  const model = buildRiskLevelDisplayModel({
    margin: {
      maintenanceMargin: 0,
      marginUsed: 0,
      marginAvailable: 100,
      providerFields: { marginUsed: "Cash account" },
    },
    exposure: { grossLong: 0 },
  });

  assert.equal(model.hasData, true);
  assert.equal(model.bufferPercent, 100);
  assert.equal(model.riskPercent, 0);
});

test("margin composition requires both maintenance and available populations", () => {
  for (const margin of [
    { maintenanceMargin: 25, marginAvailable: null },
    { maintenanceMargin: null, marginAvailable: 75 },
  ]) {
    const model = buildRiskLevelDisplayModel({ margin });
    assert.equal(model.mode, "margin");
    assert.equal(model.hasData, false);
    assert.equal(model.rows[0]?.label, "Pending");
  }
});

test("incomplete allocation buckets do not authorize a partial chart or capital risk", () => {
  const html = renderPanel(
    {
      data: {
        degraded: false,
        margin: {
          maintenanceMargin: 0,
          marginUsed: 0,
          providerFields: { marginUsed: "Cash account" },
        },
        greeks: {},
        concentration: { topPositions: [] },
      },
      error: null,
      failureReason: null,
      isLoading: false,
      isPending: false,
      isFetching: false,
      fetchStatus: "idle",
      refetch: () => undefined,
    },
    {
      ...allocationQuery,
      data: {
        assetClass: [
          { label: "Cash", value: 100 },
          { label: "Stocks", value: 50 },
          { label: "Options", value: null },
        ],
      },
    },
  );
  const allocationStart = html.indexOf(
    'data-testid="portfolio-exposure-allocation"',
  );
  const allocationEnd = html.indexOf("Risk Level", allocationStart);
  const allocation = html.slice(allocationStart, allocationEnd);

  assert.match(allocation, /Allocation unavailable/);
  assert.doesNotMatch(allocation, /Stocks|Cash/);
  assert.match(html, /Pending/);
});

test("Greek scenario extrema exclude unevaluable outcomes and disclose coverage", () => {
  const summary = getGreekScenarioSummary({
    enabled: true,
    status: "completed",
    result: {
      scenarioCount: 2,
      scenarios: [
        { id: "missing", estimatedPnl: null },
        { id: "loss", estimatedPnl: -25 },
      ],
    },
  });

  assert.equal(summary.scenarioCount, 2);
  assert.equal(summary.evaluatedScenarioCount, 1);
  assert.equal(summary.worst?.id, "loss");
  assert.equal(summary.best?.id, "loss");
});

test("missing risk coverage counts are not displayed as zero", () => {
  const html = renderPanel({
    data: {
      degraded: false,
      margin: {},
      greeks: {
        coverage: {
          optionPositions: null,
          matchedOptionPositions: null,
        },
      },
      notional: { coverage: {} },
      concentration: { topPositions: [] },
    },
    error: null,
    failureReason: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    fetchStatus: "idle",
    refetch: () => undefined,
  });

  assert.match(html, /Option coverage unavailable/);
  assert.match(html, /Notional coverage unavailable/);
  assert.doesNotMatch(html, /0\/0 opt/);
});
