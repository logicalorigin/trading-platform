import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../platform/PlatformApp.jsx");
const shell = read("../platform/PlatformShell.jsx");
const header = read("../platform/AppHeader.jsx");
const palette = read("../platform/CommandPalette.jsx");
const more = read("../platform/MobileMoreSheet.jsx");

test("desktop command palette owns one permanent Getting Started action", () => {
  assert.match(palette, /id: "getting-started:open"/);
  assert.match(palette, /label: "Open Getting Started"/);
  assert.match(palette, /run: \(\) => onOpenGettingStarted\(\)/);
  assert.match(header, /onOpenGettingStarted=\{onOpenGettingStarted\}/);
  assert.match(shell, /onOpenGettingStarted=\{onOpenGettingStarted\}/);
});

test("phone More owns one 44px Getting Started action", () => {
  assert.match(more, /label="Getting Started"/);
  assert.match(more, /testId="mobile-more-getting-started"/);
  assert.match(more, /onClick=\{\(\) => handleAction\(onOpenGettingStarted\)\}/);
  assert.match(shell, /onOpenGettingStarted=\{onOpenGettingStarted\}/);
});

test("PlatformApp mounts one host and shares the same open callback", () => {
  assert.match(app, /import \{ OnboardingHost \}/);
  assert.match(app, /<OnboardingHost/);
  assert.match(app, /onOpenGettingStarted=\{openGettingStarted\}/);
  assert.match(app, /onRequestedOpenChange=\{setGettingStartedOpen\}/);
  assert.match(
    app,
    /preferenceStorageStatus=\{userPreferences\.onboardingStorageStatus\}/,
  );
});
