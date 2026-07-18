import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./SafetyEssentials.tsx", import.meta.url),
  "utf8",
);

test("safety essentials stays controlled and has no product side effects", () => {
  assert.doesNotMatch(
    source,
    /\b(fetch|XMLHttpRequest|sendBeacon|useMutation|useQuery|localStorage|sessionStorage)\b/,
  );
  assert.doesNotMatch(
    source,
    /PlatformShell|SettingsScreen|SnapTradeConnectPanel|useUserPreferences/,
  );
  assert.match(source, /step: 1 \| 2 \| 3/);
  assert.match(source, /onAdvance: \(\) => void/);
  assert.match(source, /onFinish: \(\) => void/);
});

test("step one contrasts Live and Shadow with text, not color alone", () => {
  assert.match(source, /Live and Shadow/);
  assert.match(source, /LIVE \/ REAL/);
  assert.match(source, /Can route real orders through the selected broker account\./);
  assert.match(source, /SHADOW/);
  assert.match(source, /No live broker order is created\./);
});

test("step two preserves the production review boundary", () => {
  assert.match(source, /Onboarding has no execution access/);
  assert.match(
    source,
    /Onboarding never submits\. Live execution remains in Trade and still requires PYRUS review and confirmation\./,
  );
  assert.match(source, /No walkthrough changes an order or bypasses an execution gate\./);
  assert.match(source, /I understand the boundary/);
});

test("step three presents read-only readiness and allows setup-needed completion", () => {
  assert.match(source, /Inspect current readiness/);
  assert.match(source, /<dl/);
  assert.match(source, /readinessFacts\.map/);
  assert.match(source, /Not ready does not fail this review\./);
  assert.match(source, /Current readiness is unavailable\. Retry, or finish with the state shown\./);
  assert.match(
    source,
    /Account setup needed\. Connect Account remains available after essentials are complete\./,
  );
  assert.match(source, /Checking readiness…/);
  assert.match(source, /Finish essentials/);
});

test("safety flow exposes ordered progress and accessible live status", () => {
  assert.match(source, /Step \{step\} of 3/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /role="status"/);
  assert.match(source, /<Button/);
});
