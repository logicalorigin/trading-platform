import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __signalOptionsAutomationInternalsForTests } from "./signal-options-automation";

test("a live entry writes intent before dispatch and a terminal entry only after submission", async () => {
  const writes: string[] = [];
  const opened = await __signalOptionsAutomationInternalsForTests.executeSignalOptionsLiveEntryPlanForTests(
    {
      deployment: {
        id: "00000000-0000-4000-8000-000000000001",
        appUserId: "00000000-0000-4000-8000-000000000002",
        name: "Signal Options Live",
        mode: "live",
        enabled: true,
        isDraft: false,
        archivedAt: null,
      },
      profile: {
        riskCaps: { maxContracts: 6, maxPremiumPerEntry: 1_000 },
      },
      candidate: { symbol: "AAPL", optionRight: "call" },
      signalKey: "AAPL|buy|2026-07-22T14:35:00.000Z",
      selectedContract: {
        providerContractId: "O:AAPL260821C00210000",
        underlying: "AAPL",
        expirationDate: "2026-08-21",
        strike: 210,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
      },
      orderPlan: { entryLimitPrice: 2.5, quantity: 4 },
      quote: { bid: 2.4, ask: 2.6 },
    } as never,
    {
      insertEvent: async (input) => {
        writes.push(input.eventType);
        return {
          id:
            input.eventType === "signal_options_live_entry_intent"
              ? "00000000-0000-4000-8000-000000000003"
              : "00000000-0000-4000-8000-000000000004",
        } as never;
      },
      dispatch: async (input) => {
        assert.deepEqual(writes, ["signal_options_live_entry_intent"]);
        assert.equal(
          input.sourceEventId,
          "00000000-0000-4000-8000-000000000003",
        );
        return {
          submitted: 1,
          results: [
            {
              provider: "robinhood",
              targetId: "target-1",
              status: "submitted",
            },
          ],
        } as never;
      },
    },
  );

  assert.equal(opened, true);
  assert.deepEqual(writes, [
    "signal_options_live_entry_intent",
    "signal_options_live_entry",
  ]);
});

test("processEntryCandidate branches live execution before creating a Shadow position", () => {
  const source = readFileSync(
    new URL("./signal-options-automation.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async function processEntryCandidate");
  const end = source.indexOf("\ntype OppositeSignalDualConfirmAction", start);
  const body = source.slice(start, end);
  const liveBranch = body.indexOf("executeSignalOptionsLiveEntryPlan(");
  const shadowPosition = body.indexOf("const position = {");

  assert.notEqual(liveBranch, -1, "missing live target execution branch");
  assert.notEqual(shadowPosition, -1, "missing Shadow position branch");
  assert(
    liveBranch < shadowPosition,
    "live dispatch must return before a Shadow position is created",
  );
});
