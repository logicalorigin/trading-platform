import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FailurePointInlineIcon } from "./FailurePointTooltip.jsx";

const point = {
  severity: "warning",
  title: "Quote unavailable",
  summary: "No current quote is available.",
};

test("standalone failure icons are focusable unless an interactive owner opts out", () => {
  const standalone = renderToStaticMarkup(
    React.createElement(FailurePointInlineIcon, { point }),
  );
  const embedded = renderToStaticMarkup(
    React.createElement(FailurePointInlineIcon, { point, focusable: false }),
  );

  assert.match(standalone, /role="img"[^>]*tabindex="0"/);
  assert.doesNotMatch(embedded, /tabindex=/);
});

test("button-owned failure icons opt out of nested focus targets", () => {
  const diagnostics = readFileSync(
    new URL("../../screens/DiagnosticsScreen.jsx", import.meta.url),
    "utf8",
  );
  const diagPanel = readFileSync(
    new URL("../../screens/algo/DiagPanel.jsx", import.meta.url),
    "utf8",
  );
  const operations = readFileSync(
    new URL("../../screens/algo/AlgoOperationsPrimitives.jsx", import.meta.url),
    "utf8",
  );

  assert.match(
    diagnostics,
    /<FailurePointInlineIcon\s+point=\{failurePoint\}[\s\S]*?focusable=\{false\}/,
  );
  assert.match(diagPanel, /focusable=\{false\}/);
  assert.match(diagPanel, /focusable=\{readOnly\}/);
  assert.equal(operations.match(/focusable=\{false\}/g)?.length, 2);
});

test("surfaces with an outer failure tooltip do not nest a second tooltip", () => {
  const gex = readFileSync(
    new URL("../../screens/GexScreen.jsx", import.meta.url),
    "utf8",
  );
  const signals = readFileSync(
    new URL("../../screens/SignalsScreen.jsx", import.meta.url),
    "utf8",
  );
  const operations = readFileSync(
    new URL("../../screens/algo/AlgoOperationsPrimitives.jsx", import.meta.url),
    "utf8",
  );
  const gexBanner = gex.match(
    /<FailurePointTooltip[\s\S]*?data-testid="gex-source-coverage-banner"[\s\S]*?<\/FailurePointTooltip>/,
  )?.[0];
  const overviewMetric = operations.match(
    /const metricBody = \([\s\S]*?return failurePoint \? \(/,
  )?.[0];

  assert.ok(gexBanner);
  assert.match(gexBanner, /tabIndex=\{0\}/);
  assert.doesNotMatch(gexBanner, /DataIssueInlineIcon/);
  assert.match(signals, /<AppTooltip content=\{issues\.length \? undefined : content\}>/);
  assert.ok(overviewMetric);
  assert.match(overviewMetric, /tabIndex=\{failurePoint \? 0 : undefined\}/);
  assert.doesNotMatch(overviewMetric, /FailurePointInlineIcon/);
});
