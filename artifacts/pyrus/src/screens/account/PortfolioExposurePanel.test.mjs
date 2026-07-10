import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PortfolioExposurePanel } from "./PortfolioExposurePanel.jsx";

globalThis.React = React;

const allocationQuery = {
  data: {},
  error: null,
  isLoading: false,
  isPending: false,
  fetchStatus: "idle",
  refetch: () => undefined,
};

const renderPanel = (riskQuery) =>
  renderToStaticMarkup(
    React.createElement(PortfolioExposurePanel, {
      allocationQuery,
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
