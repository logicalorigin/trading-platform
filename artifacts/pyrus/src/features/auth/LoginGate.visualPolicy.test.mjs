import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginGateSource = readFileSync(new URL("./LoginGate.jsx", import.meta.url), "utf8");
const bootShellSource = readFileSync(
  new URL("../../components/neural/BootShellLayout.tsx", import.meta.url),
  "utf8",
);

test("login and loader ambient clouds require a supported WebGL renderer", () => {
  assert.match(
    loginGateSource,
    /isNeuralWebglRendererSupported/,
    "login ambient cloud should reject software/headless WebGL renderers",
  );
  assert.doesNotMatch(
    loginGateSource,
    /!isWebglAvailable\(\)/,
    "login ambient cloud should not use availability-only WebGL gating",
  );
  assert.match(
    bootShellSource,
    /isNeuralWebglRendererSupported/,
    "loader cloud should reject software/headless WebGL renderers",
  );
});

test("login form side uses a calmer ambient cloud policy", () => {
  assert.match(
    loginGateSource,
    /const LOGIN_AMBIENT_CLOUD_OPACITY = 0\.[0-5][0-9]?;/,
    "login ambient cloud opacity should stay low enough for form readability",
  );
  assert.match(
    loginGateSource,
    /const LOGIN_CLOUD_MASK =/,
    "login ambient mask should be explicit and separate from the loader mask",
  );
});

test("shared boot brand reacts when the neural opener releases WebGL", () => {
  assert.match(
    bootShellSource,
    /useSyncExternalStore\(\s*subscribeNeuralOpenerActive,\s*isNeuralOpenerActive,\s*\)/,
    "BootBrandColumn must rerender after the opener releases its WebGL context",
  );
});
