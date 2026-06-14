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
  const offsets = [
    source.indexOf(`  async ${name}(`),
    source.indexOf(`  private async ${name}(`),
    source.indexOf(`  private ${name}(`),
    source.indexOf(`  ${name}(`),
  ].filter((value) => value >= 0);
  const offset = offsets.length ? Math.min(...offsets) : -1;
  assert.notEqual(offset, -1, `Missing ${name}`);
  const rest = source.slice(offset + 1);
  const nextMethod = rest.search(
    /\n  (?:private\s+)?(?:async\s+)?[A-Za-z0-9_]+\(/,
  );
  return source.slice(
    offset,
    nextMethod >= 0 ? offset + 1 + nextMethod : source.length,
  );
}

function functionSource(name: string): string {
  const offset = source.indexOf(`function ${name}(`);
  assert.notEqual(offset, -1, `Missing ${name}`);
  const nextFunction = source.indexOf("\nfunction ", offset + 1);
  const nextExportedFunction = source.indexOf("\nexport function ", offset + 1);
  const nextOffsets = [nextFunction, nextExportedFunction].filter(
    (value) => value >= 0,
  );
  const end = nextOffsets.length ? Math.min(...nextOffsets) : source.length;
  return source.slice(offset, end);
}

test("quote stream subscription does not wait on snapshot bootstrap", () => {
  const body = methodSource("subscribeQuoteStream");
  assert.match(body, /await this\.ensureQuoteSubscriptionsForSymbols\(normalizedSymbols\);/);
  assert.doesNotMatch(body, /await this\.getQuoteSnapshots\(normalizedSymbols\)/);
  assert.doesNotMatch(body, /const bootstrapQuotes = await this\.getQuoteSnapshots/);
});

test("historical ticker-id misses are request scoped", () => {
  const body = functionSource("isHistoricalDataRequestUnavailableError");
  assert.match(body, /no historical data query found for ticker id/);
});

test("trim desired set includes applied market-data generation", () => {
  const symbolsBody = methodSource("getDesiredQuoteSymbols");
  assert.match(symbolsBody, /appliedMarketDataGeneration\?\.desiredLines/);
  assert.match(symbolsBody, /line\.assetClass !== "equity"/);

  const optionsBody = methodSource("getDesiredQuoteProviderContractIds");
  assert.match(optionsBody, /appliedMarketDataGeneration\?\.desiredLines/);
  assert.match(optionsBody, /line\.assetClass !== "option"/);
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
