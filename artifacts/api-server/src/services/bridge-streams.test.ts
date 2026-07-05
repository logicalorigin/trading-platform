import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __bridgeStreamsInternalsForTests,
  resolveQuoteStreamSource,
} from "./bridge-streams";

const source = readFileSync(new URL("./bridge-streams.ts", import.meta.url), "utf8");

function functionSource(name: string): string {
  const start = source.indexOf(`export function ${name}`);
  const asyncStart = source.indexOf(`export async function ${name}`);
  const offset = start >= 0 ? start : asyncStart;
  assert.notEqual(offset, -1, `Missing ${name}`);
  const nextExport = source.indexOf("\nexport ", offset + 1);
  return source.slice(offset, nextExport >= 0 ? nextExport : source.length);
}

test("stock quote streams advertise Massive source", () => {
  assert.equal(resolveQuoteStreamSource(), "massive");
});

test("stock quote stream snapshot bootstrap uses platform snapshots, not websocket cache only", () => {
  const body = functionSource("fetchQuoteSnapshotPayload");
  assert.match(body, /isMassiveStocksRealtimeConfigured\(\)/);
  assert.match(body, /await getQuoteSnapshots\(\{\s*symbols:\s*symbols\.join\(","\)\s*\}\)/);
  assert.match(body, /quotes:\s*payload\.quotes\s+as Array</);
  assert.doesNotMatch(body, /getCurrentMassiveStockQuoteSnapshots\(symbols\)/);
  assert.doesNotMatch(source, /bridge-quote-stream/);
});

test("account monitor stream canonicalizes option position conids to OPRA quote ids", () => {
  const request =
    __bridgeStreamsInternalsForTests.marketDataRequestFromInstrument(
      {
        symbol: "SPY",
        assetClass: "Options",
        optionContract: {
          providerContractId: "890576032",
          underlying: "SPY",
          expirationDate: "2026-06-23T00:00:00.000Z",
          strike: 740,
          right: "call",
          multiplier: 100,
        },
      },
      { massiveStocksRealtime: false },
    );

  assert.equal(request?.assetClass, "option");
  assert.equal(request?.symbol, "SPY");
  assert.equal(request?.underlying, "SPY");
  assert.equal(request?.providerContractId, "O:SPY260623C00740000");
  assert.notEqual(request?.providerContractId, "890576032");
});
