import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./LoginGate.jsx", import.meta.url), "utf8");

test("auth-session failures render a fail-closed retry state instead of the sign-in form", () => {
  assert.match(source, /const \{[\s\S]*?isError[\s\S]*?refresh[\s\S]*?\} = useAuthSession\(\)/);

  const signedInOffset = source.indexOf("if (signedIn)");
  const recoveryOffset = source.indexOf("if (isError)");
  assert.ok(signedInOffset >= 0 && signedInOffset < recoveryOffset);

  const recoveryState = source.match(
    /if \(isError\) \{[\s\S]*?\n  \}\n\n  return \(/,
  )?.[0] ?? "";

  assert.match(recoveryState, /Sign-in status unavailable/);
  assert.match(recoveryState, /role="alert"/);
  assert.match(recoveryState, /dataTestId="login-gate-session-retry"/);
  assert.match(recoveryState, /onClick=\{\(\) => void refresh\(\)\}/);
  assert.doesNotMatch(recoveryState, /id="email"|id="password"/);
});

test("authentication copy stays distinct from product onboarding", () => {
  assert.match(source, /"Use your operator account to continue\."/);
  assert.match(
    source,
    /"Create the first operator account for this installation\."/,
  );
  assert.doesNotMatch(source, /Welcome back|to get started/);
});

test("first-run secret guidance is attached to the relevant inputs", () => {
  assert.match(
    source,
    /aria-describedby=\{isFirstRun \? "login-gate-password-help" : undefined\}/,
  );
  assert.match(source, /id="login-gate-password-help"/);
  assert.match(
    source,
    /id="bootstrapToken"[\s\S]*?autoComplete="off"[\s\S]*?aria-describedby="login-gate-bootstrap-token-help"/,
  );
  assert.match(source, /id="login-gate-bootstrap-token-help"/);
});
