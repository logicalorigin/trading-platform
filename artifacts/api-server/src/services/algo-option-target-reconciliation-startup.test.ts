import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the API starts target reconciliation with its background workers", () => {
  const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /import \{ startAlgoOptionTargetReconciliationWorker \} from "\.\/services\/algo-option-target-reconciliation-worker";/,
  );
  const workersStart = source.indexOf("const backgroundWorkers:");
  const workersEnd = source.indexOf("backgroundWorkers.forEach", workersStart);
  assert.match(
    source.slice(workersStart, workersEnd),
    /startAlgoOptionTargetReconciliationWorker/,
  );
});
