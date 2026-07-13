import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("Python compute runner enforces the checked-in uv lock", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "pyrus-python-runner-"));
  const capturePath = path.join(directory, "args");
  const uvPath = path.join(directory, "uv");
  writeFileSync(
    uvPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$PYRUS_TEST_CAPTURE"\n',
  );
  chmodSync(uvPath, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-python-compute.mjs", "doctor"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ""}`,
          PYRUS_TEST_CAPTURE: capturePath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(capturePath, "utf8").trim().split("\n"), [
      "run",
      "--locked",
      "--no-env-file",
      "python",
      "-m",
      "pyrus_compute.doctor",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
