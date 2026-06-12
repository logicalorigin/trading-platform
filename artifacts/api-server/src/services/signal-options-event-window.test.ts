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
    /like\(\s*executionEventsTable\.eventType,\s*`\$\{SIGNAL_OPTIONS_EVENT_PREFIX\}%`\s*\)[\s\S]*\.limit\(/,
  );
});
