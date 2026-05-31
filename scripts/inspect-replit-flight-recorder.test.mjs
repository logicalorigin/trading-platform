import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("inspect script highlights uncaught Postgres disconnect evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "pyrus-flight-recorder-test-"));
  try {
    writeFileSync(
      join(dir, "incidents.jsonl"),
      `${JSON.stringify({
        schemaVersion: 1,
        observedAt: "2026-05-31T16:33:48.405Z",
        message: "Previous Replit/PYRUS run classified as container replaced.",
        classification: "container-replaced",
        confidence: "medium",
        severity: "warning",
        evidence: [
          "previous-boot:btime:1780220834",
          "current-boot:btime:1780242802",
        ],
      })}\n`,
    );
    writeFileSync(
      join(dir, "api-events-2026-05-31.jsonl"),
      [
        {
          schemaVersion: 1,
          time: "2026-05-31T16:33:38.159Z",
          event: "uncaught-exception",
          pid: 182,
          name: "Error",
          message: "Connection terminated unexpectedly",
          stack:
            "Error: Connection terminated unexpectedly\n    at Connection2.<anonymous> (/workspace/node_modules/pg/lib/client.js:180:73)",
        },
        {
          schemaVersion: 1,
          time: "2026-05-31T16:33:38.160Z",
          event: "api-process-exit",
          pid: 182,
          code: 1,
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );
    mkdirSync(join(dir, "empty"), { recursive: true });

    const result = spawnSync(
      process.execPath,
      ["scripts/inspect-replit-flight-recorder.mjs", "--dir", dir],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Latest Incident/);
    assert.match(result.stdout, /classification: container-replaced/);
    assert.match(result.stdout, /Recent Postgres Disconnects/);
    assert.match(result.stdout, /Connection terminated unexpectedly/);
    assert.match(result.stdout, /api-process-exit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
