import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CashFundingPanel } from "./CashFundingPanel.jsx";

globalThis.React = React;

const query = (data) => ({
  data,
  error: null,
  isLoading: false,
  isPending: false,
  fetchStatus: "idle",
  refetch: () => undefined,
});

test("cash balance-only providers do not claim empty activity or dividend populations", () => {
  const html = renderToStaticMarkup(
    React.createElement(CashFundingPanel, {
      query: query({
        settledCash: 125,
        totalCash: 125,
        activities: null,
        dividends: null,
      }),
      currency: "USD",
    }),
  );

  assert.match(html, /Cash balance only/);
  assert.match(html, /Cash activity unavailable/);
  assert.match(html, /Dividend history unavailable/);
  assert.doesNotMatch(html, /No cash activity|No recent dividend rows/);
});
