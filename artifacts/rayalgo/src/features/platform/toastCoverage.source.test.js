import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("user-triggered platform actions have toast coverage", () => {
  const platformApp = readSource("./PlatformApp.jsx");
  const accountScreen = readSource("../../screens/AccountScreen.jsx");
  const settingsScreen = readSource("../../screens/SettingsScreen.jsx");
  const thresholdsPanel = readSource(
    "../../screens/settings/DiagnosticThresholdSettingsPanel.jsx",
  );
  const backtestingPanels = readSource("../backtesting/BacktestingPanels.tsx");

  assert.match(platformApp, /Watchlist created/);
  assert.match(platformApp, /Unable to create watchlist/);
  assert.match(platformApp, /Signal monitor enabled/);
  assert.match(platformApp, /Signal scan complete/);

  assert.match(accountScreen, /Shadow backtest complete/);
  assert.match(accountScreen, /Shadow backtest failed/);
  assert.match(accountScreen, /Order cancel submitted/);
  assert.match(accountScreen, /Flex token verified/);

  assert.match(settingsScreen, /Backend settings applied/);
  assert.match(settingsScreen, /Signal monitor settings saved/);
  assert.match(settingsScreen, /IBKR lane settings saved/);
  assert.match(settingsScreen, /Storage dry run complete/);
  assert.match(settingsScreen, /IBKR bridge override cleared/);
  assert.match(thresholdsPanel, /Diagnostic thresholds saved/);

  assert.match(backtestingPanels, /const toast = useToast\(\)/);
  assert.match(backtestingPanels, /showBanner/);
  assert.match(backtestingPanels, /Pine script saved/);
  assert.match(backtestingPanels, /Run queued/);
  assert.match(backtestingPanels, /Sweep queued/);
  assert.match(backtestingPanels, /Cancellation requested/);
});

test("routine ticker navigation into Trade does not toast", () => {
  const platformApp = readSource("./PlatformApp.jsx");

  assert.doesNotMatch(platformApp, /loaded into Trade/);
  assert.doesNotMatch(platformApp, /signal-option context loaded/);
  assert.doesNotMatch(platformApp, /Trade preloaded/);
});
