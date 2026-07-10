import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const haltStripSource = readFileSync(new URL("./HaltStrip.jsx", import.meta.url), "utf8");
const rightRailSource = readFileSync(new URL("./AlgoRightRail.jsx", import.meta.url), "utf8");

test("HaltStrip profile-draft writers share the algo save-drain gate", () => {
  const haltStripRender = rightRailSource.match(/<HaltStrip[\s\S]*?\/>/u)?.[0];
  assert.ok(haltStripRender, "HaltStrip render should exist");
  assert.match(haltStripRender, /saveInProgress=\{pending\}/u);

  assert.match(
    haltStripSource,
    /export const HaltStrip = \(\{[\s\S]*?saveInProgress = false,[\s\S]*?\}\) => \{/u,
  );
  assert.match(
    haltStripSource,
    /const controlsDisabled =\s*!focusedDeployment \|\|\s*!controlBaselineReady \|\|\s*saveInProgress \|\|\s*updateProfileMutation\?\.isPending;/u,
  );
  assert.equal((haltStripSource.match(/disabled=\{controlsDisabled\}/gu) || []).length, 2);
});
