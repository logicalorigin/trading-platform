import assert from "node:assert/strict";
import test from "node:test";

import { __shadowLedgerEquityHistoryRepair20260716InternalsForTests as internals } from "./repair-shadow-ledger-equity-history-2026-07-16";

test("equity-history repair is import-safe and defaults to dry-run", () => {
  const previous = process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE;
  delete process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE;
  try {
    assert.equal(internals.mode(), "dry-run");
    assert.equal(
      internals.REPAIR_ID,
      "e8ff6dd7-a338-5838-bc35-6b985844be52",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE;
    } else {
      process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE = previous;
    }
  }
});

test("equity-history repair accepts only explicit dry-run or apply modes", () => {
  const previous = process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE;
  try {
    process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE = "apply";
    assert.equal(internals.mode(), "apply");
    process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE = "yes-really";
    assert.throws(() => internals.mode(), /must be dry-run or apply/);
  } finally {
    if (previous === undefined) {
      delete process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE;
    } else {
      process.env.SHADOW_LEDGER_EQUITY_HISTORY_REPAIR_MODE = previous;
    }
  }
});

test("equity-history manifest pins the corrected close anchors and economics hash", () => {
  const plan = internals.validateManifest();

  assert.equal(
    plan.economicsCanonicalSha256,
    "ef1a4cb832b54cf6e9bdef3655c3c1cc6e7dbe5febafb49ddc060e0c08a3603f",
  );
  assert.equal(
    plan.fullDocumentCanonicalSha256,
    "36c67d1590fc5e0b3c0933505e583c2dbf2a39082e969b113b14aecbdab4ff27",
  );
  assert.deepEqual(
    plan.anchors.map((anchor) => ({
      asOf: anchor.asOf,
      cash: anchor.cash,
      marketValue: anchor.marketValue,
      netLiquidation: anchor.netLiquidation,
      realizedPnl: anchor.realizedPnl,
      unrealizedPnl: anchor.unrealizedPnl,
      fees: anchor.fees,
      positionCount: anchor.positions.length,
    })),
    [
      {
        asOf: "2026-07-13T20:00:00.000Z",
        cash: 162_674.9955,
        marketValue: 1_310.925,
        netLiquidation: 163_985.9205,
        realizedPnl: 137_630.2355,
        unrealizedPnl: 135.275,
        fees: 4_906.56,
        positionCount: 2,
      },
      {
        asOf: "2026-07-14T20:00:00.000Z",
        cash: 147_558.7355,
        marketValue: 12_951.4,
        netLiquidation: 160_510.1355,
        realizedPnl: 135_743.9755,
        unrealizedPnl: -1_380.25,
        fees: 5_008.82,
        positionCount: 13,
      },
      {
        asOf: "2026-07-15T20:00:00.000Z",
        cash: 134_801.3555,
        marketValue: 24_489.175,
        netLiquidation: 159_290.5305,
        realizedPnl: 137_226.2655,
        unrealizedPnl: -3_935.475,
        fees: 5_271.2,
        positionCount: 22,
      },
      {
        asOf: "2026-07-16T20:00:00.000Z",
        cash: 135_249.3455,
        marketValue: 30_690.975,
        netLiquidation: 165_940.3205,
        realizedPnl: 135_991.3455,
        unrealizedPnl: 3_996.325,
        fees: 5_347.21,
        positionCount: 22,
      },
    ],
  );
});

test("equity-history snapshot IDs are deterministic and domain-separated", () => {
  assert.deepEqual(
    [
      "2026-07-13T20:00:00.000Z",
      "2026-07-14T20:00:00.000Z",
      "2026-07-15T20:00:00.000Z",
      "2026-07-16T20:00:00.000Z",
    ].map((asOf) => internals.snapshotId(asOf)),
    [
      "04028dd0-f69f-59e0-986f-698550c4bc68",
      "a78b76cd-2374-5b6a-a3a5-5b4799b61f77",
      "5725b773-2bdb-5c10-91c6-c2dcb03cc655",
      "4ed91c34-b661-5af4-8d46-596a00421820",
    ],
  );
});

test("equity-history quote marks have unique deterministic repair IDs", () => {
  const plan = internals.validateManifest();
  const marks = plan.anchors.flatMap((anchor) =>
    anchor.positions
      .filter((position) => position.source !== "persisted_mark")
      .map((position) => ({
        actual: position.repairMarkId,
        expected: internals.repairMarkId(anchor.asOf, position.positionKey),
      })),
  );

  assert.equal(marks.length, 51);
  assert.equal(new Set(marks.map((mark) => mark.actual)).size, marks.length);
  assert.deepEqual(
    marks.map((mark) => mark.actual),
    marks.map((mark) => mark.expected),
  );
});

