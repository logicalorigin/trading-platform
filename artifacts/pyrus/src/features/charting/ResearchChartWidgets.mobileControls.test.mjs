import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const widgetsSource = readLocalSource("./ResearchChartWidgets.tsx");
const toolbarSource = readLocalSource("./ChartMobileToolbar.tsx");
const sheetsSource = readLocalSource("./ChartMobileSheets.tsx");
const frameSource = readLocalSource("./ResearchChartFrame.tsx");

test("phone charts mount the shared thumb toolbar and existing bottom sheets", () => {
  assert.match(
    widgetsSource,
    /import \{[\s\S]{0,160}?ChartMobileToolbar,[\s\S]{0,160}?\} from "\.\/ChartMobileToolbar";/,
  );
  assert.match(
    widgetsSource,
    /if \(isPhone\) \{[\s\S]*?<ChartMobileToolbar[\s\S]*?<TimeframeSheet[\s\S]*?<IndicatorPickerSheet[\s\S]*?<DrawingToolsSheet/,
  );
  assert.match(toolbarSource, /minHeight: dim\(44\)/);
  assert.match(toolbarSource, /aria-label=\{label\}/);
  assert.match(toolbarSource, /disabled=\{disabled\}/);
});

test("phone chart chrome reserves the toolbar and replaces the narrow drawing rail", () => {
  assert.match(frameSource, /MOBILE_CHART_HEADER_HEIGHT/);
  assert.match(frameSource, /MOBILE_CHART_TOOLBAR_HEIGHT/);
  assert.match(
    frameSource,
    /isPhone && surfaceTopOverlay[\s\S]*?MOBILE_CHART_HEADER_HEIGHT/,
  );
  assert.match(
    frameSource,
    /isPhone && surfaceBottomOverlay[\s\S]*?MOBILE_CHART_TOOLBAR_HEIGHT/,
  );
  assert.match(
    frameSource,
    /frameDensity === "minimal" \|\| isPhone \? null : surfaceLeftOverlay/,
  );
  assert.match(
    frameSource,
    /frameDensity === "minimal" && !isPhone \? null : surfaceBottomOverlay/,
  );
  assert.match(
    widgetsSource,
    /if \(frameDensity === "minimal" && !isPhone\) \{/,
  );
});

test("phone-only sheets keep long labels contained and touch targets usable", () => {
  assert.match(sheetsSource, /title="Chart tools"/);
  assert.match(sheetsSource, /overflowWrap: "anywhere"/);
  assert.match(sheetsSource, /minHeight: dim\(44\)/);
  assert.match(sheetsSource, /minHeight: dim\(46\)/);
  assert.match(sheetsSource, /width: dim\(44\)/);
  assert.match(sheetsSource, /testId="chart-mobile-tool-undo"/);
  assert.match(sheetsSource, /testId="chart-mobile-tool-snapshot"/);
});

test("dense desktop actions are not duplicated in the phone header", () => {
  assert.match(widgetsSource, /showUndoRedo && !minimalChrome && !isPhone/);
  assert.match(widgetsSource, /showSnapshotButton && !minimalChrome && !isPhone/);
  assert.match(widgetsSource, /showFullscreenButton && !isPhone/);
});

test("narrow embedded desktop charts keep trailing header actions reachable", () => {
  assert.match(widgetsSource, /data-testid="chart-header-control-strip"/);
  assert.match(widgetsSource, /overflowX: "auto"/);
  assert.match(widgetsSource, /overscrollBehaviorX: "contain"/);
});
