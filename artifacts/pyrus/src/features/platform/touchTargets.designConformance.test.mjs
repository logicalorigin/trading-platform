import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cssSource = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("./PlatformShell.jsx", import.meta.url),
  "utf8",
);
const primitivesSource = readFileSync(
  new URL("../../components/platform/primitives.jsx", import.meta.url),
  "utf8",
);
const algoLiveSource = readFileSync(
  new URL("../../screens/algo/AlgoLivePage.jsx", import.meta.url),
  "utf8",
);
const flowSource = readFileSync(
  new URL("../../screens/FlowScreen.jsx", import.meta.url),
  "utf8",
);
const flowDistributionSource = readFileSync(
  new URL("../flow/FlowDistributionScannerPanel.jsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../../screens/SettingsScreen.jsx", import.meta.url),
  "utf8",
);

test("browser zoom remains user-controlled while CSS touch floors stay stable", () => {
  assert.doesNotMatch(shellSource, /SCREEN_FIT_(?:DESIGN_WIDTH|MIN_SCALE)/);
  assert.doesNotMatch(shellSource, /screenFitZoom/);
  assert.doesNotMatch(shellSource, /\bzoom:/);
  assert.doesNotMatch(cssSource, /--screen-fit-counter-zoom/);
  assert.match(
    cssSource,
    /\.ra-touch-target\s*\{[^}]*min-width:\s*24px[^}]*min-height:\s*24px/s,
  );
  assert.match(
    cssSource,
    /\.ra-shell\[data-viewport="phone"\] \.ra-touch-target,[\s\S]*?\.ra-shell\[data-viewport="tablet"\] \.ra-touch-target\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/,
  );
  assert.match(
    cssSource,
    /\.ra-shell\[data-viewport="phone"\] \.ra-touch-target,[\s\S]*?\.ra-shell\[data-viewport="tablet"\] \.ra-touch-target\s*\{[^}]*min-width:\s*44px !important;[^}]*min-height:\s*44px !important;/,
  );
  assert.match(
    cssSource,
    /\.ra-touch-target-y\s*\{[^}]*min-height:\s*24px/s,
  );
  assert.match(
    cssSource,
    /\.ra-shell\[data-viewport="phone"\] \.ra-touch-target-y,[\s\S]*?\.ra-shell\[data-viewport="tablet"\] \.ra-touch-target-y\s*\{[^}]*min-height:\s*44px/,
  );
});

test("canonical compact controls opt into the shared vertical touch floor", () => {
  const segmentedControlSource = primitivesSource.slice(
    primitivesSource.indexOf("export const SegmentedControl"),
    primitivesSource.indexOf("export const TextField"),
  );
  const textFieldSource = primitivesSource.slice(
    primitivesSource.indexOf("export const TextField"),
    primitivesSource.indexOf("export const Select"),
  );
  const selectSource = primitivesSource.slice(
    primitivesSource.indexOf("export const Select"),
    primitivesSource.indexOf("export const ChartFrame"),
  );

  assert.match(
    segmentedControlSource,
    /isTouchViewport\s*\?\s*"ra-interactive ra-touch-target-y"/,
  );
  assert.match(textFieldSource, /ra-textfield[^"\n]*ra-touch-target-y/);
  assert.match(selectSource, /ra-textfield[^"\n]*ra-touch-target-y/);
});

test("portaled narrow drawers retain the physical touch floors", () => {
  assert.match(
    cssSource,
    /\.ra-touch-surface \.ra-touch-target\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px/s,
  );
  assert.match(
    cssSource,
    /\.ra-touch-surface \.ra-touch-target-y\s*\{[^}]*min-height:\s*44px/s,
  );
  assert.match(
    algoLiveSource,
    /data-testid="algo-settings-drawer"[\s\S]{0,160}className="ra-touch-surface"/,
  );
});

test("screen-specific compact controls opt into mobile touch floors", () => {
  for (const testId of ["flow-filter-toggle", "flow-column-toggle"]) {
    assert.match(
      flowSource,
      new RegExp(`data-testid="${testId}"[\\s\\S]{0,120}className="ra-touch-target"`),
    );
  }
  assert.match(
    flowSource,
    /data-testid=\{`flow-built-in-preset-\$\{preset\.id\}`\}[\s\S]{0,160}className="ra-touch-target"/,
  );
  assert.match(
    flowSource,
    /aria-label="Clear active Flow preset"[\s\S]{0,160}className="ra-touch-target"/,
  );
  assert.match(
    flowSource,
    /data-testid="flow-symbol-filter-chip"[\s\S]{0,160}className="ra-touch-target"/,
  );
  assert.match(
    flowDistributionSource,
    /data-testid=\{`flow-premium-bucket-toggle-\$\{bucket\}`\}[\s\S]{0,120}className="ra-touch-target"/,
  );
  assert.match(
    settingsSource,
    /data-testid=\{`settings-tab-\$\{tab\.id[\s\S]{0,180}className="ra-touch-target"/,
  );
  assert.match(
    cssSource,
    /\[data-testid="settings-screen"\]\[data-layout="phone"\] \[style\*="min-width"\]:not\(\.ra-touch-target\)/,
  );
  assert.match(
    settingsSource,
    /className="ra-touch-target-y"[\s\S]{0,300}Use active watchlist/,
  );
  assert.match(
    cssSource,
    /#root \[data-testid="backtest-workspace"\]\[data-layout="phone"\] button,[\s\S]*?min-width:\s*44px !important;[\s\S]*?min-height:\s*44px !important;/,
  );
});
