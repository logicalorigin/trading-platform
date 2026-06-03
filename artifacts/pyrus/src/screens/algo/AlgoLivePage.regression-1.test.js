import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const livePageSource = readFileSync(
  new URL("./AlgoLivePage.jsx", import.meta.url),
  "utf8",
);

test("mobile algo settings drawer portals to the document body", () => {
  assert.match(livePageSource, /import \{ createPortal \} from "react-dom";/);
  assert.match(
    livePageSource,
    /algoIsPhone && settingsDrawerOpen && typeof document !== "undefined"/,
  );
  assert.match(
    livePageSource,
    /createPortal\(\([\s\S]*data-testid="algo-settings-drawer"[\s\S]*document\.body\)/,
  );
});

test("safe QA mode disables algo header mutation controls", () => {
  assert.match(livePageSource, /const safeQaControlsPaused = Boolean\(safeQaMode\);/);
  assert.match(
    livePageSource,
    /const deploymentToggleDisabled =[\s\S]*safeQaControlsPaused[\s\S]*enableDeploymentMutation\?\.isPending[\s\S]*pauseDeploymentMutation\?\.isPending;/,
  );
  assert.match(
    livePageSource,
    /const scanButtonDisabled =[\s\S]*safeQaControlsPaused \|\| scanOperationRunning;/,
  );
  assert.match(
    livePageSource,
    /Deployment controls paused in safe QA/,
  );
  assert.match(
    livePageSource,
    /Options strategy scan paused in safe QA/,
  );
  assert.match(livePageSource, /Options strategy scan already running/);
});
