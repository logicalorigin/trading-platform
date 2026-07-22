import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./DiagnosticThresholdSettingsPanel.jsx", import.meta.url),
  "utf8",
);

test("diagnostic threshold refetches preserve an in-progress draft", () => {
  assert.match(source, /const lastThresholdsJsonRef = useRef\(null\)/);
  assert.match(
    source,
    /const expectedJson = submittedThresholdsJson \?\? previousThresholdsJson/,
  );
  assert.match(source, /currentJson === expectedJson/);
  assert.match(source, /\? JSON\.stringify\(submittedThresholds\)/);
  assert.match(
    source,
    /onSuccess: \(payload, variables\)[\s\S]*?applyThresholdPayload\(payload, variables\?\.data\?\.thresholds\)/,
  );
});

test("clearing a diagnostic threshold does not silently coerce it to zero", () => {
  assert.match(
    source,
    /event\.target\.value\s*===\s*""\s*\?\s*null\s*:\s*Number\(event\.target\.value\)/,
  );
  assert.doesNotMatch(
    source,
    /warning: Number\(event\.target\.value\)/,
  );
});
