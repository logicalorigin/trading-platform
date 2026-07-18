import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("./SettingsScreen.jsx", import.meta.url),
  "utf8",
);
const catalogSource = readFileSync(
  new URL("../features/onboarding/onboardingCatalog.ts", import.meta.url),
  "utf8",
);

test("Settings exposes one stable route root and Data & Broker tab target", () => {
  assert.equal(
    (settingsSource.match(/data-onboarding-anchor="settings-root"/g) || [])
      .length,
    1,
  );
  assert.equal(
    (
      settingsSource.match(
        /data-onboarding-anchor=\{[\s\S]*?"settings-data-broker-tab"/g,
      ) || []
    ).length,
    1,
  );
  assert.match(settingsSource, /aria-pressed=\{activeTab === tab\.id\}/);
  assert.match(settingsSource, /data-onboarding-state="ready"/);
  assert.match(catalogSource, /anchorId: "settings-data-broker-tab"/);
});
