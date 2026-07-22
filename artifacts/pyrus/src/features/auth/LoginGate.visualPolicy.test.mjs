import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginGateSource = readFileSync(new URL("./LoginGate.jsx", import.meta.url), "utf8");
const bootShellSource = readFileSync(
  new URL("../../components/neural/BootShellLayout.tsx", import.meta.url),
  "utf8",
);
const appStyles = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

test("auth delegates its only neural cloud to the shared boot shell", () => {
  assert.match(loginGateSource, /BootShellLayout/);
  assert.doesNotMatch(loginGateSource, /NeuralCoreScene|AmbientCloud/);
  assert.match(
    bootShellSource,
    /isNeuralWebglRendererSupported/,
    "loader cloud should reject software/headless WebGL renderers",
  );
});

test("auth wall uses the shared single-column shell", () => {
  assert.match(loginGateSource, /surface="auth"/);
  assert.doesNotMatch(loginGateSource, /gridTemplateColumns|useViewportBelow/);
  assert.doesNotMatch(bootShellSource, /pyrus-boot-content/);
});

test("auth suppresses its cloud while the opener owns WebGL", () => {
  assert.match(
    loginGateSource,
    /useSyncExternalStore\(\s*subscribeNeuralOpenerActive,\s*isNeuralOpenerActive,\s*\)/,
    "LoginShell must rerender after the opener releases its WebGL context",
  );
  assert.match(loginGateSource, /cloudSuppressed=\{openerActive\}/);
});

test("signed-out auth settles the workspace route boot blocker", () => {
  const signedOutSkip = loginGateSource.match(
    /skipBootProgressTasks\([\s\S]*?"Signed-out visitor — showing sign-in"[\s\S]*?\);/,
  )?.[0];

  assert.ok(signedOutSkip, "missing signed-out boot task cleanup");
  assert.match(
    signedOutSkip,
    /"workspace-route-chunk"/,
    "the workspace route never mounts while signed out, so its boot task must be skipped",
  );
});

test("loading and idle auth branding contain no standalone mark", () => {
  assert.doesNotMatch(bootShellSource, /BrandResolve|PyrusMark/);
  assert.match(bootShellSource, /PyrusWordmark/);
});

test("idle sign-in does not render a hidden loading animation", () => {
  assert.match(bootShellSource, /\{loading \? \(/);
  assert.doesNotMatch(appStyles, /\.pyrus-loading:not\(\[role="status"\]\)/);
});

test("auth exposes its page title as the primary heading", () => {
  assert.match(loginGateSource, /<h1[\s\S]*?First-time setup[\s\S]*?Sign in[\s\S]*?<\/h1>/);
  assert.doesNotMatch(loginGateSource, /\bCardTitle\b/);
});

test("the submit button shows truthful progress for the full authentication wait", () => {
  const submitButton = loginGateSource.match(
    /<Button[\s\S]*?dataTestId="login-gate-submit"[\s\S]*?<\/Button>/,
  )?.[0];

  assert.ok(submitButton, "missing login submit button");
  assert.match(submitButton, /loading=\{pending\}/);
  assert.match(submitButton, /aria-busy=\{pending\}/);
  assert.match(submitButton, /pending[\s\S]*?Signing in…/);
  assert.match(submitButton, /pending[\s\S]*?Creating account…/);
});

test("auth buttons retain the 44px touch floor outside the workspace shell", () => {
  assert.match(
    appStyles,
    /\.pyrus-boot-loader\[data-surface="auth"\] \.ra-touch-target\s*\{[^}]*min-width:\s*44px !important;[^}]*min-height:\s*44px !important;[^}]*\}/s,
  );
});
