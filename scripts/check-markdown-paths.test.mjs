import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCandidate } from "./check-markdown-paths.mjs";

test("checks repository-owned Claude skill references", () => {
  assert.equal(
    normalizeCandidate(".claude/skills/ponytail/SKILL.md", "AGENTS.md"),
    ".claude/skills/ponytail/SKILL.md",
  );
});
