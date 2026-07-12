import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveQuoteStreamSource } from "./bridge-streams";

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
  assert.match(body, /await getQuoteSnapshots\(\{\s*symbols:\s*symbols\.join\(","\)\s*\}\)/);
  assert.match(body, /quote\.source === "massive"/);
  assert.doesNotMatch(body, /getCurrentMassiveStockQuoteSnapshots\(symbols\)/);
  assert.doesNotMatch(source, /bridge-quote-stream/);
});

test("account and order snapshots do not reserve market-data capacity", () => {
  assert.doesNotMatch(source, /accountMonitorSnapshots/);
  assert.doesNotMatch(source, /admitMarketDataLeases/);
  assert.doesNotMatch(source, /releaseMarketDataLeases/);

  const accountSnapshot = functionSource("fetchAccountSnapshotPayload");
  assert.match(accountSnapshot, /await listIbkrAccounts/);
  assert.match(accountSnapshot, /await listIbkrPositions/);

  const orderSnapshot = functionSource("fetchOrderSnapshotPayload");
  assert.match(orderSnapshot, /await listIbkrOrders/);
});
