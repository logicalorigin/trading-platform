import assert from "node:assert/strict";
import test from "node:test";

import { __setDbForTests, currentDbLane } from "@workspace/db";

import {
  __signalUniverseRankingInternalsForTests,
  refreshSignalUniverseRanking,
} from "./signal-universe-ranking";
import type { StockGroupedDailyAggregate } from "../providers/massive/market-data";

const {
  classifySignalUniverseExclusion,
  computeSignalUniverseRanking,
  SIGNAL_UNIVERSE_ENTRANT_RANK,
  SIGNAL_UNIVERSE_RETAIN_RANK,
} = __signalUniverseRankingInternalsForTests;

test("signal-universe ranking refresh executes in the background DB lane", async () => {
  const lanes: string[] = [];
  const rows = {
    then(resolve: (value: Array<{ rankedAt: Date }>) => unknown) {
      lanes.push(currentDbLane());
      return Promise.resolve([
        { rankedAt: new Date("2099-01-01T00:00:00.000Z") },
      ]).then(resolve);
    },
  };
  const fakeDb = {
    select() {
      return {
        from() {
          return rows;
        },
      };
    },
  };
  const restoreDb = __setDbForTests(fakeDb as never);

  try {
    const result = await refreshSignalUniverseRanking({
      now: new Date("2026-07-17T20:00:00.000Z"),
    });
    assert.deepEqual(result, { status: "skipped", reason: "already_current" });
    assert.deepEqual(lanes, ["background"]);
  } finally {
    restoreDb();
  }
});

function listing(
  overrides: Partial<{
    symbol: string;
    name: string | null;
    type: string | null;
    market: string | null;
    primaryExchange: string | null;
  }> = {},
) {
  return {
    symbol: "AAPL",
    name: "Apple Inc.",
    type: "CS",
    market: "stocks",
    primaryExchange: "XNAS",
    ...overrides,
  };
}

function bar(
  symbol: string,
  overrides: Partial<StockGroupedDailyAggregate> = {},
): StockGroupedDailyAggregate {
  return {
    symbol,
    volume: 1_000_000,
    vwap: 100,
    transactions: 10_000,
    open: 99,
    high: 105,
    low: 95,
    close: 100,
    timestamp: null,
    otc: false,
    ...overrides,
  };
}

test("exclusions: bond funds out, SPACs out, preferred/warrant types out, leveraged ETFs kept", () => {
  // Plain optionable equities and ETFs stay in.
  assert.equal(classifySignalUniverseExclusion(listing()), null);
  assert.equal(
    classifySignalUniverseExclusion(
      listing({ symbol: "TSLA", name: "Tesla, Inc." }),
    ),
    null,
  );
  // Leveraged/inverse ETFs are deliberately KEPT (volatile + optionable).
  for (const symbol of ["TQQQ", "SQQQ", "UVXY"]) {
    assert.equal(
      classifySignalUniverseExclusion(
        listing({ symbol, name: `${symbol} Leveraged ETF`, type: "ETF" }),
      ),
      null,
      symbol,
    );
  }
  // Liquid bond ETFs are typed ETF and must fall to the denylist.
  for (const symbol of ["TLT", "HYG", "LQD", "AGG"]) {
    assert.equal(
      classifySignalUniverseExclusion(
        listing({ symbol, name: `${symbol} Fund`, type: "ETF" }),
      ),
      "bond_etf_denylist",
      symbol,
    );
  }
  assert.equal(
    classifySignalUniverseExclusion(listing({ type: "BOND" })),
    "fixed_income_type",
  );
  assert.equal(
    classifySignalUniverseExclusion(
      listing({
        symbol: "XMPT",
        name: "VanEck CEF Municipal Income ETF",
        type: "ETF",
      }),
    ),
    "fixed_income_name",
  );
  for (const type of ["PFD", "WARRANT", "RIGHT", "UNIT"]) {
    assert.equal(
      classifySignalUniverseExclusion(listing({ type })),
      "security_type",
      type,
    );
  }
  assert.equal(
    classifySignalUniverseExclusion(
      listing({ symbol: "XYZA", name: "XYZ Acquisition Corp" }),
    ),
    "spac",
  );
  assert.equal(
    classifySignalUniverseExclusion(listing({ primaryExchange: "OTC" })),
    "otc_listing",
  );
  assert.equal(
    classifySignalUniverseExclusion(listing({ market: "otc" })),
    "unsupported_market",
  );
  // Name-regex false-positive guards: REIT "Trust" names and operating
  // companies containing near-miss words must stay in.
  assert.equal(
    classifySignalUniverseExclusion(
      listing({ symbol: "DLR", name: "Digital Realty Trust, Inc." }),
    ),
    null,
  );
  assert.equal(
    classifySignalUniverseExclusion(
      listing({ symbol: "NOTE", name: "FiscalNote Holdings, Inc." }),
    ),
    null,
  );
});

