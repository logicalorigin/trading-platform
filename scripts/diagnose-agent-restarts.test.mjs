import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function writeJsonl(filePath, rows) {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

test("agent restart diagnosis correlates and redacts risky Codex activity", () => {
  const root = mkdtempSync(join(tmpdir(), "pyrus-agent-restart-test-"));
  const flightDir = join(root, "flight");
  const codexDir = join(root, "codex");
  const workflowDir = join(root, "workflow-logs", "abc");
  const sessionDir = join(codexDir, "sessions", "2026", "06", "03");
  mkdirSync(flightDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(workflowDir, { recursive: true });

  try {
    writeJsonl(join(flightDir, "incidents.jsonl"), [
      {
        schemaVersion: 1,
        observedAt: "2026-06-03T12:53:36.745Z",
        message: "Previous Replit/PYRUS run classified as container replaced.",
        classification: "container-replaced",
        confidence: "medium",
        severity: "warning",
        previousUpdatedAt: "2026-06-03T12:53:27.778Z",
        evidence: ["previous-boot:btime:1", "current-boot:btime:2"],
        lastEvent: {
          time: "2026-06-03T12:53:27.777Z",
          event: "heartbeat",
          pid: 1910,
        },
      },
    ]);

    writeJsonl(join(sessionDir, "rollout-2026-06-03T06-50-test.jsonl"), [
      {
        timestamp: "2026-06-03T12:52:30.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd:
              "pnpm --filter @workspace/pyrus exec node --input-type=module -e 'import { chromium } from \"@playwright/test\"; await chromium.launch();' token=abc123",
          }),
        },
      },
      {
        timestamp: "2026-06-03T12:52:40.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "sed -n '1,5p' AGENTS.md",
            sandbox_permissions: "require_escalated",
          }),
        },
      },
      {
        timestamp: "2026-06-03T12:52:50.000Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_1",
          output: "Process running with session ID 18990\nDATABASE_URL=postgresql://user:pass@host/db",
        },
      },
    ]);

    writeFileSync(
      join(workflowDir, "artifacts_pyrus__web.shell.exec.0"),
      [
        "> @workspace/pyrus@0.0.0 dev:replit",
        "request aborted",
        "Connection terminated unexpectedly",
      ].join("\n"),
    );

    const result = spawnSync(
      process.execPath,
      [
        "scripts/diagnose-agent-restarts.mjs",
        "--json",
        "--dir",
        flightDir,
        "--codex-dir",
        codexDir,
        "--workflow-log-dir",
        join(root, "workflow-logs"),
        "--since",
        "2026-06-03T12:00:00Z",
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "observe-only");
    assert.equal(report.incidentCount, 1);
    const activityText = JSON.stringify(report.incidents[0].nearbyActivity);
    assert.match(activityText, /browser-risk/);
    assert.match(activityText, /policy-risk/);
    assert.match(activityText, /resource-risk/);
    assert.doesNotMatch(activityText, /abc123/);
    assert.doesNotMatch(activityText, /user:pass@host/);
    assert.match(
      report.incidents[0].attribution.summary,
      /host trigger unavailable inside guest/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("agent restart diagnosis handles missing Codex records", () => {
  const root = mkdtempSync(join(tmpdir(), "pyrus-agent-restart-empty-test-"));
  const flightDir = join(root, "flight");
  mkdirSync(flightDir, { recursive: true });

  try {
    writeJsonl(join(flightDir, "incidents.jsonl"), [
      {
        observedAt: "2026-06-03T13:09:47.200Z",
        message: "Previous Replit/PYRUS run classified as same container supervisor abrupt.",
        classification: "same-container-supervisor-abrupt",
        confidence: "medium",
      },
    ]);

    const result = spawnSync(
      process.execPath,
      [
        "scripts/diagnose-agent-restarts.mjs",
        "--dir",
        flightDir,
        "--codex-dir",
        join(root, "missing-codex"),
        "--workflow-log-dir",
        join(root, "missing-workflows"),
        "--since",
        "2026-06-03T13:00:00Z",
      ],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /nearby agent activity: none found/);
    assert.match(result.stdout, /host trigger: unavailable inside guest/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
