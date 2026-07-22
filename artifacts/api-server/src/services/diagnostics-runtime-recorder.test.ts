import assert from "node:assert/strict";
import test from "node:test";

import { __diagnosticsInternalsForTests } from "./diagnostics";

test("runtime restart incidents stop degrading after the recovery window", () => {
  const nowMs = Date.parse("2026-07-20T19:30:00.000Z");

  assert.equal(
    __diagnosticsInternalsForTests.classifyRuntimeRecorderSnapshot(
      {
        latestIncidentClassification: "container-replaced",
        latestIncidentObservedAt: "2026-07-20T19:20:00.000Z",
        workspaceLongRunningTestProcessCount: 0,
      },
      nowMs,
    ),
    "warning",
  );
  assert.equal(
    __diagnosticsInternalsForTests.classifyRuntimeRecorderSnapshot(
      {
        latestIncidentClassification: "container-replaced",
        latestIncidentObservedAt: "2026-07-20T18:29:59.999Z",
        workspaceLongRunningTestProcessCount: 0,
      },
      nowMs,
    ),
    "info",
  );
});

test("active long-running test processes remain degraded regardless of incident age", () => {
  assert.equal(
    __diagnosticsInternalsForTests.classifyRuntimeRecorderSnapshot(
      {
        latestIncidentClassification: "container-replaced",
        latestIncidentObservedAt: "2026-07-19T19:30:00.000Z",
        workspaceLongRunningTestProcessCount: 1,
      },
      Date.parse("2026-07-20T19:30:00.000Z"),
    ),
    "warning",
  );
});
