import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./useLiveMarketFlow.js", import.meta.url),
  "utf8",
);

test("client Flow scans abort in-flight requests when their effect is cleaned up", () => {
  assert.match(
    source,
    /const scanAbortController = new AbortController\(\);/,
  );
  assert.match(
    source,
    /flowVisibleRequestOptions\(\{\s*signal: scanAbortController\.signal,\s*\}\)/,
  );
  assert.match(
    source,
    /return \(\) => \{\s*cancelled = true;\s*scanAbortController\.abort\(\);/,
  );
});
