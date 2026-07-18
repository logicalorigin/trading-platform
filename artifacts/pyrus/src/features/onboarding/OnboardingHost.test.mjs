import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./OnboardingHost.tsx", import.meta.url),
  "utf8",
);

test("host observes one read-only account contract and no product mutations", () => {
  assert.match(source, /useGetBrokerExecutionIncludedAccounts/);
  assert.doesNotMatch(
    source,
    /use(SetBroker|Connect|Sync|Place|Submit)|connectMutation|syncMutation|placeOrder|submitOrder/,
  );
  assert.doesNotMatch(
    source,
    /\/api\/broker-execution\/(?:snaptrade|robinhood|schwab|ibkr).*(?:connect|sync|import)/,
  );
});

test("automatic opening waits for identity, workspace, and confirmed preferences", () => {
  assert.match(source, /workspaceReady/);
  assert.match(source, /remoteStatus === "confirmed"/);
  assert.match(source, /blockingOverlayPresent/);
  assert.match(source, /shouldAutoOpenOnboarding/);
  assert.match(source, /mark-auto-open-shown/);
  assert.match(source, /autoOpenIdentityRef/);
});

test("modal overlays suspend guide measurement and defer automatic opening", () => {
  assert.match(
    source,
    /dialog\[open\], \[role="dialog"\]/,
  );
  assert.match(source, /MutationObserver/);
  assert.match(
    source,
    /guideVisible = Boolean\([\s\S]*?!blockingOverlayPresent/,
  );
});

test("sync copy exposes a failed local durability fallback", () => {
  assert.match(source, /preferenceStorageStatus/);
  assert.match(source, /preferenceStorageStatus === "failed"/);
  assert.match(source, /"Not saved"/);
});

test("runtime completion uses the closed evidence key", () => {
  assert.match(source, /type: "complete-current-step"/);
  assert.match(source, /owner: "runtime"/);
  assert.match(source, /evidenceKey: "account\.connection-verified"/);
  assert.match(source, /connectReadiness\.satisfied/);
  assert.match(source, /accountState !== "ready"/);
  assert.match(source, /!guideVisible/);
  assert.match(source, /currentStep\.screenId !== activeScreen/);
  assert.match(source, /target\.status !== "ready"/);
  assert.doesNotMatch(source, /execution-ready/);
});

test("runtime completion dedupe resets between verification attempts", () => {
  assert.match(
    source,
    /activeTrackId !== "connect-account" \|\|[\s\S]*?currentStep\?\.id !== "verify-readiness"[\s\S]*?runtimeCompletionRef\.current = null/,
  );
});

test("stale identity cleanup cannot remove the current account query", () => {
  assert.match(
    source,
    /\.finally\(\(\) => \{\s*if \(attachedQueryIdentityRef\.current !== userId\) return;/,
  );
});

test("goal presentation and selection receive the current account observation", () => {
  assert.match(
    source,
    /buildGoalPresentations\(\s*normalizedProgress,\s*connectReadiness,\s*accountState,\s*\)/,
  );
  assert.match(
    source,
    /selectConnectAccountAction\(\s*normalizedProgress,\s*accountState,\s*connectReadiness,\s*\)/,
  );
  assert.match(
    source,
    /selectedGoal\?\.retryable[\s\S]*?inclusionQuery\.refetch\(\)/,
  );
});

test("target lookup is scoped to one active screen host and one anchor", () => {
  assert.match(source, /screen-host-\$\{currentStep\.screenId\}/);
  assert.match(source, /querySelectorAll/);
  assert.match(source, /candidates\.length !== 1/);
  assert.match(source, /data-onboarding-state/);
  assert.match(source, /declaredState !== "ready"/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /\.isConnected/);
  assert.match(source, /scrollIntoView\(\{[\s\S]*?behavior: "auto"/);
  assert.doesNotMatch(source, /behavior: "smooth"/);
});

test("host navigation is limited to the current catalog step", () => {
  assert.match(source, /onNavigate\(currentStep\.screenId!?\)/);
  assert.doesNotMatch(source, /window\.location|history\.|location\.assign/);
});
