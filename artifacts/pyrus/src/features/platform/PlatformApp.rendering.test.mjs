import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PlatformApp.jsx", import.meta.url),
  "utf8",
);

test("the authenticated shell renders its lazy trust-status cluster", () => {
  assert.match(
    source,
    /HeaderStatusClusterComponent=\{MemoHeaderStatusCluster\}/,
  );
  assert.doesNotMatch(source, /HeaderStatusClusterComponent=\{null\}/);
});

test("signal monitor action props depend on stable mutation methods", () => {
  assert.match(
    source,
    /const evaluateSignalMonitor = evaluateSignalMonitorMutation\.mutate;/,
  );
  assert.match(
    source,
    /const updateSignalMonitorProfile =\s*updateSignalMonitorProfileMutation\.mutate;/,
  );
  assert.match(
    source,
    /const updateSignalMonitorProfileAsync =\s*updateSignalMonitorProfileMutation\.mutateAsync;/,
  );

  const evaluationHandler = source.slice(
    source.indexOf("const runSignalMonitorEvaluation"),
    source.indexOf("const runtimeWatchlistSymbols"),
  );
  assert.ok(evaluationHandler.includes("evaluateSignalMonitor("));
  assert.ok(!evaluationHandler.includes("evaluateSignalMonitorMutation"));

  const profileHandlers = source.slice(
    source.indexOf("const handleToggleSignalMonitor"),
    source.indexOf("const handleRunSignalMonitorNow"),
  );
  assert.ok(profileHandlers.includes("updateSignalMonitorProfile("));
  assert.ok(profileHandlers.includes("updateSignalMonitorProfileAsync("));
  assert.ok(!profileHandlers.includes("updateSignalMonitorProfileMutation"));
});

test("Flow hands a selected contract to Trade without invoking an order mutation", () => {
  const flowHandoff = source.slice(
    source.indexOf("const handleJumpToTradeFromFlow"),
    source.indexOf("const handleJumpToTradeFromSignalOptionsCandidate"),
  );

  assert.match(flowHandoff, /setSym\(ticker\)/);
  assert.match(flowHandoff, /strike: evt\.strike/);
  assert.match(flowHandoff, /cp: evt\.cp/);
  assert.match(
    flowHandoff,
    /exp: formatExpirationLabel\(evt\.expirationDate \|\| evt\.exp\)/,
  );
  assert.match(flowHandoff, /activateScreen\("trade"\)/);
  assert.doesNotMatch(flowHandoff, /\.mutate(?:Async)?\s*\(/);
  assert.doesNotMatch(flowHandoff, /submit|placeOrder|createOrder/i);
});
