import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const uiTokens = readSource("./uiTokens.jsx");
const typography = readSource("./typography.ts");
const indexCss = readSource("../index.css");
const main = readSource("../main.tsx");
const onboardingCss = readSource(
  "../features/onboarding/onboardingPresentation.css",
);
const overnightPanel = readSource(
  "../features/backtesting/OvernightExpectancyPanel.tsx",
);
const neuralCoreHelpers = readSource(
  "../components/marketing/neural-core/helpers.ts",
);
const packageJson = JSON.parse(readSource("../../package.json"));

const unwantedFamily = ["IBM Plex", "Mono"].join(" ");
const unwantedPackage = ["@fontsource/ibm-plex", "mono"].join("-");

test("data and code roles use the plain-zero Sans family without losing semantic roles", () => {
  assert.match(
    uiTokens,
    /export const FONT_STACKS = \{[\s\S]*?sans: SANS_FONT_STACK,[\s\S]*?data: SANS_FONT_STACK,[\s\S]*?code: SANS_FONT_STACK,/u,
  );
  assert.match(indexCss, /--ra-font-data:\s*var\(--ra-font-sans\);/u);
  assert.match(indexCss, /--ra-font-code:\s*var\(--ra-font-data\);/u);

  for (const [name, source] of [
    ["main", main],
    ["tokens", uiTokens],
    ["global CSS", indexCss],
    ["onboarding CSS", onboardingCss],
    ["Overnight panel", overnightPanel],
    ["neural glyph atlas", neuralCoreHelpers],
  ]) {
    assert.equal(
      source.includes(unwantedFamily) || source.includes(unwantedPackage),
      false,
      `${name} must not nominate the dotted-zero family`,
    );
  }

  assert.equal(
    Object.hasOwn(packageJson.dependencies ?? {}, unwantedPackage) ||
      Object.hasOwn(packageJson.devDependencies ?? {}, unwantedPackage),
    false,
    "the unused dotted-zero package must not remain in the Pyrus bundle graph",
  );
  assert.match(
    neuralCoreHelpers,
    /g\.font = `bold \$\{Math\.floor\(cell \* 0\.7\)\}px "IBM Plex Sans", sans-serif`;/u,
  );
  assert.doesNotMatch(neuralCoreHelpers, /\bmonospace\b/u);
  assert.match(indexCss, /font-variant-numeric:\s*tabular-nums;/u);
});

test("CSS and JavaScript share one value for every core type role", () => {
  const expectedPixels = {
    micro: 7,
    label: 8,
    control: 8,
    body: 10,
    bodyStrong: 11,
    screenTitle: 17,
  };

  for (const [role, pixels] of Object.entries(expectedPixels)) {
    const cssRole = role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    assert.match(uiTokens, new RegExp(`\\b${role}: ${pixels},`, "u"));
    assert.match(typography, new RegExp(`\\b${role}: ${pixels},`, "u"));
    assert.match(
      indexCss,
      new RegExp(`--ra-type-${cssRole}: ${pixels}px;`, "u"),
    );
  }
});
