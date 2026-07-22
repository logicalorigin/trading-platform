import assert from "node:assert/strict";
import test from "node:test";

import { resolveInitialTradeContracts } from "./TradeScreen.jsx";

test("cold Trade mounts merge the current option handoff into persisted contracts", () => {
  const persistedContracts = {
    SPY: { strike: 650, cp: "P", exp: "07/24" },
    NVDA: { strike: 175, cp: "P", exp: "07/17" },
  };
  const incomingContract = {
    strike: 180,
    cp: "C",
    exp: "07/24",
    providerContractId: "O:NVDA260724C00180000",
  };

  assert.deepEqual(
    resolveInitialTradeContracts({
      persistedContracts,
      symPing: {
        sym: "nvda",
        n: 1,
        contract: incomingContract,
      },
    }),
    {
      SPY: persistedContracts.SPY,
      NVDA: incomingContract,
    },
  );
  assert.deepEqual(persistedContracts.NVDA, {
    strike: 175,
    cp: "P",
    exp: "07/17",
  });
});

test("cold Trade mounts leave persisted contracts alone without a current handoff", () => {
  const persistedContracts = {
    SPY: { strike: 650, cp: "C", exp: "07/24" },
  };

  assert.equal(
    resolveInitialTradeContracts({
      persistedContracts,
      symPing: { sym: "NVDA", n: 0, contract: { strike: 180 } },
    }),
    persistedContracts,
  );
});
