import assert from "node:assert/strict";
import test from "node:test";

import { readRobinhoodAccountPositions } from "./robinhood-account-positions";

type ToolRequest = {
  appUserId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ToolFetcher = (request: ToolRequest) => Promise<unknown>;

const toolResult = (data: Record<string, unknown>) => ({
  data,
  guide: "test fixture",
});

function equityPosition(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "AAPL",
    quantity: "2",
    intraday_quantity: "0",
    average_buy_price: "100",
    shares_available_for_sells: "2",
    shares_held_for_sells: "0",
    shares_held_for_stock_grants: "0",
    shares_held_for_options_events: "0",
    shares_held_for_asset_transfer: "0",
    shares_pending_from_options_events: "0",
    type: "long",
    ...overrides,
  };
}

function equityQuote(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "AAPL",
    last_trade_price: "110",
    venue_last_trade_time: "2026-07-15T20:00:00.000Z",
    last_non_reg_trade_price: null,
    venue_last_non_reg_trade_time: null,
    adjusted_previous_close: "108",
    previous_close: "108",
    previous_close_date: "2026-07-14",
    bid_price: "109.99",
    venue_bid_time: "2026-07-15T20:00:00.000Z",
    ask_price: "110.01",
    venue_ask_time: "2026-07-15T20:00:00.000Z",
    has_traded: true,
    state: "active",
    ...overrides,
  };
}

function optionPosition(overrides: Record<string, unknown> = {}) {
  return {
    option_id: "option-call-200",
    chain_id: "chain-aapl",
    chain_symbol: "AAPL",
    type: "long",
    quantity: "2",
    average_price: "250",
    expiration_date: "2026-08-21",
    trade_value_multiplier: "100",
    intraday_average_open_price: "0",
    intraday_quantity: "0",
    pending_buy_quantity: "0",
    pending_sell_quantity: "0",
    pending_exercise_quantity: "0",
    pending_assignment_quantity: "0",
    pending_expiration_quantity: "0",
    opened_at: "2026-07-10T14:30:00.000Z",
    ...overrides,
  };
}

function optionInstrument(overrides: Record<string, unknown> = {}) {
  return {
    id: "option-call-200",
    chain_id: "chain-aapl",
    chain_symbol: "AAPL",
    underlying_type: "equity",
    expiration_date: "2026-08-21",
    sellout_datetime: "2026-08-21T19:30:00.000Z",
    strike_price: "200",
    type: "call",
    state: "active",
    tradability: "tradable",
    min_ticks: {
      above_tick: "0.05",
      below_tick: "0.01",
      cutoff_price: "3.00",
    },
    ...overrides,
  };
}

function optionQuote(overrides: Record<string, unknown> = {}) {
  return {
    instrument_id: "option-call-200",
    ask_price: "3.10",
    ask_size: 8,
    bid_price: "2.90",
    bid_size: 7,
    break_even_price: "202.50",
    adjusted_mark_price: "3.00",
    mark_price: "3.00",
    high_fill_rate_buy_price: "3.08",
    low_fill_rate_buy_price: "3.02",
    high_fill_rate_sell_price: "2.98",
    low_fill_rate_sell_price: "2.92",
    previous_close_price: "2.80",
    previous_close_date: "2026-07-14",
    implied_volatility: "0.42",
    delta: "0.55",
    gamma: "0.04",
    rho: "0.03",
    theta: "-0.08",
    vega: "0.12",
    open_interest: 450,
    volume: 90,
    chance_of_profit_long: "0.45",
    chance_of_profit_short: "0.55",
    updated_at: "2026-07-15T20:00:00.000Z",
    ...overrides,
  };
}

function optionClose(overrides: Record<string, unknown> = {}) {
  return {
    instrument_id: "option-call-200",
    symbol: "AAPL",
    date: "2026-07-14",
    price: "2.75",
    interpolated: false,
    source: "sip-close",
    ...overrides,
  };
}

function emptyPositionFetcher(
  overrides: Partial<Record<string, (request: ToolRequest) => unknown>> = {},
): ToolFetcher {
  return async (request) => {
    const override = overrides[request.name];
    if (override) return override(request);
    if (request.name === "get_equity_positions") {
      return toolResult({ positions: [] });
    }
    if (request.name === "get_option_positions") {
      return toolResult({ positions: [] });
    }
    throw new Error(`Unexpected Robinhood tool: ${request.name}`);
  };
}

