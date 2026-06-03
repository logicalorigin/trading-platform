import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FailurePointContent } from "./FailurePointTooltip.jsx";

test("FailurePointContent renders actionable diagnostic summary", () => {
  const html = renderToStaticMarkup(
    <FailurePointContent
      point={{
        severity: "critical",
        title: "API Down",
        summary: "API latency or errors are elevated",
        source: "api",
        reason: "api_resource_pressure_critical",
        observedAt: "2026-06-02T14:21:27.120Z",
        metrics: [
          ["p95", "5.2s"],
          ["Errors / 5m", "8"],
        ],
        topCauses: ["Slow route: /settings/ibkr-line-usage"],
        nextAction: "Inspect slow and error routes.",
      }}
    />,
  );

  assert.match(html, /API Down/);
  assert.match(html, /API latency or errors are elevated/);
  assert.match(html, /api resource pressure critical/);
  assert.match(html, /Slow route/);
  assert.match(html, /Inspect slow and error routes/);
});

test("FailurePointContent renders nothing for missing point", () => {
  assert.equal(renderToStaticMarkup(<FailurePointContent point={null} />), "");
});
