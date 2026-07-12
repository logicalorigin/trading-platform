import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MicroSparkline,
  Pill,
  ScoreBar,
  TableExpandableRow,
  ThresholdHistogram,
} from "./primitives.jsx";

const render = (component, props = {}) =>
  renderToStaticMarkup(React.createElement(component, props));

test("actionable pills do not submit surrounding forms", () => {
  const actionMarkup = render(Pill, {
    children: "Apply",
    onClick: () => {},
  });

  assert.match(actionMarkup, /^<button[^>]*type="button"/);
});

test("expandable rows expose their current state", () => {
  const markup = render(TableExpandableRow, {
    expanded: true,
    row: "Summary",
    expandedContent: "Details",
  });

  assert.match(markup, /role="button"[^>]*aria-expanded="true"/);
});

test("compact charts are either named or explicitly decorative", () => {
  const decorativeSparkline = render(MicroSparkline, { data: [1, 2] });
  const labelledSparkline = render(MicroSparkline, {
    data: [1, 2],
    ariaLabel: "AAPL price trend",
  });
  const decorativeHistogram = render(ThresholdHistogram, { buckets: [1, 2] });
  const labelledHistogram = render(ThresholdHistogram, {
    buckets: [1, 2],
    ariaLabel: "Trade outcome distribution",
  });

  assert.match(decorativeSparkline, /<svg[^>]*aria-hidden="true"/);
  assert.match(labelledSparkline, /<svg[^>]*aria-label="AAPL price trend"[^>]*role="img"/);
  assert.match(decorativeHistogram, /<svg[^>]*aria-hidden="true"/);
  assert.match(
    labelledHistogram,
    /<svg[^>]*aria-label="Trade outcome distribution"[^>]*role="img"/,
  );
});

test("numberless score bars expose a caller-supplied label", () => {
  const labelled = render(ScoreBar, {
    value: 0.25,
    showNumber: false,
    ariaLabel: "Options premium 63% calls, 37% puts",
  });
  const unlabelled = render(ScoreBar, { value: 0.25, showNumber: false });

  assert.match(labelled, /^<span[^>]*role="img"/);
  assert.match(
    labelled,
    /^<span[^>]*aria-label="Options premium 63% calls, 37% puts"/,
  );
  assert.match(unlabelled, /^<span[^>]*aria-hidden="true"/);
});
