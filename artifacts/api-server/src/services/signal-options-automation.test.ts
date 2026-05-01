import assert from "node:assert/strict";
import test from "node:test";
import { defaultSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import {
  buildSignalOptionsShadowOrderPlan,
  resolveSignalOptionsLiquidity,
  selectSignalOptionsContractFromChain,
  selectSignalOptionsExpiration,
  type SignalOptionsOptionQuote,
} from "./signal-options-automation";

const profile = defaultSignalOptionsExecutionProfile;

function quote(strike: number, right: "call" | "put"): SignalOptionsOptionQuote {
  return {
    contract: {
      ticker: `SPY260429${right === "call" ? "C" : "P"}${strike}`,
      underlying: "SPY",
      expirationDate: "2026-04-29",
      strike,
      right,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: `${right}-${strike}`,
    },
    bid: 1,
    ask: 1.2,
    last: 1.1,
    mark: 1.1,
    openInterest: 100,
    volume: 25,
    updatedAt: "2026-04-28T15:00:00.000Z",
    quoteFreshness: "live",
  };
}

test("selectSignalOptionsExpiration excludes 0DTE by default", () => {
  const selected = selectSignalOptionsExpiration(
    [
      { expirationDate: "2026-04-28" },
      { expirationDate: "2026-04-29" },
      { expirationDate: "2026-05-01" },
    ],
    profile,
    new Date("2026-04-28T15:00:00.000Z"),
  );

  assert.equal(selected?.expirationDate.toISOString().slice(0, 10), "2026-04-29");
  assert.equal(selected?.dte, 1);
});

test("selectSignalOptionsContractFromChain maps buy to call above and sell to put below", () => {
  const contracts = [
    quote(99, "call"),
    quote(101, "call"),
    quote(102, "call"),
    quote(98, "put"),
    quote(99, "put"),
    quote(101, "put"),
  ];

  const call = selectSignalOptionsContractFromChain({
    contracts,
    direction: "buy",
    signalPrice: 100,
    profile,
  });
  const put = selectSignalOptionsContractFromChain({
    contracts,
    direction: "sell",
    signalPrice: 100,
    profile,
  });

  assert.equal(call?.contract?.right, "call");
  assert.equal(call?.contract?.strike, 101);
  assert.equal(put?.contract?.right, "put");
  assert.equal(put?.contract?.strike, 99);
});

test("buildSignalOptionsShadowOrderPlan enforces liquidity and premium budget", () => {
  const liquid = quote(101, "call");
  const orderPlan = buildSignalOptionsShadowOrderPlan(liquid, profile);

  assert.equal(orderPlan.ok, true);
  assert.equal(orderPlan.quantity, 3);
  assert.equal(orderPlan.premiumAtRisk, 357);

  const wide = {
    ...liquid,
    bid: 1,
    ask: 2,
    mark: 1.5,
  };
  const liquidity = resolveSignalOptionsLiquidity(wide, profile);

  assert.equal(liquidity.ok, false);
  assert.ok(liquidity.reasons.includes("spread_too_wide"));
});
