import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { hashGeneratedOutput } from "./check-api-codegen-drift.mjs";

test("hashes the generated API Zod index", () => {
  const root = mkdtempSync(path.join(tmpdir(), "api-codegen-drift-"));
  try {
    for (const relativePath of [
      "lib/api-client-react/src/generated/api.ts",
      "lib/api-zod/src/generated/api.ts",
      "lib/api-zod/src/index.ts",
    ]) {
      const filePath = path.join(root, relativePath);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, "original\n");
    }

    const before = hashGeneratedOutput(root);
    writeFileSync(path.join(root, "lib/api-zod/src/index.ts"), "changed\n");
    assert.notEqual(hashGeneratedOutput(root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
