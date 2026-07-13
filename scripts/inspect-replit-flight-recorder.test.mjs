import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  incidentAttribution,
  readJsonlTail,
  value,
} from "./inspect-replit-flight-recorder.mjs";

test("flight-recorder JSONL tails read a bounded suffix", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flight-recorder-tail-"));
  try {
    const file = path.join(dir, "events.jsonl");
    writeFileSync(
      file,
      `${JSON.stringify({ event: "old", payload: "x".repeat(2_000) })}\n` +
        `${JSON.stringify({ event: "kept-1" })}\n` +
        `${JSON.stringify({ event: "kept-2" })}\n`,
    );
    assert.deepEqual(readJsonlTail(file, 2, 128), [
      { event: "kept-1" },
      { event: "kept-2" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plain flight-recorder values contain no terminal or multiline controls", () => {
  assert.equal(
    value("safe\n\u001b[31mred\u001b[0m\u0000\u202Espoof"),
    "safe red spoof",
  );
});

test("persisted controlled handoffs receive neutral attribution", () => {
  assert.equal(
    incidentAttribution({ classification: "controlled-handoff" }),
    "controlled supervisor handoff recorded inside the workspace",
  );
});
