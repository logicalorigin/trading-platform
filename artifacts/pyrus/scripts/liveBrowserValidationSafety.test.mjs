import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const e2eUrl = new URL("../e2e/", import.meta.url);
const readSpec = (name) =>
  readFileSync(fileURLToPath(new URL(name, e2eUrl)), "utf8");

test("live browser validations require an explicit opt-in", () => {
  for (const name of [
    "algo-panel-save.browser-validation.spec.ts",
    "chart-hydration.browser-validation.spec.ts",
    "snaptrade-surfaces.browser-validation.spec.ts",
  ]) {
    assert.match(
      readSpec(name),
      /test\.skip\(\s*process\.env\.PYRUS_LIVE_BROWSER_VALIDATION !== "1"/,
      `${name} can otherwise run against the live app during broad Playwright discovery`,
    );
  }
});

test("Algo mutation validation requires separate approval and restores state", () => {
  const source = readSpec("algo-panel-save.browser-validation.spec.ts");

  assert.match(
    source,
    /test\.skip\(\s*process\.env\.PYRUS_MUTATING_BROWSER_VALIDATION !== "1"/,
  );
  assert.match(source, /finally\s*\{[\s\S]*await restoreOriginalValue\(/);
});

test("chart hydration does not request live data while claiming safe QA", () => {
  const source = readSpec("chart-hydration.browser-validation.spec.ts");

  assert.doesNotMatch(source, /screen=market&qa=safe/);
});

test("sign-in validation mocks both auth endpoints and checks the login POST", () => {
  const source = readSpec("auth-signin.browser-validation.spec.ts");

  assert.match(source, /page\.route\("\*\*\/api\/auth\/session"/);
  assert.match(source, /page\.route\("\*\*\/api\/auth\/login"/);
  assert.match(source, /request\.startsWith\("POST "\)/);
});
