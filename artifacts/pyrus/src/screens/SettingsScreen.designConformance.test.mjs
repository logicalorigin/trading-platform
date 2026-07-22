import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("broker cards expose selection and contextual actions as sibling groups", () => {
  const source = readSource("./settings/SnapTradeConnectPanel.jsx");
  const cardBlock =
    /function BrokerChoiceButton[\s\S]*?\n}\n\nexport function SnapTradeConnectPanel/.exec(
      source,
    )?.[0] ?? "";

  assert.match(cardBlock, /role="group"/);
  assert.match(cardBlock, /aria-label=\{`\$\{choice\.label\} broker connection`\}/);
  assert.match(cardBlock, /aria-label=\{`Select \$\{choice\.label\}`\}/);
  assert.match(
    cardBlock,
    /role="group"[\s\S]*?aria-label=\{`\$\{choice\.label\} connection actions`\}/,
  );
  assert.ok(
    cardBlock.indexOf("</button>") <
      cardBlock.indexOf("${choice.label} connection actions"),
  );
  assert.ok(
    cardBlock.indexOf("${choice.label} connection actions") <
      cardBlock.indexOf("actions.map"),
  );
});

test("connected broker cards have no perpetual decorative sheen path", () => {
  const panelSource = readSource("./settings/SnapTradeConnectPanel.jsx");
  const appSource = readSource("../features/platform/PlatformApp.jsx");

  assert.doesNotMatch(panelSource, /spec\.sheen|brokerRingSheen/);
  assert.doesNotMatch(appSource, /@keyframes brokerRingSheen/);
});

test("Settings keeps loading, dirty, apply, success, and restart state visible", () => {
  const source = readSource("./SettingsScreen.jsx");

  assert.match(
    source,
    /getSettingsChangeStatus,[\s\S]*?settleSettingsDrafts,[\s\S]*?from "\.\/settings\/settingsChangeStatus\.js";/,
  );
  assert.match(source, /const \[applyOutcome, setApplyOutcome\] = useState\(null\)/);
  assert.match(source, /getSettingsChangeStatus\(\{/);
  assert.match(source, /settleSettingsDrafts\(\{/);
  assert.match(
    source,
    /data-testid="settings-change-status"[\s\S]*?role="status"[\s\S]*?aria-live="polite"[\s\S]*?aria-atomic="true"/,
  );
  assert.match(source, /settingsChangeStatus\.label/);
  assert.match(source, /pendingRestartCount[\s\S]*?pending restart/);
});

test("editable backend settings give each native select its card label", () => {
  const source = readSource("./SettingsScreen.jsx");
  const cardBlock =
    /function SettingCard[\s\S]*?\n}\n\nfunction useBackendSettings/.exec(source)?.[0] ??
    "";

  assert.match(
    cardBlock,
    /<Select[\s\S]*?ariaLabel=\{setting\.label\}[\s\S]*?options=\{setting\.options\}/,
  );
});

test("Settings does not overlap backend refresh and apply requests", () => {
  const source = readSource("./SettingsScreen.jsx");

  assert.match(
    source,
    /onClick=\{backend\.reload\}[\s\S]*?disabled=\{backend\.loading \|\| backend\.saving\}/,
  );
  assert.match(
    source,
    /onClick=\{backend\.apply\}[\s\S]*?disabled=\{\s*backend\.dirtyCount === 0 \|\| backend\.loading \|\| backend\.saving\s*\}/,
  );
});