async function expectPositionsUnavailable(run: () => Promise<unknown>) {
  await assert.rejects(run, (error: unknown) => {
    const unavailable = error as { statusCode?: number; code?: string };
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.code, "robinhood_account_positions_unavailable");
    return true;
  });
}

test("Robinhood equities use the newest regular or non-regular trade for signed position math", async () => {
  const requests: ToolRequest[] = [];
  const callTool: ToolFetcher = async (request) => {
    requests.push(request);
    if (request.name === "get_equity_positions") {
      return toolResult({
        positions: [
          equityPosition({
            symbol: "AAPL",
            quantity: "2.5",
            average_buy_price: "100",
            shares_available_for_sells: "2.5",
          }),
          equityPosition({
            symbol: "TSLA",
            quantity: "-4",
            average_buy_price: "50",
            shares_available_for_sells: "0",
            type: "short",
          }),
        ],
      });
    }
    if (request.name === "get_option_positions") {
      return toolResult({ positions: [] });
    }
    if (request.name === "get_equity_quotes") {
      return toolResult({
        results: [
          {
            quote: equityQuote({
              symbol: "AAPL",
              last_trade_price: "110",
              venue_last_trade_time: "2026-07-15T20:00:00.000Z",
              last_non_reg_trade_price: "112",
              venue_last_non_reg_trade_time: "2026-07-15T22:00:00.000Z",
            }),
          },
          {
            quote: equityQuote({
              symbol: "TSLA",
              last_trade_price: "40",
              venue_last_trade_time: "2026-07-15T20:00:00.000Z",
              last_non_reg_trade_price: "39",
              venue_last_non_reg_trade_time: "2026-07-15T19:00:00.000Z",
            }),
          },
        ],
      });
    }
    throw new Error(`Unexpected Robinhood tool: ${request.name}`);
  };

  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "user-equity",
      accounts: [{ accountId: "local-equity", accountNumber: "RH-EQUITY" }],
    },
    { callTool },
  );

  const aapl = positions.find((position) => position.symbol === "AAPL");
  assert.ok(aapl);
  assert.equal(aapl.accountId, "local-equity");
  assert.equal(aapl.quantity, 2.5);
  assert.equal(aapl.averagePrice, 100);
  assert.equal(aapl.marketPrice, 112);
  assert.equal(aapl.marketValue, 280);
  assert.equal(aapl.unrealizedPnl, 30);
  assert.equal(aapl.unrealizedPnlPercent, 12);
  assert.equal(
    aapl.quote?.updatedAt?.toISOString(),
    "2026-07-15T22:00:00.000Z",
  );

  const tsla = positions.find((position) => position.symbol === "TSLA");
  assert.ok(tsla);
  assert.equal(tsla.quantity, -4);
  assert.equal(tsla.averagePrice, 50);
  assert.equal(tsla.marketPrice, 40);
  assert.equal(tsla.marketValue, -160);
  assert.equal(tsla.unrealizedPnl, 40);
  assert.equal(tsla.unrealizedPnlPercent, 20);
  assert.equal(
    tsla.quote?.updatedAt?.toISOString(),
    "2026-07-15T20:00:00.000Z",
  );

  assert.deepEqual(
    requests
      .filter((request) => request.name === "get_equity_positions")
      .map((request) => ({
        appUserId: request.appUserId,
        arguments: request.arguments,
      })),
    [
      {
        appUserId: "user-equity",
        arguments: { account_number: "RH-EQUITY" },
      },
    ],
  );
});

