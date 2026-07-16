import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateExists,
  normalizeCandidate,
} from "./check-markdown-paths.mjs";

test("checks repository-owned Claude skill references", () => {
  assert.equal(
    normalizeCandidate(".claude/skills/ponytail/SKILL.md", "AGENTS.md"),
    ".claude/skills/ponytail/SKILL.md",
  );
});

test("accepts the API deployment entrypoint before its build creates dist", () => {
  assert.equal(
    candidateExists("CLAUDE.md", "artifacts/api-server/dist/index.mjs"),
    true,
  );
});
