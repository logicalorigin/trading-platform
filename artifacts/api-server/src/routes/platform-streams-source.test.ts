import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platformSource = readFileSync(
  new URL("./platform.ts", import.meta.url),
  "utf8",
);

test("quote SSE emits ready before the initial snapshot work", () => {
  // Regression: ISSUE-001 - quote SSE waited on the initial snapshot before opening.
  // Found by /qa on 2026-05-29.
  // Report: .gstack/qa-reports/qa-report-pyrus-local-2026-05-29.md
  const routeBlock = platformSource.match(
    /router\.get\("\/streams\/quotes",[\s\S]*?\n\}\);\n\nrouter\.get\("\/streams\/options\/chains"/,
  )?.[0];

  assert.ok(routeBlock);

  const readyIndex = routeBlock.indexOf('await writeEvent("ready"');
  const subscribeIndex = routeBlock.indexOf(
    "const unsubscribe = subscribeQuoteSnapshots",
  );
  const snapshotIndex = routeBlock.indexOf(
    "void fetchQuoteSnapshotPayload(symbols)",
  );

  assert.notEqual(readyIndex, -1);
  assert.notEqual(subscribeIndex, -1);
  assert.notEqual(snapshotIndex, -1);
  assert.ok(readyIndex < subscribeIndex);
  assert.ok(subscribeIndex < snapshotIndex);
  assert.match(routeBlock, /let active = true;/);
  assert.match(routeBlock, /active = false;/);
  assert.doesNotMatch(
    routeBlock,
    /await writeEvent\("quotes", await fetchQuoteSnapshotPayload\(symbols\)\)/,
  );
});

test("position quote SSE uses the position-specific Massive-first stream", () => {
  const routeBlock = platformSource.match(
    /router\.get\("\/streams\/position-quotes",[\s\S]*?\n\}\);\n\nrouter\.get\("\/streams\/options\/chains"/,
  )?.[0];

  assert.ok(routeBlock);
  assert.match(routeBlock, /subscribePositionQuoteSnapshots\(symbols/);
  assert.match(routeBlock, /fetchPositionQuoteSnapshotPayload\(symbols\)/);
  assert.doesNotMatch(routeBlock, /subscribeQuoteSnapshots\(symbols/);
});
