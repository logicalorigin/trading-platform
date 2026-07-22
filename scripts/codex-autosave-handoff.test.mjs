import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parsePayload,
  runAutosave,
} from "./codex-autosave-handoff.mjs";

const sessionId = "01901234-5678-7abc-8def-0123456789ab";

test("runs the shared handoff writer for the active Codex session", () => {
  const calls = [];
  const result = runAutosave(
    {
      cwd: "/tmp/repo",
      hook_event_name: "Stop",
      session_id: sessionId,
    },
    {
      runWriter(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stderr: "", stdout: "updated" };
      },
      writerPath: "/repo/write-session-handoff.mjs",
    },
  );

  assert.equal(result.saved, true);
  assert.deepEqual(calls, [
    {
      command: process.execPath,
      args: [
        "/repo/write-session-handoff.mjs",
        "--session",
        sessionId,
      ],
      options: {
        cwd: "/tmp/repo",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    },
  ]);
});

test("ignores malformed hook payloads without invoking the writer", () => {
  let invoked = false;
  const result = runAutosave(
    { cwd: "/tmp/repo", session_id: "not-a-session" },
    {
      runWriter() {
        invoked = true;
      },
    },
  );

  assert.equal(result.saved, false);
  assert.equal(invoked, false);
  assert.deepEqual(parsePayload("not json"), {});
});

test("reports writer failure without throwing or blocking Codex", () => {
  const result = runAutosave(
    { cwd: "/tmp/repo", session_id: sessionId },
    {
      runWriter() {
        return { status: 1, stderr: "state unavailable", stdout: "" };
      },
    },
  );

  assert.equal(result.saved, false);
  assert.match(result.error, /state unavailable/);

  execFileSync(process.execPath, [
    new URL("./codex-autosave-handoff.mjs", import.meta.url).pathname,
  ], {
    input: "not json",
    stdio: ["pipe", "pipe", "pipe"],
  });
});

test("wires autosave to Codex session, compaction, and turn boundaries", () => {
  const hooks = JSON.parse(
    readFileSync(new URL("../.codex/hooks.json", import.meta.url), "utf8"),
  ).hooks;

  assert.deepEqual(Object.keys(hooks).sort(), [
    "PreCompact",
    "SessionStart",
    "Stop",
  ]);

  for (const event of Object.values(hooks)) {
    assert.equal(event.length, 1);
    assert.match(
      event[0].hooks[0].command,
      /codex-autosave-handoff\.mjs/,
    );
    assert.equal(event[0].hooks[0].timeout, 30);
  }
});

test("runs each persistence security test in its own fail-closed process", () => {
  const rootPackage = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    rootPackage.scripts?.["audit:session-persistence-security"],
    "node --test scripts/lib/redact-persisted-text.test.mjs && node --test scripts/diagnose-agent-restarts.test.mjs && node --test .agents/skills/session-handoff/scripts/write-session-handoff.test.mjs && node --test scripts/codex-autosave-handoff.test.mjs",
  );
});
