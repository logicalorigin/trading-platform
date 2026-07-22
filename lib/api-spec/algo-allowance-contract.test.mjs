import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const openapiUrl = new URL("./openapi.yaml", import.meta.url);

function schemaBlock(source, name, nextName) {
  const start = source.indexOf(`    ${name}:\n`);
  const end = source.indexOf(`    ${nextName}:\n`, start + 1);
  assert.notEqual(start, -1, `${name} schema must exist`);
  assert.notEqual(end, -1, `${nextName} schema boundary must exist`);
  return source.slice(start, end);
}

test("Algo target contract exposes one allowance model and a separate activation gate", async () => {
  const source = await readFile(openapiUrl, "utf8");
  const target = schemaBlock(
    source,
    "AlgoDeploymentTarget",
    "AlgoDeploymentTargetChange",
  );
  const change = schemaBlock(
    source,
    "AlgoDeploymentTargetChange",
    "ApplyAlgoDeploymentTargetsRequest",
  );

  assert.match(source, /    AlgoAllowanceSetting:\n/);
  assert.match(source, /    AlgoAccountDailyLossLimit:\n/);
  assert.match(target, /allowance:\n\s+\$ref: "#\/components\/schemas\/AlgoAllowanceSetting"/);
  assert.match(target, /totalAlgoAllowance:\n\s+anyOf:/);
  assert.match(target, /accountDailyLossLimit:\n\s+anyOf:/);
  assert.match(target, /executionEnabled:\n\s+type: boolean/);
  assert.match(target, /allocationPercent:[\s\S]*deprecated: true/);
  assert.match(target, /hardCeilingPercent:[\s\S]*deprecated: true/);

  assert.match(change, /allowance:\n\s+\$ref: "#\/components\/schemas\/AlgoAllowanceSetting"/);
  assert.match(change, /totalAlgoAllowance:\n\s+\$ref: "#\/components\/schemas\/AlgoAllowanceSetting"/);
  assert.match(
    change,
    /accountDailyLossLimit:\n\s+anyOf:[\s\S]*AlgoAccountDailyLossLimitInput[\s\S]*type: "null"/,
  );
  assert.doesNotMatch(change, /allocationPercent:/);
  assert.doesNotMatch(change, /hardCeilingPercent:/);
  assert.doesNotMatch(change, /executionEnabled:/);
});

test("Apply result reports elastic-pool warnings and shared account impacts", async () => {
  const source = await readFile(openapiUrl, "utf8");
  const result = schemaBlock(
    source,
    "AlgoDeploymentTargetApplyResult",
    "AlgoDeploymentTargetsResponse",
  );

  assert.match(result, /allowance_maxima_exceed_account_total/);
  assert.match(result, /allowanceUnit:/);
  assert.match(result, /targetAllowanceTotal:/);
  assert.match(result, /totalAlgoAllowance:/);
  assert.match(result, /sharedAccountImpacts:/);
  assert.match(result, /deploymentIds:/);
});

test("account choices separate stageable configuration from activation readiness", async () => {
  const source = await readFile(openapiUrl, "utf8");
  const choice = schemaBlock(
    source,
    "AlgoDeploymentAccountChoice",
    "AlgoDeploymentAccountsResponse",
  );

  assert.match(choice, /configurable:\n\s+type: boolean/);
  assert.match(choice, /activationReady:\n\s+type: boolean/);
  assert.match(choice, /adapterImplemented:\n\s+type: boolean/);
  assert.match(choice, /technicalReady:\n\s+type: boolean/);
  assert.match(choice, /activationReleased:\n\s+type: boolean/);
  assert.match(choice, /activationBlockers:/);
  assert.match(choice, /totalAlgoAllowance:\n\s+anyOf:/);
  assert.match(choice, /accountDailyLossLimit:\n\s+anyOf:/);
  assert.match(choice, /linkedDeploymentIds:/);
  assert.match(choice, /available:[\s\S]*deprecated: true/);
});

test("account daily-loss contract fixes scope and timezone while keeping the USD amount user-configurable", async () => {
  const source = await readFile(openapiUrl, "utf8");
  const limit = schemaBlock(
    source,
    "AlgoAccountDailyLossLimit",
    "AlgoDeploymentTarget",
  );

  assert.match(limit, /unit:[\s\S]*enum: \[usd\]/);
  assert.match(limit, /value:[\s\S]*exclusiveMinimum: 0/);
  assert.match(limit, /scope:[\s\S]*enum: \[account_options_realized\]/);
  assert.match(limit, /timezone:[\s\S]*enum: \[America\/New_York\]/);
  assert.match(limit, /required:[\s\S]*- unit[\s\S]*- value[\s\S]*- scope[\s\S]*- timezone/);
});
