import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./account.ts", import.meta.url), "utf8");

function functionSource(name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const nextType = source.indexOf("\ntype AccountPositionOptionQuoteDemandRow", start);
  assert.notEqual(nextType, -1, `Missing end marker for ${name}`);
  return source.slice(start, nextType);
}

test("account position option quote refresh merges bounded snapshot results", () => {
  const body = functionSource("fetchOptionQuoteSnapshotsForPositions");

  assert.match(body, /const snapshotResults = await Promise\.allSettled\(/);
  assert.match(body, /fetchBridgeOptionQuoteSnapshots/);
  assert.match(body, /hydrateCached:\s*true/);
  assert.match(body, /timeoutMs:\s*ACCOUNT_POSITION_OPTION_QUOTE_REFRESH_TIMEOUT_MS/);
  assert.match(body, /optionQuoteDemandStateFromSnapshot/);
  assert.match(body, /readIbkrLiveDemandState/);
  assert.match(body, /bestOptionQuoteDemandState/);
  assert.doesNotMatch(body, /void Promise\.allSettled\(/);
  assert.doesNotMatch(body, /await Promise\.race/);
  assert.doesNotMatch(body, /ACCOUNT_OPTION_QUOTE_SNAPSHOT_TASK_MAX_WAIT_MS/);
});
