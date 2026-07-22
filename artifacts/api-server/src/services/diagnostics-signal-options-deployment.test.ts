import assert from "node:assert/strict";
import test from "node:test";

import { __diagnosticsInternalsForTests } from "./diagnostics";

const {
  buildSignalOptionsDeploymentMissingEvent,
  classifyAutomationSnapshot,
} = __diagnosticsInternalsForTests;

test("a missing signal-options deployment is a visible automation inhibitor", () => {
  assert.equal(
    classifyAutomationSnapshot({
      signalOptionsDeploymentCount: 0,
      openShadowOptionCount: 0,
    }),
    "warning",
  );

  assert.deepEqual(
    buildSignalOptionsDeploymentMissingEvent(
      {
        signalOptionsDeploymentCount: 0,
        openShadowOptionCount: 0,
      },
      {},
    ),
    {
      subsystem: "automation",
      category: "deployment",
      code: "signal_options_deployment_missing",
      severity: "warning",
      message:
        "No signal-options deployment is present; default shadow automation cannot run.",
      dimensions: {
        openShadowOptionCount: 0,
      },
      raw: {},
    },
  );
});

test("the missing-deployment inhibitor clears when a deployment exists", () => {
  assert.equal(
    buildSignalOptionsDeploymentMissingEvent(
      {
        signalOptionsDeploymentCount: 1,
        openShadowOptionCount: 0,
      },
      {},
    ),
    null,
  );
});

test("an unavailable deployment read is not misreported as a missing deployment", () => {
  assert.equal(
    classifyAutomationSnapshot({
      signalOptionsDeploymentCount: null,
      openShadowOptionCount: 0,
    }),
    "info",
  );
  assert.equal(
    buildSignalOptionsDeploymentMissingEvent(
      {
        signalOptionsDeploymentCount: null,
        openShadowOptionCount: 0,
      },
      {},
    ),
    null,
  );
});
