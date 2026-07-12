import assert from "node:assert/strict";
import test from "node:test";

import { shouldIgnore } from "./check-legacy-branding.mjs";

test("ignores handoff artifacts only at the repository root", () => {
  assert.equal(shouldIgnore("SESSION_HANDOFF_2026-07-12_example.md"), true);
  assert.equal(shouldIgnore("AGENT_CHAT_LIVE.jsonl"), true);
  assert.equal(shouldIgnore("scripts/SESSION_HANDOFF_branding.ts"), false);
  assert.equal(shouldIgnore("src/AGENT_CHAT_branding.ts"), false);
});