test("scoring: 50/50 dollar-volume + volatility blend with deterministic tie-break", () => {
  const listings = [
    listing({ symbol: "AAA" }),
    listing({ symbol: "BBB" }),
    listing({ symbol: "CCC" }),
  ];
  // AAA: top dollar-volume AND top volatility -> rank 1.
  // BBB: mid dollar-volume, lowest volatility; CCC: lowest dollar-volume, mid
  // volatility -> identical blended score, tie broken by symbol order.
  const session = [
    bar("AAA", { volume: 3_000_000, vwap: 100, high: 120, low: 80, close: 100 }),
    bar("BBB", { volume: 2_000_000, vwap: 100, high: 101, low: 99, close: 100 }),
    bar("CCC", { volume: 1_000_000, vwap: 100, high: 110, low: 90, close: 100 }),
  ];
  const sessions = Array.from({ length: 6 }, () => session);
  const rows = computeSignalUniverseRanking({
    listings,
    sessions,
    previousMembers: new Set(),
  });
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.get("AAA")?.rank, 1);
  assert.equal(bySymbol.get("BBB")?.rank, 2); // tie with CCC -> localeCompare
  assert.equal(bySymbol.get("CCC")?.rank, 3);
  assert.equal(bySymbol.get("AAA")?.score, 1);
  assert.equal(bySymbol.get("BBB")?.score, bySymbol.get("CCC")?.score);
  assert.ok(rows.every((row) => row.member));
  // Mean dollar-volume is persisted for auditability.
  assert.equal(bySymbol.get("AAA")?.dollarVolume, 300_000_000);
});

test("hysteresis: entrants must clear the entrant rank, members retained to the retain rank", () => {
  const total = SIGNAL_UNIVERSE_RETAIN_RANK + 100;
  const symbolAtRank = (rank: number) =>
    `S${String(rank).padStart(4, "0")}`;
  const listings = Array.from({ length: total }, (_, index) =>
    listing({ symbol: symbolAtRank(index + 1), name: `Synthetic ${index}` }),
  );
  // Monotonic metrics so blended rank == index+1 deterministically.
  const session = Array.from({ length: total }, (_, index) =>
    bar(symbolAtRank(index + 1), {
      volume: 10_000_000 - index * 1_000,
      vwap: 100,
      high: 100 + (total - index) / 100,
      low: 100 - (total - index) / 100,
      close: 100,
    }),
  );
  const sessions = Array.from({ length: 6 }, () => session);
  const previousMembers = new Set([
    symbolAtRank(SIGNAL_UNIVERSE_RETAIN_RANK - 100), // stays: above retain rank
    symbolAtRank(SIGNAL_UNIVERSE_RETAIN_RANK + 50), // drops: below retain rank
  ]);
  const rows = computeSignalUniverseRanking({
    listings,
    sessions,
    previousMembers,
  });
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));

  // New symbol comfortably inside the entrant band -> member.
  assert.equal(bySymbol.get(symbolAtRank(100))?.member, true);
  // New symbol between entrant and retain rank -> NOT admitted.
  assert.equal(
    bySymbol.get(symbolAtRank(SIGNAL_UNIVERSE_ENTRANT_RANK + 50))?.member,
    false,
  );
  // Existing member in the retain band -> retained.
  assert.equal(
    bySymbol.get(symbolAtRank(SIGNAL_UNIVERSE_RETAIN_RANK - 100))?.member,
    true,
  );
  // Existing member below the retain band -> dropped.
  assert.equal(
    bySymbol.get(symbolAtRank(SIGNAL_UNIVERSE_RETAIN_RANK + 50))?.member,
    false,
  );
});