test("Robinhood option joins normalize signed per-contract costs for long and short positions", async () => {
  const callTool: ToolFetcher = async (request) => {
    if (request.name === "get_equity_positions") {
      return toolResult({ positions: [] });
    }
    if (request.name === "get_option_positions") {
      assert.deepEqual(request.arguments, {
        account_number: "RH-OPTIONS",
        nonzero: true,
      });
      return toolResult({
        positions: [
          optionPosition(),
          optionPosition({
            option_id: "option-put-150",
            chain_id: "chain-msft",
            chain_symbol: "MSFT",
            type: "short",
            quantity: "3",
            average_price: "-180",
            expiration_date: "2026-09-18",
            opened_at: "2026-07-11T15:00:00.000Z",
          }),
        ],
      });
    }
    if (request.name === "get_option_instruments") {
      assert.equal(request.arguments["ids"], "option-call-200,option-put-150");
      return toolResult({
        instruments: [
          optionInstrument({
            id: "option-put-150",
            chain_id: "chain-msft",
            chain_symbol: "MSFT",
            expiration_date: "2026-09-18",
            sellout_datetime: "2026-09-18T19:30:00.000Z",
            strike_price: "150",
            type: "put",
          }),
          optionInstrument(),
        ],
      });
    }
    if (request.name === "get_option_quotes") {
      assert.deepEqual(request.arguments, {
        instrument_ids: ["option-call-200", "option-put-150"],
      });
      return toolResult({
        results: [
          {
            quote: optionQuote({
              instrument_id: "option-put-150",
              adjusted_mark_price: "1.20",
              mark_price: "1.20",
            }),
          },
          { quote: optionQuote(), close: optionClose() },
        ],
      });
    }
    throw new Error(`Unexpected Robinhood tool: ${request.name}`);
  };

  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "user-options",
      accounts: [{ accountId: "local-options", accountNumber: "RH-OPTIONS" }],
    },
    { callTool },
  );

  const longCall = positions.find(
    (position) =>
      position.optionContract?.providerContractId === "option-call-200",
  );
  assert.ok(longCall);
  assert.equal(longCall.accountId, "local-options");
  assert.equal(longCall.symbol, "AAPL");
  assert.equal(longCall.quantity, 2);
  assert.equal(longCall.averagePrice, 2.5);
  assert.equal(longCall.marketPrice, 3);
  assert.equal(longCall.marketValue, 600);
  assert.equal(longCall.unrealizedPnl, 100);
  assert.equal(longCall.unrealizedPnlPercent, 20);
  assert.equal(longCall.providerSecurityType, "robinhood_option");
  assert.equal(longCall.optionContract?.underlying, "AAPL");
  assert.equal(longCall.optionContract?.ticker, "option-call-200");
  assert.equal(longCall.optionContract?.strike, 200);
  assert.equal(longCall.optionContract?.right, "call");
  assert.equal(longCall.optionContract?.multiplier, 100);
  assert.equal(
    longCall.optionContract?.expirationDate.toISOString(),
    "2026-08-21T00:00:00.000Z",
  );
  assert.equal(longCall.quote?.providerContractId, "option-call-200");
  assert.equal(longCall.quote?.dayChange, 0.25);

  const shortPut = positions.find(
    (position) =>
      position.optionContract?.providerContractId === "option-put-150",
  );
  assert.ok(shortPut);
  assert.equal(shortPut.symbol, "MSFT");
  assert.equal(shortPut.quantity, -3);
  assert.equal(shortPut.averagePrice, 1.8);
  assert.equal(shortPut.marketPrice, 1.2);
  assert.equal(shortPut.marketValue, -360);
  assert.equal(shortPut.unrealizedPnl, 180);
  assert.equal(shortPut.unrealizedPnlPercent, (180 / 540) * 100);
  assert.equal(shortPut.optionContract?.strike, 150);
  assert.equal(shortPut.optionContract?.right, "put");
});

test("Robinhood position pagination forwards each provider cursor for equities and options", async () => {
  const positionRequests: ToolRequest[] = [];
  const callTool: ToolFetcher = async (request) => {
    if (request.name === "get_equity_positions") {
      positionRequests.push(request);
      if (request.arguments["cursor"] === "equity-page-2") {
        return toolResult({
          positions: [
            equityPosition({
              symbol: "NVDA",
              quantity: "1",
              average_buy_price: "120",
              shares_available_for_sells: "1",
            }),
          ],
        });
      }
      return toolResult({
        positions: [equityPosition()],
        next: "https://agent.robinhood.com/positions?cursor=equity-page-2",
      });
    }
    if (request.name === "get_option_positions") {
      positionRequests.push(request);
      if (request.arguments["cursor"] === "option-page-2") {
        return toolResult({ positions: [optionPosition()] });
      }
      return toolResult({
        positions: [],
        next: "https://agent.robinhood.com/options/positions?cursor=option-page-2",
      });
    }
    if (request.name === "get_equity_quotes") {
      const symbols = request.arguments["symbols"] as string[];
      return toolResult({
        results: symbols.map((symbol) => ({
          quote: equityQuote({ symbol }),
        })),
      });
    }
    if (request.name === "get_option_instruments") {
      return toolResult({ instruments: [optionInstrument()] });
    }
    if (request.name === "get_option_quotes") {
      return toolResult({ results: [{ quote: optionQuote() }] });
    }
    throw new Error(`Unexpected Robinhood tool: ${request.name}`);
  };

  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "user-pages",
      accounts: [{ accountId: "local-pages", accountNumber: "RH-PAGES" }],
    },
    { callTool },
  );

  assert.deepEqual(positions.map((position) => position.symbol).sort(), [
    "AAPL",
    "AAPL",
    "NVDA",
  ]);
  assert.deepEqual(
    positionRequests
      .filter((request) => request.name === "get_equity_positions")
      .map((request) => request.arguments),
    [
      { account_number: "RH-PAGES" },
      {
        account_number: "RH-PAGES",
        cursor: "equity-page-2",
      },
    ],
  );
  assert.deepEqual(
    positionRequests
      .filter((request) => request.name === "get_option_positions")
      .map((request) => request.arguments),
    [
      { account_number: "RH-PAGES", nonzero: true },
      {
        account_number: "RH-PAGES",
        nonzero: true,
        cursor: "option-page-2",
      },
    ],
  );
});

