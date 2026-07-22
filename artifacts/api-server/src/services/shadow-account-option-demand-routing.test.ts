import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { __resetMarketDataAdmissionForTests } from "./market-data-admission";
import {
  __resetMassiveOptionQuoteStreamForTests,
  __setMassiveOptionQuoteClientForTests,
  __setMassiveOptionQuoteStreamNowForTests,
} from "./massive-option-quote-stream";
import { __resetOptionQuoteDemandCoordinatorForTests } from "./option-quote-demand-coordinator";
import { __shadowWatchlistBacktestInternalsForTests as internals } from "./shadow-account";

afterEach(() => {
  __resetOptionQuoteDemandCoordinatorForTests();
  __resetMassiveOptionQuoteStreamForTests();
  __resetMarketDataAdmissionForTests();
});

test("shadow option quote demand keeps each underlying and owner distinct", () => {
  const scopes = internals.buildShadowOptionQuoteDemandScopesForTests(
    new Map([
      ["AAP", new Set(["O:AAP260724C00051000"])],
      ["BRK.B", new Set(["O:BRKB260724P00490000"])],
    ]),
    "shadow-position:ledger:day-change",
  );

  assert.deepEqual(scopes, [
    {
      underlying: "AAP",
      providerContractIds: ["O:AAP260724C00051000"],
      owner: "shadow-position:ledger:day-change:AAP",
    },
    {
      underlying: "BRK.B",
      providerContractIds: ["O:BRKB260724P00490000"],
      owner: "shadow-position:ledger:day-change:BRK.B",
    },
  ]);
});

test("shadow mark hydration snapshots every underlying even before a websocket tick", async () => {
  const requested: Array<{
    underlying: string | null;
    providerContractIds: string[];
  }> = [];
  const receivedAt = new Date("2026-07-21T17:08:43.035Z");
  __setMassiveOptionQuoteStreamNowForTests(receivedAt);
  __setMassiveOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "massive_rest",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input) {
      requested.push({
        underlying: input.underlying ?? null,
        providerContractIds: [...input.providerContractIds],
      });
      return input.providerContractIds.map((providerContractId) => ({
        symbol: input.underlying ?? "",
        providerContractId,
        bid: 2.5,
        ask: 3,
        mark: 2.75,
        price: 2.75,
        prevClose: 2.5,
        change: 0.25,
        changePercent: 10,
        delayed: false,
        freshness: "live",
        marketDataMode: "live",
        transport: "massive_rest",
        updatedAt: receivedAt,
        dataUpdatedAt: receivedAt,
        latency: { apiServerReceivedAt: receivedAt },
      })) as never;
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const positions = [
    {
      symbol: "AAP",
      optionContract: {
        underlying: "AAP",
        ticker: "O:AAP260724C00051000",
        providerContractId: "O:AAP260724C00051000",
        expirationDate: "2026-07-24T00:00:00.000Z",
        strike: 51,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
      },
    },
    {
      symbol: "BRK.B",
      optionContract: {
        underlying: "BRK.B",
        ticker: "O:BRKB260724P00490000",
        providerContractId: "O:BRKB260724P00490000",
        expirationDate: "2026-07-24T00:00:00.000Z",
        strike: 490,
        right: "put",
        multiplier: 100,
        sharesPerContract: 100,
      },
    },
  ];
  const quotes = await internals.fetchShadowOptionDayChangeQuotesForTests(
    positions,
    { taskMaxWaitMs: 1_000 },
  );

  const scopedRequests = () =>
    requested.filter((request) => request.underlying !== null);
  const uniqueScopedRequests = () =>
    Array.from(
      new Map(
        scopedRequests().map((request) => [JSON.stringify(request), request]),
      ).values(),
    );
  assert.deepEqual(uniqueScopedRequests(), [
    {
      underlying: "AAP",
      providerContractIds: ["O:AAP260724C00051000"],
    },
    {
      underlying: "BRK.B",
      providerContractIds: ["O:BRKB260724P00490000"],
    },
  ]);
  assert.equal(quotes.get("O:AAP260724C00051000")?.mark, 2.75);
  assert.equal(quotes.get("O:BRKB260724P00490000")?.mark, 2.75);

  const requestCountBeforeCachedRefresh = scopedRequests().length;
  await internals.fetchShadowOptionDayChangeQuotesForTests(positions, {
    taskMaxWaitMs: 1_000,
  });
  assert.equal(
    scopedRequests().length,
    requestCountBeforeCachedRefresh,
    "cached contracts must not add a REST poll on every mark refresh",
  );
});
