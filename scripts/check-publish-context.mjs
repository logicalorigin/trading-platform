#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditPublishContext } from "./publish-context-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = auditPublishContext({
  root: repoRoot,
  ignoreText: readFileSync(path.join(repoRoot, ".replitignore"), "utf8"),
});

for (const failure of result.failures) {
  console.error(`[check-publish-context] ${failure}`);
}
if (result.failures.length > 0) {
  process.exitCode = 1;
} else {
  console.log(
    `[check-publish-context] ${result.archiveEstimateBytes} bytes across ${result.includedFiles} files`,
  );
}
