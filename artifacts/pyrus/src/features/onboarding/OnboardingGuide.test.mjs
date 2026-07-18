import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./OnboardingGuide.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("./onboardingPresentation.css", import.meta.url),
  "utf8",
);

test("guide is controlled and cannot invoke product mutations", () => {
  assert.doesNotMatch(
    source,
    /\b(fetch|XMLHttpRequest|sendBeacon|useMutation|useQuery|localStorage|sessionStorage)\b/,
  );
  assert.doesNotMatch(
    source,
    /connect|syncAccounts|placeOrder|submitOrder|SettingsScreen|SnapTradeConnectPanel/,
  );
  assert.match(source, /onPrimary: \(\) => void/);
  assert.match(source, /onPause: \(\) => void/);
  assert.match(source, /onOpenGoals: \(\) => void/);
});

test("guide exposes one named nonmodal region and a static target outline", () => {
  assert.match(source, /role="region"/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /onboarding-target-outline/);
  assert.match(styles, /\.onboarding-target-outline/);
  assert.match(styles, /pointer-events:\s*none/);
  assert.match(styles, /border:\s*2px solid/);
  assert.doesNotMatch(styles, /spotlight|mask-image|animation:/);
});

test("guide keeps pause and goals available beside one primary step action", () => {
  assert.match(source, />\s*Goals\s*</);
  assert.match(source, />\s*Pause\s*</);
  assert.match(source, /\{primaryLabel\}/);
  assert.match(source, /Step \{stepIndex\} of \{totalSteps\}/);
  assert.match(source, /role="status"/);
});

test("Escape pauses the guide and all guide actions meet the touch floor", () => {
  assert.match(source, /useEffect/);
  assert.match(source, /event\.key !== "Escape"/);
  assert.match(source, /event\.defaultPrevented/);
  assert.match(source, /document\.addEventListener\("keydown"/);
  assert.match(source, /document\.removeEventListener\("keydown"/);
  assert.match(
    styles,
    /\.onboarding-guide-actions\s*>\s*\.ra-btn\s*\{[^}]*min-height:\s*44px/s,
  );
});

test("bottom-placed guides clear the desktop Bloomberg Live launcher", () => {
  assert.match(
    styles,
    /@media\s*\(min-width:\s*768px\)\s*\{[^}]*\.onboarding-guide:not\(\[data-placement="top"\]\)\s*\{[^}]*right:\s*62px/s,
  );
});
