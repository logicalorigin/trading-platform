import assert from "node:assert/strict";
import test from "node:test";

import {
  hasRetiredAlertTierReference,
  isScanPath,
  shouldIgnore,
} from "./check-retired-alert-tier-references.mjs";

test("scans only source roots without broad filename exemptions", () => {
  assert.equal(isScanPath("artifacts/api-server/src/app.ts"), true);
  assert.equal(isScanPath("scripts/run-validation-command.mjs"), true);
  assert.equal(isScanPath("target/generated.rs"), false);
  assert.equal(
    shouldIgnore("scripts/check-retired-alert-tier-references.mjs"),
    true,
  );
  assert.equal(
    shouldIgnore("scripts/scripts/reports/runtime/samples.json"),
    true,
  );
  assert.equal(
    shouldIgnore(
      "artifacts/example/scripts/check-retired-alert-tier-references.mjs",
    ),
    false,
  );
});

test("distinguishes prose strings from retired alert-tier identifiers and values", () => {
  assert.equal(
    hasRetiredAlertTierReference(
      'test("response critical path remains asynchronous", () => {})',
      ".ts",
    ),
    false,
  );
  assert.equal(
    hasRetiredAlertTierReference(
      "const summary = `most severe first`;",
      ".ts",
    ),
    false,
  );
  assert.equal(
    hasRetiredAlertTierReference(
      'const summary = `ordinary status: ${critical}`;',
      ".ts",
    ),
    true,
  );
  assert.equal(
    hasRetiredAlertTierReference('const tier = "critical";', ".ts"),
    true,
  );
  assert.equal(
    hasRetiredAlertTierReference("const severe = true;", ".ts"),
    true,
  );
});