test("Robinhood position reads reject a repeated pagination cursor", async () => {
  let equityPages = 0;
  const callTool = emptyPositionFetcher({
    get_equity_positions: () => {
      equityPages += 1;
      return toolResult({
        positions: [equityPosition()],
        next: "https://agent.robinhood.com/positions?cursor=repeat-me",
      });
    },
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-loop",
        accounts: [{ accountId: "local-loop", accountNumber: "RH-LOOP" }],
      },
      { callTool },
    ),
  );
  assert.equal(equityPages, 2);
});

test("Robinhood position reads reject a malformed next-page URL", async () => {
  const callTool = emptyPositionFetcher({
    get_option_positions: () =>
      toolResult({ positions: [], next: "not-a-provider-url" }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-bad-cursor",
        accounts: [
          { accountId: "local-bad-cursor", accountNumber: "RH-BAD-CURSOR" },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood equity positions fail closed when average cost is missing", async () => {
  const callTool = emptyPositionFetcher({
    get_equity_positions: () =>
      toolResult({
        positions: [equityPosition({ average_buy_price: null })],
      }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-no-equity-cost",
        accounts: [
          { accountId: "local-no-equity-cost", accountNumber: "RH-NO-COST" },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood option positions fail closed when average cost is invalid", async () => {
  const callTool = emptyPositionFetcher({
    get_option_positions: () =>
      toolResult({
        positions: [optionPosition({ average_price: "not-money" })],
      }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-bad-option-cost",
        accounts: [
          {
            accountId: "local-bad-option-cost",
            accountNumber: "RH-BAD-OPTION-COST",
          },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood equity positions fail closed when a held symbol has no quote", async () => {
  const callTool = emptyPositionFetcher({
    get_equity_positions: () => toolResult({ positions: [equityPosition()] }),
    get_equity_quotes: () => toolResult({ results: [] }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-no-equity-quote",
        accounts: [
          {
            accountId: "local-no-equity-quote",
            accountNumber: "RH-NO-EQUITY-QUOTE",
          },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood option positions fail closed when an instrument join is missing", async () => {
  const callTool = emptyPositionFetcher({
    get_option_positions: () => toolResult({ positions: [optionPosition()] }),
    get_option_instruments: () => toolResult({ instruments: [] }),
    get_option_quotes: () =>
      toolResult({ results: [{ quote: optionQuote() }] }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-no-instrument",
        accounts: [
          {
            accountId: "local-no-instrument",
            accountNumber: "RH-NO-INSTRUMENT",
          },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood option positions fail closed when an option quote join is missing", async () => {
  const callTool = emptyPositionFetcher({
    get_option_positions: () => toolResult({ positions: [optionPosition()] }),
    get_option_instruments: () =>
      toolResult({ instruments: [optionInstrument()] }),
    get_option_quotes: () => toolResult({ results: [] }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-no-option-quote",
        accounts: [
          {
            accountId: "local-no-option-quote",
            accountNumber: "RH-NO-OPTION-QUOTE",
          },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood preserves local account identity for the same symbol in two accounts", async () => {
  const requests: ToolRequest[] = [];
  const callTool: ToolFetcher = async (request) => {
    requests.push(request);
    if (request.name === "get_equity_positions") {
      const accountNumber = String(request.arguments["account_number"]);
      return toolResult({
        positions: [
          equityPosition({
            quantity: accountNumber === "RH-ONE" ? "1" : "3",
            shares_available_for_sells: accountNumber === "RH-ONE" ? "1" : "3",
          }),
        ],
      });
    }
    if (request.name === "get_option_positions") {
      return toolResult({ positions: [] });
    }
    if (request.name === "get_equity_quotes") {
      return toolResult({ results: [{ quote: equityQuote() }] });
    }
    throw new Error(`Unexpected Robinhood tool: ${request.name}`);
  };

  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "owner-user",
      accounts: [
        { accountId: "local-one", accountNumber: "RH-ONE" },
        { accountId: "local-two", accountNumber: "RH-TWO" },
      ],
    },
    { callTool },
  );

  assert.deepEqual(
    positions
      .map((position) => ({
        accountId: position.accountId,
        quantity: position.quantity,
      }))
      .sort((left, right) => left.accountId.localeCompare(right.accountId)),
    [
      { accountId: "local-one", quantity: 1 },
      { accountId: "local-two", quantity: 3 },
    ],
  );
  assert.equal(new Set(positions.map((position) => position.id)).size, 2);
  assert.deepEqual(
    requests
      .filter((request) =>
        ["get_equity_positions", "get_option_positions"].includes(request.name),
      )
      .map((request) => request.appUserId),
    ["owner-user", "owner-user", "owner-user", "owner-user"],
  );
  assert.deepEqual(
    new Set(
      requests
        .filter((request) =>
          ["get_equity_positions", "get_option_positions"].includes(
            request.name,
          ),
        )
        .map((request) => request.arguments["account_number"]),
    ),
    new Set(["RH-ONE", "RH-TWO"]),
  );
});

for (const invalidCase of [
  {
    name: "whitespace equity cost",
    fetcher: emptyPositionFetcher({
      get_equity_positions: () =>
        toolResult({
          positions: [equityPosition({ average_buy_price: "   " })],
        }),
    }),
  },
  {
    name: "boolean equity quantity",
    fetcher: emptyPositionFetcher({
      get_equity_positions: () =>
        toolResult({ positions: [equityPosition({ quantity: true })] }),
    }),
  },
  {
    name: "whitespace option mark",
    fetcher: emptyPositionFetcher({
      get_option_positions: () => toolResult({ positions: [optionPosition()] }),
      get_option_instruments: () =>
        toolResult({ instruments: [optionInstrument()] }),
      get_option_quotes: () =>
        toolResult({
          results: [{ quote: optionQuote({ mark_price: "   " }) }],
        }),
    }),
  },
]) {
  test(`Robinhood rejects schema-invalid numeric input: ${invalidCase.name}`, async () => {
    await expectPositionsUnavailable(() =>
      readRobinhoodAccountPositions(
        {
          appUserId: "user-invalid-number",
          accounts: [
            {
              accountId: "local-invalid-number",
              accountNumber: "RH-INVALID-NUMBER",
            },
          ],
        },
        { callTool: invalidCase.fetcher },
      ),
    );
  });
}

test("Robinhood boxed equity fails closed because one net row cannot preserve both legs", async () => {
  const callTool = emptyPositionFetcher({
    get_equity_positions: () =>
      toolResult({ positions: [equityPosition({ type: "boxed" })] }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-boxed",
        accounts: [{ accountId: "local-boxed", accountNumber: "RH-BOXED" }],
      },
      { callTool },
    ),
  );
});

test("Robinhood adjusted options fail closed when valuation and cost-comparison marks differ", async () => {
  const callTool = emptyPositionFetcher({
    get_option_positions: () => toolResult({ positions: [optionPosition()] }),
    get_option_instruments: () =>
      toolResult({ instruments: [optionInstrument()] }),
    get_option_quotes: () =>
      toolResult({
        results: [
          {
            quote: optionQuote({
              mark_price: "3.00",
              adjusted_mark_price: "2.50",
            }),
          },
        ],
      }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-adjusted-option",
        accounts: [
          {
            accountId: "local-adjusted-option",
            accountNumber: "RH-ADJUSTED-OPTION",
          },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood retries a held option instrument in the expired state", async () => {
  const instrumentRequests: Record<string, unknown>[] = [];
  const callTool = emptyPositionFetcher({
    get_option_positions: () => toolResult({ positions: [optionPosition()] }),
    get_option_instruments: (request) => {
      instrumentRequests.push(request.arguments);
      return request.arguments["state"] === "expired"
        ? toolResult({
            instruments: [optionInstrument({ state: "expired" })],
          })
        : toolResult({ instruments: [] });
    },
    get_option_quotes: () =>
      toolResult({ results: [{ quote: optionQuote() }] }),
  });

  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "user-expired-option",
      accounts: [
        {
          accountId: "local-expired-option",
          accountNumber: "RH-EXPIRED-OPTION",
        },
      ],
    },
    { callTool },
  );

  assert.equal(positions.length, 1);
  assert.deepEqual(instrumentRequests, [
    { ids: "option-call-200" },
    { ids: "option-call-200", state: "expired" },
  ]);
});

test("Robinhood rejects a quote result paired with another option's official close", async () => {
  const callTool = emptyPositionFetcher({
    get_option_positions: () => toolResult({ positions: [optionPosition()] }),
    get_option_instruments: () =>
      toolResult({ instruments: [optionInstrument()] }),
    get_option_quotes: () =>
      toolResult({
        results: [
          {
            quote: optionQuote(),
            close: optionClose({ instrument_id: "different-option" }),
          },
        ],
      }),
  });

  await expectPositionsUnavailable(() =>
    readRobinhoodAccountPositions(
      {
        appUserId: "user-mismatched-close",
        accounts: [
          {
            accountId: "local-mismatched-close",
            accountNumber: "RH-MISMATCHED-CLOSE",
          },
        ],
      },
      { callTool },
    ),
  );
});

test("Robinhood interpolated official closes fall back to the quote's prior close", async () => {
  const callTool = emptyPositionFetcher({
    get_option_positions: () => toolResult({ positions: [optionPosition()] }),
    get_option_instruments: () =>
      toolResult({ instruments: [optionInstrument()] }),
    get_option_quotes: () =>
      toolResult({
        results: [
          {
            quote: optionQuote({ previous_close_price: "2.80" }),
            close: optionClose({
              date: "2026-07-11",
              price: "1.00",
              interpolated: true,
            }),
          },
        ],
      }),
  });

  const [position] = await readRobinhoodAccountPositions(
    {
      appUserId: "user-interpolated-close",
      accounts: [
        {
          accountId: "local-interpolated-close",
          accountNumber: "RH-INTERPOLATED-CLOSE",
        },
      ],
    },
    { callTool },
  );

  assert.ok(position);
  assert.ok(Math.abs((position.quote?.dayChange ?? 0) - 0.2) < 1e-9);
});

test("Robinhood preserves explicit zero cost and zero option marks without purchase-cost fallback", async () => {
  const callTool: ToolFetcher = async (request) => {
    if (request.name === "get_equity_positions") {
      return toolResult({
        positions: [equityPosition({ average_buy_price: "0" })],
      });
    }
    if (request.name === "get_option_positions") {
      return toolResult({
        positions: [optionPosition({ average_price: "0" })],
      });
    }
    if (request.name === "get_equity_quotes") {
      return toolResult({ results: [{ quote: equityQuote() }] });
    }
    if (request.name === "get_option_instruments") {
      return toolResult({ instruments: [optionInstrument()] });
    }
    if (request.name === "get_option_quotes") {
      return toolResult({
        results: [
          {
            quote: optionQuote({
              mark_price: "0",
              adjusted_mark_price: "0",
            }),
          },
        ],
      });
    }
    throw new Error(`Unexpected Robinhood tool: ${request.name}`);
  };

  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "user-zero-values",
      accounts: [
        { accountId: "local-zero-values", accountNumber: "RH-ZERO-VALUES" },
      ],
    },
    { callTool },
  );
  const equity = positions.find((position) => !position.optionContract);
  const option = positions.find((position) => position.optionContract);
  assert.ok(equity);
  assert.equal(equity.unrealizedPnl, 220);
  assert.equal(equity.unrealizedPnlPercent, 0);
  assert.ok(option);
  assert.equal(option.marketValue, 0);
  assert.equal(option.unrealizedPnl, 0);
  assert.equal(option.unrealizedPnlPercent, 0);
});

test("Robinhood batches more than twenty equity and option quote joins without losing rows", async () => {
  const equitySymbols = Array.from(
    { length: 21 },
    (_, index) => `EQ${String(index).padStart(2, "0")}`,
  );
  const optionIds = Array.from(
    { length: 21 },
    (_, index) => `option-${String(index).padStart(2, "0")}`,
  );
  const equityQuoteBatches: number[] = [];
  const instrumentBatches: number[] = [];
  const optionQuoteBatches: number[] = [];
  const requests: ToolRequest[] = [];
  const callTool: ToolFetcher = async (request) => {
    requests.push(request);
    if (request.name === "get_equity_positions") {
      return toolResult({
        positions: equitySymbols.map((symbol) => equityPosition({ symbol })),
      });
    }
    if (request.name === "get_option_positions") {
      return toolResult({
        positions: optionIds.map((optionId) =>
          optionPosition({ option_id: optionId }),
        ),
      });
    }
    if (request.name === "get_equity_quotes") {
      const symbols = request.arguments["symbols"] as string[];
      equityQuoteBatches.push(symbols.length);
      return toolResult({
        results: symbols.map((symbol) => ({ quote: equityQuote({ symbol }) })),
      });
    }
    if (request.name === "get_option_instruments") {
      const ids = String(request.arguments["ids"]).split(",");
      instrumentBatches.push(ids.length);
      return toolResult({
        instruments: ids.map((id, index) =>
          optionInstrument({ id, strike_price: String(200 + index) }),
        ),
      });
    }
    if (request.name === "get_option_quotes") {
      const ids = request.arguments["instrument_ids"] as string[];
      optionQuoteBatches.push(ids.length);
      return toolResult({
        results: ids.map((instrumentId) => ({
          quote: optionQuote({ instrument_id: instrumentId }),
        })),
      });
    }
    throw new Error(`Unexpected Robinhood tool: ${request.name}`);
  };

  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "user-batches",
      accounts: [{ accountId: "local-batches", accountNumber: "RH-BATCHES" }],
    },
    { callTool },
  );

  assert.equal(positions.length, 42);
  assert.deepEqual(
    equityQuoteBatches.sort((a, b) => b - a),
    [20, 1],
  );
  assert.deepEqual(
    instrumentBatches.sort((a, b) => b - a),
    [20, 1],
  );
  assert.deepEqual(
    optionQuoteBatches.sort((a, b) => b - a),
    [20, 1],
  );
  assert.ok(requests.every((request) => request.appUserId === "user-batches"));
});

test("Robinhood reports fixed phase timings without account or symbol dimensions", async () => {
  const stages: Array<{ stage: string; durationMs: number }> = [];
  const positions = await readRobinhoodAccountPositions(
    {
      appUserId: "user-timing",
      accounts: [{ accountId: "local-timing", accountNumber: "RH-TIMING" }],
    },
    {
      callTool: emptyPositionFetcher(),
      onStageTiming: (stage, durationMs) => {
        stages.push({ stage, durationMs });
      },
    },
  );

  assert.deepEqual(positions, []);
  assert.deepEqual(
    stages.map(({ stage }) => stage),
    ["holdings", "market_data"],
  );
  assert.ok(
    stages.every(
      ({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0,
    ),
  );
  assert.equal(JSON.stringify(stages).includes("RH-TIMING"), false);
});

test("Robinhood reuses a recent initialized position session", async () => {
  let sessionCreations = 0;
  const createToolFetcher = async (): Promise<ToolFetcher> => {
    sessionCreations += 1;
    return emptyPositionFetcher();
  };
  const input = {
    appUserId: "user-session-reuse",
    accounts: [
      { accountId: "local-session-reuse", accountNumber: "RH-SESSION-REUSE" },
    ],
  };

  await readRobinhoodAccountPositions(input, { createToolFetcher });
  await readRobinhoodAccountPositions(input, { createToolFetcher });

  assert.equal(sessionCreations, 1);
});

test("Robinhood evicts a reused position session after a tool failure", async () => {
  let sessionCreations = 0;
  const createToolFetcher = async (): Promise<ToolFetcher> => {
    sessionCreations += 1;
    if (sessionCreations === 1) {
      return async () => {
        throw new Error("session failed");
      };
    }
    return emptyPositionFetcher();
  };
  const input = {
    appUserId: "user-session-recovery",
    accounts: [
      {
        accountId: "local-session-recovery",
        accountNumber: "RH-SESSION-RECOVERY",
      },
    ],
  };

  await assert.rejects(
    readRobinhoodAccountPositions(input, { createToolFetcher }),
    /session failed/,
  );
  assert.deepEqual(
    await readRobinhoodAccountPositions(input, { createToolFetcher }),
    [],
  );
  assert.equal(sessionCreations, 2);
});
