import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IBApiTickType as TickType,
  type MarketDataTicks,
} from "@stoqey/ib";
import { toQuoteSnapshot } from "./tws-provider";

const source = readFileSync(new URL("./tws-provider.ts", import.meta.url), "utf8");

function methodSource(name: string): string {
  const offset = source.indexOf(`  async ${name}(`);
  assert.notEqual(offset, -1, `Missing ${name}`);
  const nextMethod = source.indexOf("\n  async ", offset + 1);
  return source.slice(offset, nextMethod >= 0 ? nextMethod : source.length);
}

test("quote stream subscription does not wait on snapshot bootstrap", () => {
  const body = methodSource("subscribeQuoteStream");
  assert.match(body, /await this\.ensureQuoteSubscriptionsForSymbols\(normalizedSymbols\);/);
  assert.doesNotMatch(body, /await this\.getQuoteSnapshots\(normalizedSymbols\)/);
  assert.doesNotMatch(body, /const bootstrapQuotes = await this\.getQuoteSnapshots/);
});

test("market-data generation applies known equity conids without contract-detail lookup", () => {
  const body = methodSource("applyMarketDataGeneration");
  assert.match(body, /desiredSymbolProviderContractIds/);
  assert.match(body, /resolveStockContractForDesiredLine\(\{/);
  assert.doesNotMatch(body, /await this\.resolveStockContract\(symbol\)/);
});

test("option quote timestamp follows fresh bid ask ticks over stale last tick", () => {
  const staleLastAt = Date.parse("2026-06-08T18:37:49.937Z");
  const freshBidAt = Date.parse("2026-06-08T19:25:41.313Z");
  const freshAskAt = Date.parse("2026-06-08T19:25:42.313Z");
  const ticks = new Map<number, { value: number; ingressTm: number }>([
    [TickType.LAST, { value: 0.66, ingressTm: staleLastAt }],
    [TickType.BID, { value: 0.62, ingressTm: freshBidAt }],
    [TickType.ASK, { value: 0.63, ingressTm: freshAskAt }],
  ]) as unknown as MarketDataTicks;

  const quote = toQuoteSnapshot(
    "F20260626C15",
    "twsopt:f-20260626-c15",
    ticks,
    1,
  );

  assert.equal(quote.bid, 0.62);
  assert.equal(quote.ask, 0.63);
  assert.equal(quote.updatedAt.toISOString(), "2026-06-08T19:25:42.313Z");
  assert.equal(quote.dataUpdatedAt?.toISOString(), "2026-06-08T19:25:42.313Z");
});
