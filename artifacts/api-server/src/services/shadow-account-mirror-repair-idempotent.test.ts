import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

// Read-triggered mirror repair replays unmirrored signal-options exit events by placing a
// shadow SELL order. When the position is already flat (its entry was never mirrored, or it
// was already closed) placeShadowOrder throws 409 shadow_long_only_position_required; the
// event then never mirrors and the repair retries and logs an error on every read. The exit
// mirror must treat that specific case as a benign no-op.
test("signal-options shadow exit mirror treats an already-flat position as a no-op", () => {
  const start = source.indexOf("async function recordShadowAutomationExit");
  const end = source.indexOf("async function recordShadowAutomationMark", start);
  assert.notEqual(start, -1, "Missing recordShadowAutomationExit");
  assert.notEqual(end, -1, "Missing recordShadowAutomationExit end marker");
  const body = source.slice(start, end);

  // Awaited inside try/catch so the rejection is caught here rather than surfacing to the
  // repair loop as an error.
  assert.match(body, /return await placeShadowOrder\(/);
  assert.match(body, /error instanceof HttpError/);
  assert.match(body, /error\.code === "shadow_long_only_position_required"/);
  assert.match(body, /return null;/);
  // Any other error must still propagate.
  assert.match(body, /throw error;/);
});

test("automation mirror dispatch is pinned to the platform shadow ledger", () => {
  const start = source.indexOf("export async function recordShadowAutomationEvent");
  const end = source.indexOf("async function recordShadowAutomationEntry", start);
  assert.notEqual(start, -1, "Missing recordShadowAutomationEvent");
  assert.notEqual(end, -1, "Missing recordShadowAutomationEvent end marker");
  const body = source.slice(start, end);

  assert.match(
    body,
    /return runWithShadowAccountId\(SHADOW_ACCOUNT_ID,\s*async \(\) => \{/,
  );
});
