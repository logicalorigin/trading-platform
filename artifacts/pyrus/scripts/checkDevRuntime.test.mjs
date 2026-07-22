import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("JSON diagnostics never expose the database connection string", () => {
  const binDir = mkdtempSync(path.join(tmpdir(), "pyrus-runtime-check-"));
  const pgIsReady = path.join(binDir, "pg_isready");
  writeFileSync(pgIsReady, "#!/bin/sh\nexit 0\n");
  chmodSync(pgIsReady, 0o755);

  try {
    const secret = "do-not-print-this-password";
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./checkDevRuntime.mjs", import.meta.url)), "--json"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://pyrus:${secret}@db.example.test:5432/pyrus`,
          PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
          PYRUS_API_PORT: "65534",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(secret));
    assert.equal(JSON.parse(result.stdout).databaseReachability.raw, undefined);
  } finally {
    rmSync(binDir, { recursive: true, force: true });
  }
});
