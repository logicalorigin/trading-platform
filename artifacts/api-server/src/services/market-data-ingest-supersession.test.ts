import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./market-data-ingest.ts", import.meta.url),
  "utf8",
);

function sourceBlock(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("forward refresh supersession never cancels running jobs", () => {
  const block = sourceBlock(
    "async function cancelSupersededForwardRefreshJobs",
    "export function isMarketDataIngestDatabaseConfigured",
  );

  assert.match(block, /status in \('queued', 'failed'\)/);
  assert.doesNotMatch(block, /status in \([^)]*'running'/);
});
