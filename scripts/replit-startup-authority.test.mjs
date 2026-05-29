import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const runDevAppSource = readFileSync(
  new URL("../artifacts/pyrus/scripts/runDevApp.mjs", import.meta.url),
  "utf8",
);
const reapDevPortSource = readFileSync(
  new URL("./reap-dev-port.mjs", import.meta.url),
  "utf8",
);

test("dev:replit tag is not supervisor restart authority", () => {
  assert.match(
    runDevAppSource,
    /const runningInsideReplitWorkflow = process\.env\.REPLIT_MODE === "workflow";/,
  );
  assert.doesNotMatch(
    runDevAppSource,
    /const runningInsideReplitWorkflow =[\s\S]{0,160}PYRUS_REPLIT_RUN/,
  );
  assert.match(runDevAppSource, /PYRUS_REPLIT_RUN is a tag/);
  assert.match(runDevAppSource, /not authority to/);
});

test("dev:replit tag is not port-reaper authority", () => {
  assert.match(
    reapDevPortSource,
    /const runningInsideReplitWorkflow = process\.env\.REPLIT_MODE === "workflow";/,
  );
  assert.doesNotMatch(
    reapDevPortSource,
    /const runningInsideReplitWorkflow =[\s\S]{0,160}PYRUS_REPLIT_RUN/,
  );
  assert.match(reapDevPortSource, /PYRUS_REPLIT_RUN is set by the package script/);
  assert.match(reapDevPortSource, /Only Replit's workflow env can replace/);
});
