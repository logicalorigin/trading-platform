#!/usr/bin/env node
// Fail-open Codex lifecycle adapter for the shared session-handoff writer.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const writerPath = fileURLToPath(
  new URL(
    "../.agents/skills/session-handoff/scripts/write-session-handoff.mjs",
    import.meta.url,
  ),
);

export function parsePayload(raw) {
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    return {};
  }
}

export function runAutosave(
  payload,
  { runWriter = spawnSync, writerPath: targetWriter = writerPath } = {},
) {
  const sessionId = payload?.session_id;
  if (typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return { saved: false };
  }

  try {
    const result = runWriter(
      process.execPath,
      [targetWriter, "--session", sessionId],
      {
        cwd:
          typeof payload.cwd === "string" && payload.cwd
            ? payload.cwd
            : process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status === 0) {
      return { saved: true };
    }
    return {
      saved: false,
      error:
        result.stderr?.trim() ||
        result.error?.message ||
        `writer exited ${result.status ?? "without a status"}`,
    };
  } catch (error) {
    return { saved: false, error: error?.message || String(error) };
  }
}

if (import.meta.main) {
  try {
    const result = runAutosave(parsePayload(readFileSync(0, "utf8")));
    if (result.error) {
      process.stderr.write(`codex-autosave-handoff: ${result.error}\n`);
    }
  } catch {
    // Autosave must never block or interrupt the Codex lifecycle.
  }
  process.exit(0);
}