test("equity-history repair folds the exact open ledger book at an anchor", () => {
  const folded = internals.foldLedgerBook([
    {
      id: "buy-1",
      positionKey: "option:TEST:2026-07-17:10:call:O:TEST",
      symbol: "TEST",
      ticker: "O:TEST",
      assetClass: "option",
      side: "buy",
      quantity: 2,
      price: 10,
      multiplier: 100,
    },
    {
      id: "buy-2",
      positionKey: "option:TEST:2026-07-17:10:call:O:TEST",
      symbol: "TEST",
      ticker: "O:TEST",
      assetClass: "option",
      side: "buy",
      quantity: 1,
      price: 16,
      multiplier: 100,
    },
    {
      id: "partial-sell",
      positionKey: "option:TEST:2026-07-17:10:call:O:TEST",
      symbol: "TEST",
      ticker: "O:TEST",
      assetClass: "option",
      side: "sell",
      quantity: 1,
      price: 20,
      multiplier: 100,
    },
    {
      id: "equity-buy",
      positionKey: "equity:TLT",
      symbol: "TLT",
      ticker: null,
      assetClass: "equity",
      side: "buy",
      quantity: 5,
      price: 87.73,
      multiplier: 1,
    },
  ]).map((position) => ({
    ...position,
    costBasis: Number(position.costBasis.toFixed(6)),
  }));

  assert.deepEqual(
    folded,
    [
      {
        positionKey: "equity:TLT",
        symbol: "TLT",
        ticker: null,
        assetClass: "equity",
        quantity: 5,
        multiplier: 1,
        averageCost: 87.73,
        costBasis: 438.65,
      },
      {
        positionKey: "option:TEST:2026-07-17:10:call:O:TEST",
        symbol: "TEST",
        ticker: "O:TEST",
        assetClass: "option",
        quantity: 2,
        multiplier: 100,
        averageCost: 12,
        costBasis: 2_400,
      },
    ],
  );
});

test("equity-history repair rejects a manifest whose open book differs from corrected fills", () => {
  const anchor = internals.validateManifest().anchors[0]!;
  const foldedBook = anchor.positions.map((position) => ({
    positionKey: position.positionKey,
    symbol: position.symbol,
    ticker: position.ticker,
    assetClass: position.positionKey.startsWith("option:")
      ? ("option" as const)
      : ("equity" as const),
    quantity: position.quantity,
    multiplier: position.multiplier,
    averageCost: position.averageCost,
    costBasis: position.costBasis,
  }));

  assert.doesNotThrow(() =>
    internals.assertLedgerBookMatchesAnchor(anchor, foldedBook),
  );
  assert.throws(
    () =>
      internals.assertLedgerBookMatchesAnchor(anchor, [
        { ...foldedBook[0]!, averageCost: foldedBook[0]!.averageCost + 0.01 },
        ...foldedBook.slice(1),
      ]),
    /average cost/,
  );
});

test("equity-history repair uses contract multiplier before shares per contract", () => {
  const row = {
    id: "option-fill",
    occurred_at: new Date("2026-07-16T19:00:00.000Z"),
    fill_symbol: "TEST",
    fill_asset_class: "option",
    fill_side: "buy",
    fill_quantity: "1",
    fill_price: "2",
    fill_cash_delta: "-200",
    fill_realized_pnl: "0",
    fill_fees: "0",
    fill_option_contract: {
      ticker: "O:TEST",
      underlying: "TEST",
      expirationDate: "2026-07-17",
      strike: 10,
      right: "call",
      sharesPerContract: 50,
    },
    order_symbol: "TEST",
    order_asset_class: "option",
    order_source: "automation",
    order_client_order_id: null,
    order_option_contract: {
      ticker: "O:TEST",
      underlying: "TEST",
      expirationDate: "2026-07-17",
      strike: 10,
      right: "call",
    },
    order_payload: {
      positionKey: "option:TEST:2026-07-17:10:call:O:TEST",
    },
  };

  assert.equal(internals.ledgerBookFill(row).multiplier, 50);
  assert.equal(
    internals.ledgerBookFill({
      ...row,
      fill_option_contract: { ...row.fill_option_contract, multiplier: 25 },
    }).multiplier,
    25,
  );
});

test("equity-history repair classifies the default ledger in memory", () => {
  const base = {
    order_source: "automation",
    order_client_order_id: null,
    order_payload: {},
  };

  assert.equal(internals.isDefaultLedgerBookRow(base), true);
  assert.equal(
    internals.isDefaultLedgerBookRow({
      ...base,
      order_source: "watchlist_backtest",
    }),
    false,
  );
  assert.equal(
    internals.isDefaultLedgerBookRow({
      ...base,
      order_payload: { forwardTest: " TRUE " },
    }),
    false,
  );
  assert.equal(
    internals.isDefaultLedgerBookRow({
      ...base,
      order_client_order_id: "shadow-equity-forward-test",
    }),
    false,
  );
  assert.equal(
    internals.isDefaultLedgerBookRow({
      ...base,
      order_source: "watchlist_backtest",
      order_payload: {
        source: "signal_options_replay",
        metadata: { source: "watchlist_backtest" },
      },
    }),
    true,
  );
  assert.equal(
    internals.isDefaultLedgerBookRow({
      ...base,
      order_payload: {
        metadata: { positionKey: "watchlist_backtest:TEST" },
      },
    }),
    false,
  );
});

test("equity-history repair reports the live fold's clamped sells", () => {
  const fold = internals.foldLedgerBookWithClampedSells([
    {
      id: "orphan-sell",
      positionKey: "equity:TEST",
      symbol: "TEST",
      ticker: null,
      assetClass: "equity",
      side: "sell",
      quantity: 1,
      price: 10,
      multiplier: 1,
    },
  ]);

  assert.deepEqual(fold.positions, []);
  assert.deepEqual(fold.clampedSellIds, ["orphan-sell"]);
});
