import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./SnapTradeConnectPanel.jsx", import.meta.url),
  "utf8",
);

test("broker setup exposes one provider target and one retained readiness target", () => {
  assert.equal(
    (source.match(/data-onboarding-anchor="broker-provider-controls"/g) || [])
      .length,
    1,
  );
  assert.equal(
    (source.match(/data-onboarding-anchor="broker-readiness"/g) || []).length,
    1,
  );
  assert.match(source, /const onboardingReadinessState =/);
  for (const state of ["loading", "ready", "empty", "error", "stale"]) {
    assert.match(source, new RegExp(`"${state}"`));
  }
  assert.match(
    source,
    /data-onboarding-state=\{onboardingReadinessState\}/,
  );
  assert.match(
    source,
    /<div\s+data-onboarding-anchor="broker-provider-controls"(?:(?!<div)[\s\S])*?Broker target\s*<\/div>/,
  );
});
