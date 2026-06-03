import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("algo failure point tooltips are wired to status, metric, and diagnostics surfaces", () => {
  const livePageSource = readSource("./AlgoLivePage.jsx");
  const primitivesSource = readSource("./AlgoOperationsPrimitives.jsx");
  const attentionStripSource = readSource("./OperationsAttentionStrip.jsx");
  const attentionListSource = readSource("./AttentionList.jsx");
  const diagPanelSource = readSource("./DiagPanel.jsx");
  const statusOrbSource = readSource("./OperationsStatusOrb.jsx");

  assert.match(livePageSource, /FailurePointTooltip/);
  assert.match(livePageSource, /buildAlgoStatusFailurePoint/);
  assert.match(livePageSource, /algoHeaderFailurePoint/);
  assert.match(statusOrbSource, /FailurePointPopoverBody/);
  assert.match(statusOrbSource, /buildAlgoStatusFailurePoint/);
  assert.match(primitivesSource, /buildAlgoMetricFailurePoint/);
  assert.match(primitivesSource, /buildPipelineStageFailurePoint/);
  assert.match(attentionStripSource, /buildFailurePointFromAlgoAttentionItem/);
  assert.match(attentionListSource, /buildFailurePointFromAlgoAttentionItem/);
  assert.match(diagPanelSource, /buildDiagRowFailurePoint/);
});
