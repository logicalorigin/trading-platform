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
const replitScribeArtifactsSource = readFileSync(
  new URL("./src/replit-scribe-artifacts.ts", import.meta.url),
  "utf8",
);
const agentsDoc = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
const replitDoc = readFileSync(
  new URL("../replit.md", import.meta.url),
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

test("agent rules forbid Replit artifact and env control-plane churn during routine work", () => {
  assert.match(agentsDoc, /set\/delete Replit environment variables/);
  assert.match(agentsDoc, /create\/update\/remove Replit artifacts/);
  assert.match(agentsDoc, /control-plane actions/);
  assert.match(agentsDoc, /explicit startup maintenance window/);

  assert.match(replitDoc, /set\/delete Replit env vars/);
  assert.match(replitDoc, /create\/update\/remove Replit artifacts/);
  assert.match(replitDoc, /env\/toolchain/);
  assert.match(replitDoc, /same-container supervisor/);
  assert.doesNotMatch(
    replitDoc,
    /use `setEnvVars` \/ `deleteEnvVars` instead when possible because those persist without a reload/,
  );
});

test("Scribe artifact cleanup requires explicit control-plane maintenance opt-in", () => {
  assert.match(
    replitScribeArtifactsSource,
    /PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP/,
  );
  assert.match(
    replitScribeArtifactsSource,
    /--confirm-control-plane-cleanup/,
  );
  assert.match(
    replitScribeArtifactsSource,
    /may trigger Replit artifact\/env reconciliation/,
  );
});
