import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("default Signal Options deployment seed and retries use the background DB lane", () => {
  const start = indexSource.indexOf(
    "function ensureDefaultSignalOptionsPaperDeploymentWithRetry",
  );
  const end = indexSource.indexOf("\nserver.listen(", start);

  assert.notEqual(start, -1, "Missing default deployment retry function");
  assert.notEqual(end, -1, "Missing default deployment retry boundary");
  assert.match(
    indexSource.slice(start, end),
    /runInDbLane\(\s*"background",\s*\(\) =>\s*ensureDefaultSignalOptionsPaperDeployment\(/,
  );
});

test("runtime incident import uses the background DB lane", () => {
  assert.match(
    indexSource,
    /runInDbLane\(\s*"background",\s*\(\) =>\s*importRuntimeFlightRecorderIncidents\(/,
  );
});
