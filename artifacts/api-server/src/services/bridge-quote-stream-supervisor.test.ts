import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __resolveCurrentBridgeQuoteStreamDataAtForTests,
  __resolveCurrentBridgeQuoteStreamSignalAtForTests,
} from "./bridge-quote-stream";

const source = readFileSync(
  new URL("./bridge-quote-stream.ts", import.meta.url),
  "utf8",
);

function functionSource(name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  const next = [nextFunction, nextExport]
    .filter((index) => index > start)
    .sort((left, right) => left - right)[0];
  return source.slice(start, next ?? source.length);
}

test("quote stream stall watchdog uses quote data freshness, not SSE signal freshness", () => {
  const body = functionSource("startStallTimer");

  assert.match(
    body,
    /resolveCurrentStreamDataAt\(\s*lastEventAt,\s*streamStartedAt,?\s*\)/,
  );
  assert.doesNotMatch(
    body,
    /resolveCurrentStreamSignalAt\(\s*lastSignalAt,\s*streamStartedAt\s*\)/,
  );
});

test("data freshness clock is independent from transport signal freshness", () => {
  const streamStartedAt = new Date("2026-06-08T17:00:00.000Z");
  const latestHeartbeatAt = new Date("2026-06-08T17:01:00.000Z");

  assert.equal(
    __resolveCurrentBridgeQuoteStreamDataAtForTests(null, streamStartedAt),
    streamStartedAt,
  );
  assert.equal(
    __resolveCurrentBridgeQuoteStreamSignalAtForTests(
      latestHeartbeatAt,
      streamStartedAt,
    ),
    latestHeartbeatAt,
  );
});
