import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAlgoPipelinePhases,
  resolveAlgoPipelineGridTemplate,
} from "./AlgoOperationsPrimitives.jsx";

test("Signal Cycle phase describes received signals", () => {
  const phases = buildAlgoPipelinePhases([
    { id: "scan_universe", status: "healthy", count: 28 },
    { id: "signal_detected", status: "healthy", count: 8 },
    { id: "action_mapped", status: "healthy", count: 3 },
    { id: "contract_selected", status: "healthy", count: 2 },
  ]);

  const signalCycle = phases.find((phase) => phase.id === "signal-cycle");
  const entryPath = phases.find((phase) => phase.id === "entry-path");

  assert.equal(signalCycle?.detail, "28 symbols -> 8 received");
  assert.equal(entryPath?.detail, "3 actions -> 2 contracts");
});

test("algo pipeline overview uses packed intrinsic tracks outside phone layouts", () => {
  assert.equal(
    resolveAlgoPipelineGridTemplate({ pocket: false, dense: false }),
    "repeat(auto-fit, minmax(120px, max-content))",
  );
  assert.equal(
    resolveAlgoPipelineGridTemplate({ pocket: false, dense: true }),
    "repeat(auto-fit, minmax(104px, max-content))",
  );
  assert.equal(
    resolveAlgoPipelineGridTemplate({ pocket: true, dense: true }),
    "repeat(auto-fit, minmax(150px, 1fr))",
  );
});
