import assert from "node:assert/strict";
import test from "node:test";
import {
  createOptionsFlowRadarScanner,
  scoreOptionsFlowRadarQuote,
} from "./options-flow-radar-scanner";

test("radar scoring only treats explicit option ticks as option activity", () => {
  const scannedAt = new Date("2026-05-01T14:30:00.000Z");
  const equityOnly = scoreOptionsFlowRadarQuote(
    {
      symbol: "SPY",
      price: 500,
      volume: 10_000_000,
      openInterest: null,
    },
    scannedAt,
  );
  assert.equal(equityOnly.hasOptionActivityTicks, false);
  assert.equal(equityOnly.optionVolume, null);
  assert.equal(equityOnly.score, 0);

  const optionActivity = scoreOptionsFlowRadarQuote(
    {
      symbol: "SPY",
      price: 500,
      optionCallVolume: 1_200,
      optionPutVolume: 800,
      optionCallOpenInterest: 12_000,
      optionPutOpenInterest: 8_000,
      impliedVolatility: 0.18,
    },
    scannedAt,
  );
  assert.equal(optionActivity.hasOptionActivityTicks, true);
  assert.equal(optionActivity.optionVolume, 2_000);
  assert.equal(optionActivity.optionOpenInterest, 20_000);
  assert.ok(optionActivity.score > 0);
});

test("radar scanner covers 500 symbols inside a five-minute cycle with 30-line batches", async () => {
  let currentMs = Date.parse("2026-05-01T14:30:00.000Z");
  const symbols = Array.from({ length: 500 }, (_unused, index) => `T${index + 1}`);
  const promotedBatches: string[][] = [];
  const scanner = createOptionsFlowRadarScanner({
    now: () => currentMs,
    fetchBatch: async (batch) => ({
      quotes: batch.map((symbol, index) => ({
        symbol,
        price: 100 + index,
        optionCallVolume: index === 0 ? 1_000 : 0,
        optionPutVolume: 0,
        optionCallOpenInterest: 10_000,
        optionPutOpenInterest: 0,
      })),
    }),
    onPromotions: async (promoted) => {
      promotedBatches.push([...promoted]);
    },
  });

  for (let index = 0; index < 17; index += 1) {
    await scanner.runOnce(symbols, {
      batchSize: 30,
      promoteCount: 3,
      fallbackPromoteCount: 1,
    });
    currentMs += 15_000;
  }

  const coverage = scanner.getCoverage();
  assert.equal(coverage.scannedSymbols, 500);
  assert.equal(coverage.estimatedCycleMs, 255_000);
  assert.ok((coverage.estimatedCycleMs ?? Number.POSITIVE_INFINITY) <= 300_000);
  assert.equal(promotedBatches.length, 17);
  assert.ok(promotedBatches.every((batch) => batch.length >= 1));
});
