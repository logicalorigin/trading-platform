import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./HeaderBroadcastScrollerStack.jsx", import.meta.url),
  "utf8",
);

test("phone broadcasts keep every lane behind the explicit trust summary until requested", () => {
  assert.match(source, /buildPhoneBroadcastTrustSummary/);
  assert.match(source, /const \[phoneLanesExpanded, setPhoneLanesExpanded\] = useState\(false\)/);
  assert.match(source, /data-testid="header-broadcast-phone-summary"/);
  assert.match(source, /aria-expanded=\{phoneSummaryExpanded\}/);
  assert.doesNotMatch(
    source,
    /const showSignalLane =[\s\S]{0,220}phoneTrustSummary\.actionableLaneIds\.includes\("signals"\)/,
  );
  assert.doesNotMatch(
    source,
    /const showFlowLane =[\s\S]{0,220}phoneTrustSummary\.actionableLaneIds\.includes\("flow"\)/,
  );
  assert.doesNotMatch(
    source,
    /const showAlgoLane =[\s\S]{0,220}phoneTrustSummary\.actionableLaneIds\.includes\("algo"\)/,
  );
  assert.match(source, /\{showSignalLane \? \(/);
  assert.match(source, /\{showFlowLane \? \(/);
  assert.match(source, /\{showAlgoLane \? \(/);
  assert.match(
    source,
    /gridTemplateRows: isPhone \? "auto" : "auto auto auto"/,
    "the phone stack should grow only after explicit expansion or focus",
  );
});

test("focused phone controls stay mounted until focus safely leaves", () => {
  assert.match(source, /const phoneSummaryRef = useRef\(null\)/);
  assert.match(source, /ref=\{phoneSummaryRef\}/);
  assert.match(
    source,
    /const \[focusedBroadcastLane, setFocusedBroadcastLane\] = useState\(null\)/,
  );
  assert.match(
    source,
    /const \[phoneSummaryFocused, setPhoneSummaryFocused\] = useState\(false\)/,
  );
  assert.match(source, /onFocusCapture=\{handleLaneFocus\}/);
  assert.match(source, /onBlurCapture=\{handleLaneBlur\}/);
  assert.match(source, /const showPhoneSummary = isPhone \|\| phoneSummaryFocused/);
  assert.match(source, /focusedBroadcastLane === "signals"/);
  assert.match(source, /focusedBroadcastLane === "flow"/);
  assert.match(source, /focusedBroadcastLane === "algo"/);
  assert.match(source, /openSettingsLane === "signals"/);
  assert.match(source, /openSettingsLane === "unusual"/);
  assert.match(
    source,
    /target\.closest\?\.\('\[data-testid="header-signal-settings-sheet"\]'\)[\s\S]{0,180}\? "signals"/,
  );
  assert.match(
    source,
    /target\.closest\?\.\('\[data-testid="header-unusual-settings-sheet"\]'\)[\s\S]{0,180}\? "flow"/,
  );
  assert.match(source, /const phoneSummaryExpanded = !isPhone \|\| phoneLanesExpanded/);
  assert.match(source, /aria-expanded=\{phoneSummaryExpanded\}/);
  assert.match(source, /onClick=\{handlePhoneSummaryClick\}/);
  assert.match(source, /\{showPhoneSummary \? \(/);
  assert.doesNotMatch(source, /phoneSummaryRef\.current\?\.focus\(\)/);
});

test("desktop settings state cannot promote into a phone sheet after a breakpoint change", () => {
  const phoneSheetsDrivenOnlyBySharedLaneState = source.match(
    /open=\{isPhone && openSettingsLane === "(?:signals|unusual)"\}/g,
  );

  assert.match(source, /const settingsLayout = isPhone \? "phone" : "desktop"/);
  assert.match(
    source,
    /openSettingsRequest\?\.layout === settingsLayout[\s\S]{0,100}openSettingsRequest\.lane/,
    "only a request created in the current layout may activate settings",
  );
  assert.match(
    source,
    /setOpenSettingsRequest\(lane \? \{ lane, layout: settingsLayout \} : null\)/,
    "an explicit settings action must record its originating layout",
  );
  assert.match(
    source,
    /setOpenSettingsRequest\(null\);[\s\S]{0,40}\}, \[settingsLayout\]\)/,
    "a breakpoint change must invalidate the prior layout's open request",
  );
  assert.deepEqual(
    phoneSheetsDrivenOnlyBySharedLaneState,
    null,
    "phone sheets must require phone-origin settings state, not a desktop popover lane carried across breakpoints",
  );
});
