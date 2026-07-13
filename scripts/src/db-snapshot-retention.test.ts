import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  resolveSnapshotRetentionConfig,
  type RetentionResult,
} from "@workspace/db";
import { __dbSnapshotRetentionInternalsForTests as retentionCli } from "./db-snapshot-retention";

test("importing the retention CLI does not run database maintenance", () => {
  const moduleUrl = pathToFileURL(
    resolve(import.meta.dirname, "db-snapshot-retention.ts"),
  ).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)})`,
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://retention-test:unused@127.0.0.1:1/retention-test?connect_timeout=1",
        LOCAL_DATABASE_URL: "",
        PGDATABASE: "",
        PGHOST: "",
        PGPASSWORD: "",
        PGPORT: "",
        PGUSER: "",
        PYRUS_DATABASE_SOURCE: "database_url",
      },
      timeout: 10_000,
    },
  );

  assert.equal(
    imported.status,
    0,
    `import unexpectedly ran the CLI:\n${imported.stdout}${imported.stderr}`,
  );
});

test("retention CLI arguments are strict and execute is retention-only", () => {
  assert.deepEqual(retentionCli.parseRetentionArgs([]), {
    command: "audit",
    execute: false,
  });
  assert.deepEqual(retentionCli.parseRetentionArgs(["audit"]), {
    command: "audit",
    execute: false,
  });
  assert.deepEqual(retentionCli.parseRetentionArgs(["retention"]), {
    command: "retention",
    execute: false,
  });
  assert.deepEqual(
    retentionCli.parseRetentionArgs(["--", "retention", "--execute"]),
    { command: "retention", execute: true },
  );

  for (const args of [
    ["unknown"],
    ["audit", "--execute"],
    ["retention", "--unknown"],
    ["retention", "--execute", "--execute"],
    ["audit", "retention"],
  ]) {
    assert.throws(
      () => retentionCli.parseRetentionArgs(args),
      /Usage: pnpm (?:run )?db:snapshot-retention/,
    );
  }
});

const result = (
  table: string,
  overrides: Partial<RetentionResult> = {},
): RetentionResult => ({
  table,
  cutoff: "2026-01-01T00:00:00.000Z",
  candidates: 0,
  deleted: 0,
  hitCap: false,
  durationMs: 1,
  dryRun: false,
  ...overrides,
});

test("retention CLI delegates exactly once to the shared retention owner", async () => {
  const config = resolveSnapshotRetentionConfig({});
  const sharedResults = [
    "signal_monitor_breadth_snapshots",
    "balance_snapshots",
    "shadow_balance_snapshots",
    "shadow_position_marks",
    "signal_monitor_events",
    "signal_monitor_symbol_states",
    "bar_cache",
    "execution_events",
  ].map((table) => result(table));
  const calls: unknown[] = [];

  const actual = await retentionCli.runRetention(
    { command: "retention", execute: true },
    config,
    async (options) => {
      calls.push(options);
      return sharedResults;
    },
  );

  assert.deepEqual(calls, [{ config, dryRun: false }]);
  assert.equal(actual, sharedResults);
});

test("retention completion fails closed on sweep errors and execute caps", () => {
  assert.deepEqual(
    retentionCli
      .incompleteResults(
        [result("failed", { error: "statement timeout" }), result("ok")],
        false,
      )
      .map((entry) => entry.table),
    ["failed"],
  );
  assert.deepEqual(
    retentionCli
      .incompleteResults(
        [result("capped", { hitCap: true }), result("ok")],
        true,
      )
      .map((entry) => entry.table),
    ["capped"],
  );
  assert.equal(
    retentionCli.incompleteResults(
      [result("preview", { dryRun: true, hitCap: true })],
      false,
    ).length,
    0,
  );
});

test("retention diagnostics are terminal-safe and redact URL credentials", () => {
  const diagnostic = retentionCli.safeDiagnostic(
    new Error(
      `postgres://operator:super-secret@db.internal/retention \u001b[31m\n\u202e${"x".repeat(800)}`,
    ),
  );

  assert.match(diagnostic, /postgres:\/\/\[redacted\]@db\.internal\/retention/);
  assert.doesNotMatch(diagnostic, /super-secret|\u001b|\n|\u202e/u);
  assert.ok(diagnostic.length <= retentionCli.MAX_DIAGNOSTIC_LENGTH);
  assert.equal(
    retentionCli.safeDiagnostic("\u001b[31m\u001b[0m"),
    "Unknown database error",
  );
});
