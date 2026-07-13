import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

test("every scripts-package tsx entry points to an existing source file", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const missing = Object.entries(manifest.scripts)
    .map(([name, command]) => {
      const target = /^tsx\s+(\S+)/u.exec(command)?.[1];
      return target && !existsSync(path.resolve(packageRoot, target))
        ? `${name}: ${target}`
        : null;
    })
    .filter(Boolean);

  assert.deepEqual(missing, []);
});
