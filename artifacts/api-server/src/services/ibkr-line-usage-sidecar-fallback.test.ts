import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ibkr-line-usage.ts", import.meta.url),
  "utf8",
);

function functionSource(name: string): string {
  const start = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const offset = start >= 0 ? start : asyncStart;
  assert.notEqual(offset, -1, `Missing ${name}`);
  const nextFunction = source.indexOf("\nfunction ", offset + 1);
  const nextAsyncFunction = source.indexOf("\nasync function ", offset + 1);
  const nextExport = source.indexOf("\nexport ", offset + 1);
  const next = [nextFunction, nextAsyncFunction, nextExport]
    .filter((index) => index > offset)
    .sort((left, right) => left - right)[0];
  return source.slice(offset, next ?? source.length);
}

test("async sidecar generation apply uses a short fallback deadline", () => {
  assert.match(
    source,
    /DEFAULT_ASYNC_SIDECAR_GENERATION_APPLY_TIMEOUT_MS\s*=\s*2_500/,
  );

  const body = functionSource("applyAsyncSidecarMarketDataGeneration");
  assert.match(body, /const timeoutMs = asyncSidecarGenerationApplyTimeoutMs\(\)/);
  assert.match(body, /resolveMarketDataGenerationApplyWithin\([\s\S]*timeoutMs,[\s\S]*"ib-async-sidecar"/);
  assert.doesNotMatch(
    body,
    /resolveMarketDataGenerationApplyWithin\([\s\S]*marketDataGenerationApplyTimeoutMs\(\),[\s\S]*"ib-async-sidecar"/,
  );
});

test("async sidecar generation apply does not fall back to bridge generation", () => {
  const body = functionSource("applyMarketDataGeneration");

  assert.match(
    body,
    /input\.routeToAsyncSidecar\s*\?\s*await applyAsyncSidecarMarketDataGeneration\(input\)\s*:\s*await applyBridgeMarketDataGeneration\(input\)/,
  );
  assert.doesNotMatch(
    body,
    /input\.routeToAsyncSidecar\s*&&\s*result\.error/,
  );
  assert.doesNotMatch(
    body,
    /Async sidecar apply failed:[\s\S]*bridge fallback failed/,
  );
});
