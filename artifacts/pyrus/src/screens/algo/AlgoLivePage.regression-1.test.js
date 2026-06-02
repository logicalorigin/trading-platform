import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const livePageSource = readFileSync(
  new URL("./AlgoLivePage.jsx", import.meta.url),
  "utf8",
);

test("safe QA mode disables algo header mutation controls", () => {
  assert.match(livePageSource, /const safeQaControlsPaused = Boolean\(safeQaMode\);/);
  assert.match(
    livePageSource,
    /const deploymentToggleDisabled =[\s\S]*safeQaControlsPaused[\s\S]*enableDeploymentMutation\?\.isPending[\s\S]*pauseDeploymentMutation\?\.isPending;/,
  );
  assert.match(
    livePageSource,
    /const scanButtonDisabled =[\s\S]*safeQaControlsPaused \|\| runShadowScanMutation\?\.isPending;/,
  );
  assert.match(
    livePageSource,
    /Deployment controls paused in safe QA/,
  );
  assert.match(
    livePageSource,
    /Signal-options scan paused in safe QA/,
  );
});
