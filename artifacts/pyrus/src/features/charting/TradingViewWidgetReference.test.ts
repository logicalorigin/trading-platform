import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildTradingViewSrcDoc,
  TradingViewWidgetReference,
  TRADING_VIEW_SANDBOX,
} from "./TradingViewWidgetReference";

globalThis.React = React;

test("TradingView embed stays isolated from the app origin", () => {
  assert(!TRADING_VIEW_SANDBOX.split(" ").includes("allow-same-origin"));

  const srcDoc = buildTradingViewSrcDoc({
    symbol: 'NASDAQ:AAPL"></a><script>parent.document.body.remove()</script>',
    interval: "1D",
    theme: "dark",
    locale: "</script><script>parent.document.body.remove()</script>",
  });

  assert.match(srcDoc, /default-src 'none'/);
  assert.match(srcDoc, /script-src https:\/\/s3\.tradingview\.com/);
  assert.doesNotMatch(srcDoc, /<script>parent\.document/);
  assert.match(srcDoc, /\\u003c\/script>/);
});

test("TradingView reference iframe has an accessible title", () => {
  const markup = renderToStaticMarkup(
    React.createElement(TradingViewWidgetReference),
  );

  assert.match(markup, /<iframe[^>]*title="TradingView chart reference"/);
});
