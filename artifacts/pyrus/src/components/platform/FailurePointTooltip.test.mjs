import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  FailurePointInlineIcon,
  FailurePointTooltip,
} from "./FailurePointTooltip.jsx";

const failureTooltipSource = readFileSync(
  new URL("./FailurePointTooltip.jsx", import.meta.url),
  "utf8",
);

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
  assert.match(
    failureTooltipSource,
    /<FailurePointTooltip[\s\S]*?disabled=\{!focusable\}/,
  );
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
  const metricCard = diagnostics.slice(
    diagnostics.indexOf("const MetricCard"),
    diagnostics.indexOf("const Sparkline"),
  );
  const collapsedPanel = diagPanel.slice(
    diagPanel.indexOf("if (!showExpanded)"),
    diagPanel.indexOf("const headerStyle"),
  );
  const interactivePanelHeader = diagPanel.slice(
    diagPanel.indexOf("const headerContent"),
    diagPanel.indexOf("{rows && rows.length"),
  );
  const pipelineStages = operations.slice(
    operations.indexOf("visibleStages.map"),
  );

  assert.match(metricCard, /<FailurePointTooltip[\s\S]*?\{card\}/);
  assert.match(collapsedPanel, /<FailurePointTooltip[\s\S]*?\{collapsedButton\}/);
  assert.match(interactivePanelHeader, /<FailurePointTooltip[\s\S]*?\{headerButton\}/);
  assert.match(pipelineStages, /<FailurePointTooltip[\s\S]*?\{stageButton\}/);
});

test("an outer failure tooltip attaches directly to its native button owner", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      FailurePointTooltip,
      { point },
      React.createElement("button", { type: "button" }, "Inspect quote failure"),
    ),
  );

  assert.match(markup, /^<button[^>]*>Inspect quote failure<\/button>$/);
  assert.doesNotMatch(markup, /^<span/);
});

test("Signals issue icons are not nested inside an ARIA button row", () => {
  const signals = readFileSync(
    new URL("../../screens/SignalsScreen.jsx", import.meta.url),
    "utf8",
  );
  const rowPropsStart = signals.indexOf("getRowProps={(row) =>");
  const rowProps = signals.slice(
    rowPropsStart,
    signals.indexOf('"data-signal-direction"', rowPropsStart),
  );

  assert.match(
    signals,
    /const isNestedInteractiveTarget[\s\S]*?\[tabindex\]/,
  );
  assert.doesNotMatch(rowProps, /role: "button"/);
  assert.doesNotMatch(rowProps, /tabIndex: 0/);
  assert.doesNotMatch(rowProps, /onKeyDown:/);
  assert.match(signals, /<button[\s\S]*?aria-expanded=\{expanded \? "true" : "false"\}/);
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
