import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalVerdict } from "./VerdictGlyph.jsx";
import { getTone } from "./tones.js";

test("a closed-lifecycle status resolves to a terminal Closed verdict, not Wait", () => {
  const verdict = resolveSignalVerdict({
    statusMeta: { lifecycle: "closed", label: "Stopped", tone: getTone("dim") },
  });
  assert.equal(verdict.bucket, "closed");
  assert.equal(verdict.label, "Stopped");
  assert.equal(verdict.tone, getTone("dim"));
});

test("a closed status with no label falls back to the Closed label", () => {
  const verdict = resolveSignalVerdict({ statusMeta: { lifecycle: "closed" } });
  assert.equal(verdict.bucket, "closed");
  assert.equal(verdict.label, "Closed");
});

test("an explicit blocker still takes precedence over the closed lifecycle", () => {
  const verdict = resolveSignalVerdict({
    blocker: "max_open_symbols_reached",
    statusMeta: { lifecycle: "closed", label: "Closed" },
  });
  assert.equal(verdict.bucket, "pass");
});

test("a non-closed status is unaffected by the closed branch and waits", () => {
  const verdict = resolveSignalVerdict({
    signal: { fresh: false },
    statusMeta: { label: "Awaiting confirmation" },
  });
  assert.equal(verdict.bucket, "wait");
});
