import assert from "node:assert/strict";
import test from "node:test";
import {
  appendFlowExcludeTicker,
  buildFlowRowActions,
  getFlowEventOptionCp,
  getFlowEventTicker,
  hasFlowOptionIdentity,
} from "./flowActionModel.js";

const event = {
  ticker: " nvda ",
  cp: "C",
  strike: 920,
  expirationDate: "2026-05-15T00:00:00.000Z",
};

test("flow action model exposes chart, trade, copy, pin, and mute actions", () => {
  const actions = buildFlowRowActions({
    event,
    isCopied: true,
    isPinned: true,
  });

  assert.deepEqual(
    actions.map((action) => action.id),
    [
      "inspect_option",
      "open_underlying",
      "send_to_ticket",
      "copy_contract",
      "pin",
      "mute_ticker",
    ],
  );
  assert.equal(actions.find((action) => action.id === "copy_contract")?.label, "Copied");
  assert.equal(actions.find((action) => action.id === "pin")?.ariaLabel, "Unpin flow row");
  assert.equal(actions.some((action) => action.disabled), false);
});

test("flow action model disables option-specific actions without option identity", () => {
  const actions = buildFlowRowActions({
    event: { ticker: "SPY", strike: null, expirationDate: null, cp: "C" },
  });

  assert.equal(hasFlowOptionIdentity(event), true);
  assert.equal(getFlowEventTicker(event), "NVDA");
  assert.equal(getFlowEventOptionCp({ right: "put" }), "P");
  assert.equal(getFlowEventOptionCp({ cp: "c" }), "C");
  assert.equal(actions.find((action) => action.id === "inspect_option")?.disabled, true);
  assert.equal(actions.find((action) => action.id === "send_to_ticket")?.disabled, true);
  assert.equal(actions.find((action) => action.id === "open_underlying")?.disabled, false);
});

test("appendFlowExcludeTicker de-dupes ticker exclusions", () => {
  assert.equal(appendFlowExcludeTicker("AAPL, msft", "msft"), "AAPL, MSFT");
  assert.equal(appendFlowExcludeTicker("AAPL MSFT", "nvda"), "AAPL, MSFT, NVDA");
  assert.equal(appendFlowExcludeTicker("", ""), "");
});