test("duplicate listings collapse to one row per symbol, admissible listing wins", () => {
  const listings = [
    // Foreign STK listing sharing a US ticker (LSE Anglo American on AAL) —
    // both duplicates are admissible; exactly one row may survive or the
    // symbol-keyed upsert fails with "cannot affect row a second time".
    listing({
      symbol: "AAL",
      name: "ANGLO AMERICAN PLC",
      type: "STK",
      primaryExchange: "LSE",
    }),
    listing({
      symbol: "AAL",
      name: "American Airlines Group, Inc. - Common Stock",
      type: "CS",
      primaryExchange: "NASDAQ",
    }),
    // Excluded duplicate must not mask the admissible listing, in either order.
    listing({ symbol: "BBB", primaryExchange: "OTC" }),
    listing({ symbol: "BBB", primaryExchange: "NYSE" }),
    listing({ symbol: "CCC", primaryExchange: "NYSE" }),
    listing({ symbol: "CCC", primaryExchange: "OTC" }),
  ];
  const session = [bar("AAL"), bar("BBB"), bar("CCC")];
  const sessions = Array.from({ length: 6 }, () => session);
  const rows = computeSignalUniverseRanking({
    listings,
    sessions,
    previousMembers: new Set(),
  });
  const symbols = rows.map((row) => row.symbol);
  assert.equal(new Set(symbols).size, symbols.length);
  assert.equal(symbols.filter((symbol) => symbol === "AAL").length, 1);
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.get("AAL")?.excludedReason, null);
  assert.equal(bySymbol.get("BBB")?.excludedReason, null);
  assert.equal(bySymbol.get("CCC")?.excludedReason, null);
});

test("insufficient trading history is marked, not silently ranked", () => {
  const listings = [listing({ symbol: "AAA" }), listing({ symbol: "NEWIPO" })];
  const fullSession = [bar("AAA"), bar("NEWIPO")];
  const partialSession = [bar("AAA")];
  // NEWIPO trades in only 2 of 6 sessions (< 5 required).
  const sessions = [
    fullSession,
    fullSession,
    partialSession,
    partialSession,
    partialSession,
    partialSession,
  ];
  const rows = computeSignalUniverseRanking({
    listings,
    sessions,
    previousMembers: new Set(),
  });
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  assert.equal(bySymbol.get("NEWIPO")?.excludedReason, "insufficient_data");
  assert.equal(bySymbol.get("NEWIPO")?.member, false);
  assert.equal(bySymbol.get("AAA")?.rank, 1);
});

test("a symbol missing from the latest completed session is not ranked from stale history", () => {
  const listings = [
    listing({ symbol: "CURRENT" }),
    listing({ symbol: "REMOVED" }),
  ];
  // Sessions are newest-first. REMOVED still has the five observations needed
  // by the trailing-window minimum, but no longer exists at the current edge.
  const sessions = [
    [bar("CURRENT")],
    ...Array.from({ length: 5 }, () => [bar("CURRENT"), bar("REMOVED")]),
  ];

  const rows = computeSignalUniverseRanking({
    listings,
    sessions,
    previousMembers: new Set(["REMOVED"]),
  });
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));

  assert.equal(bySymbol.get("CURRENT")?.rank, 1);
  assert.equal(
    bySymbol.get("REMOVED")?.excludedReason,
    "latest_session_missing",
  );
  assert.equal(bySymbol.get("REMOVED")?.member, false);
  assert.equal(bySymbol.get("REMOVED")?.rank, null);
});
