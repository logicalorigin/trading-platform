import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RESILIENCE_REASON_TEXT,
  collectWidgetIssues,
  humanizeResilienceReason,
  resilienceSeverityForReason,
} from "./resilienceIssues.js";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("collectWidgetIssues surfaces a stale record", () => {
  const issues = collectWidgetIssues(
    { stale: true, reason: "orders_cached_stale" },
    { valueLabel: "Orders", source: "broker" },
  );
  assert.ok(issues.length >= 1);
  assert.match(issues[0].title, /stale/i);
});

test("collectWidgetIssues surfaces a degraded record", () => {
  const issues = collectWidgetIssues({ degraded: true, reason: "orders_backoff" }, {
    valueLabel: "Orders",
  });
  assert.ok(issues.some((issue) => /degraded/i.test(issue.title)));
});

test("collectWidgetIssues surfaces a fallback record", () => {
  const issues = collectWidgetIssues({ fallbackUsed: true }, { valueLabel: "Flow" });
  assert.ok(issues.some((issue) => /fallback/i.test(issue.title)));
});

test("collectWidgetIssues returns nothing for a healthy record", () => {
  assert.deepEqual(collectWidgetIssues({ status: "live" }, { valueLabel: "Quote" }), []);
});

test("humanizeResilienceReason maps known codes and normalizes separators", () => {
  assert.equal(humanizeResilienceReason("orders_backoff"), RESILIENCE_REASON_TEXT.orders_backoff);
  assert.equal(humanizeResilienceReason("Orders-Backoff"), RESILIENCE_REASON_TEXT.orders_backoff);
  // Unknown code falls back to a readable phrase, never null-for-nonempty.
  assert.equal(humanizeResilienceReason("some_new_reason"), "some new reason");
  assert.equal(humanizeResilienceReason(""), null);
});

test("resilienceSeverityForReason splits transient (amber) from hard (red)", () => {
  assert.equal(resilienceSeverityForReason("ibkr_bridge_lane_queue_full"), "attention");
  assert.equal(resilienceSeverityForReason("reconnecting"), "attention");
  assert.equal(resilienceSeverityForReason("orders_cached_stale"), "warning");
  assert.equal(resilienceSeverityForReason("option_chart_stale_fallback"), "warning");
});

test("every reason code has friendly text", () => {
  for (const [code, text] of Object.entries(RESILIENCE_REASON_TEXT)) {
    assert.equal(typeof text, "string");
    assert.ok(text.length > 0, `${code} has text`);
  }
});

test("combineDataIssues stays owned by dataIssueModel", () => {
  const resilienceSource = readLocalSource("./resilienceIssues.js");

  assert.doesNotMatch(
    resilienceSource,
    /combineDataIssues/,
    "Expected resilienceIssues to avoid re-exporting dataIssueModel helpers",
  );
});
