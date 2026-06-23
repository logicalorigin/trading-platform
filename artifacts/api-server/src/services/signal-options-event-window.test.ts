import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./signal-options-automation.ts", import.meta.url),
  "utf8",
);

test("Signal Options state event query filters event type before limiting", () => {
  const listDeploymentEventsSource =
    source.match(
      /async function listDeploymentEvents[\s\S]*?^}/m,
    )?.[0] ?? "";

  assert.match(
    listDeploymentEventsSource,
    /sql`\$\{executionEventsTable\.eventType\} LIKE 'signal_options_%'`[\s\S]*\.limit\(/,
  );
  assert.doesNotMatch(
    listDeploymentEventsSource,
    /like\(\s*executionEventsTable\.eventType,/,
    "the LIKE prefix must stay literal so Postgres can prove the partial index predicate",
  );
});
