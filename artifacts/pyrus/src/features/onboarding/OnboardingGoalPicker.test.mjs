import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pickerSource = readFileSync(
  new URL("./OnboardingGoalPicker.tsx", import.meta.url),
  "utf8",
);
const surfaceSource = readFileSync(
  new URL("./OnboardingSurface.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("./onboardingPresentation.css", import.meta.url),
  "utf8",
);

test("goal picker is a controlled, side-effect-free presentation boundary", () => {
  assert.doesNotMatch(
    pickerSource + surfaceSource,
    /\b(fetch|XMLHttpRequest|sendBeacon|useMutation|useQuery|localStorage|sessionStorage)\b/,
  );
  assert.doesNotMatch(
    pickerSource,
    /PlatformShell|SettingsScreen|SnapTradeConnectPanel|useUserPreferences/,
  );
  assert.match(pickerSource, /goals: readonly OnboardingGoalPresentation\[\]/);
  assert.match(pickerSource, /onSelectGoal: \(goalId: string\) => void/);
  assert.match(pickerSource, /onReviewEssentials: \(\) => void/);
});

test("goal picker renders readiness first and goals as one ordered flat checklist", () => {
  assert.match(
    pickerSource,
    /onboarding-readiness-band[\s\S]*?<ol[\s\S]*?aria-label="Getting Started goals"/,
  );
  assert.match(
    pickerSource,
    /aria-describedby=\{`\$\{descriptionId\} \$\{statusId\}`\}/,
  );
  assert.match(pickerSource, /aria-current=\{goal\.state === "active" \? "step" : undefined\}/);
  assert.match(pickerSource, /Close and pause Getting Started/);
  assert.doesNotMatch(
    pickerSource + styles,
    /\b(Card|SurfacePanel|StatTile|progress-ring|linear-gradient|radial-gradient)\b/,
  );
});

test("goal rows expose all truthful states and keep one whole-row action", () => {
  for (const state of [
    "available",
    "active",
    "paused",
    "completed",
    "updated",
    "setup-needed",
    "checking",
    "stale",
    "status-unavailable",
    "unavailable",
  ]) {
    assert.match(pickerSource, new RegExp(`"${state}"`));
  }
  assert.match(pickerSource, /Recommended/);
  assert.match(pickerSource, /Prior completion retained\./);
  assert.match(pickerSource, /Review essentials first/);
  assert.match(pickerSource, /<button[\s\S]*?onClick=\{\(\) => onSelectGoal\(goal\.id\)\}/);
  assert.doesNotMatch(pickerSource, /<button[\s\S]*?<Button[\s\S]*?<\/button>/);
});

test("adaptive surface uses a phone sheet and a tablet/desktop dialog", () => {
  assert.match(surfaceSource, /useViewportBelow\("phone"\)/);
  assert.match(surfaceSource, /<BottomSheet/);
  assert.match(surfaceSource, /<Dialog\.Root/);
  assert.match(surfaceSource, /closeLabel=\{closeLabel\}/);
  assert.match(surfaceSource, /initialFocusRef=\{initialFocusRef\}/);
  assert.match(styles, /width:\s*min\(620px,\s*calc\(100vw - 32px\)\)/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /min-height:\s*72px/);
  assert.match(styles, /min-height:\s*44px/);
});
