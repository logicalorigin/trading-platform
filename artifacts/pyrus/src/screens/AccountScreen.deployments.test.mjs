import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AccountScreen.jsx", import.meta.url), "utf8");

test("Account screen loads the signed-in user's deployment inventory for broker cards", () => {
  assert.match(source, /useListAlgoDeployments/);
  assert.match(source, /const accountDeploymentsQuery = useListAlgoDeployments/);
  assert.match(source, /enabled: Boolean\(isVisible && !safeQaMode\)/);
  assert.match(source, /deployments=\{accountDeploymentsQuery\.data\?\.deployments \|\| \[\]\}/);
  assert.match(source, /deploymentInventoryState=\{accountDeploymentInventoryState\}/);
});
