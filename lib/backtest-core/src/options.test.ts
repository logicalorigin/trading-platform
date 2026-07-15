import assert from "node:assert/strict";
import test from "node:test";

import {
  getBacktestOptionPreset,
  resolveBacktestOptionContract,
  type BacktestOptionPreset,
  type BacktestOptionRight,
  type HistoricalBacktestOptionContract,
} from "./options";
import { resolveSignalOptionsExecutionProfile } from "./signal-options";

function preset(
  overrides: Partial<BacktestOptionPreset> = {},
): BacktestOptionPreset {
  return {
    id: "test_preset",
    label: "Test preset",
    description: "Test-only option selection preset.",
    targetDte: 1,
    minDte: 0,
    maxDte: 30,
    strikeTarget: "atm",
    ...overrides,
  };
}

function contract(input: {
  expirationDate: string;
  strike?: number;
  right?: BacktestOptionRight;
  ticker?: string;
}): HistoricalBacktestOptionContract {
  const strike = input.strike ?? 100;
  const right = input.right ?? "call";
  return {
    ticker: input.ticker ?? `O:TEST${input.expirationDate}-${right}-${strike}`,
    underlying: "TEST",
    expirationDate: new Date(`${input.expirationDate}T00:00:00.000Z`),
    strike,
    right,
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: null,
  };
}

function resolve(input: {
  contracts: readonly HistoricalBacktestOptionContract[];
  occurredAt?: Date;
  right?: BacktestOptionRight;
  spotPrice?: number;
  preset?: BacktestOptionPreset;
  signalOptionsProfile?: ReturnType<
    typeof resolveSignalOptionsExecutionProfile
  > | null;
}) {
  return resolveBacktestOptionContract({
    contracts: input.contracts,
    occurredAt: input.occurredAt ?? new Date("2026-06-12T18:00:00.000Z"),
    right: input.right ?? "call",
    spotPrice: input.spotPrice ?? 100,
    preset: input.preset ?? preset(),
    signalOptionsProfile: input.signalOptionsProfile ?? null,
  });
}

test("option resolution counts NY trading days from signal date to expiration", () => {
  const cases = [
    {
      occurredAt: new Date("2026-06-12T18:00:00.000Z"),
      expirationDate: "2026-06-15",
      expectedDte: 1,
    },
    {
      occurredAt: new Date("2026-07-02T14:00:00.000Z"),
      expirationDate: "2026-07-06",
      expectedDte: 1,
    },
    {
      occurredAt: new Date("2026-06-08T13:30:00.000Z"),
      expirationDate: "2026-06-12",
      expectedDte: 4,
    },
  ];

  for (const item of cases) {
    const resolved = resolve({
      contracts: [contract({ expirationDate: item.expirationDate })],
      occurredAt: item.occurredAt,
      preset: preset({
        targetDte: item.expectedDte,
        minDte: item.expectedDte,
        maxDte: item.expectedDte,
      }),
    });

    assert.equal(resolved?.dte, item.expectedDte);
  }
});

test("option resolution returns null for an empty contract set", () => {
  assert.equal(resolve({ contracts: [] }), null);
});

test("an expiration inside the configured DTE window outranks closer out-of-window contracts", () => {
  const resolved = resolve({
    contracts: [
      contract({ expirationDate: "2026-06-15", ticker: "OUTSIDE" }),
      contract({ expirationDate: "2026-06-19", ticker: "INSIDE" }),
    ],
    preset: preset({ targetDte: 1, minDte: 3, maxDte: 5 }),
  });

  assert.equal(resolved?.ticker, "INSIDE");
});

test("option resolution falls back to every expiration when none are inside the DTE window", () => {
  const resolved = resolve({
    contracts: [
      contract({ expirationDate: "2026-06-15", ticker: "ONE_DTE" }),
      contract({ expirationDate: "2026-06-16", ticker: "TWO_DTE" }),
    ],
    preset: preset({ targetDte: 4, minDte: 10, maxDte: 12 }),
  });

  assert.equal(resolved?.ticker, "TWO_DTE");
});

test("equal target-DTE distance chooses the earlier expiration", () => {
  const resolved = resolve({
    contracts: [
      contract({ expirationDate: "2026-06-12", ticker: "FOUR_DTE" }),
      contract({ expirationDate: "2026-06-10", ticker: "TWO_DTE" }),
    ],
    occurredAt: new Date("2026-06-08T13:30:00.000Z"),
    preset: preset({ targetDte: 3, minDte: 0, maxDte: 10 }),
  });

  assert.equal(resolved?.ticker, "TWO_DTE");
});

test("equal ATM strike distance chooses the lower strike", () => {
  const resolved = resolve({
    contracts: [
      contract({ expirationDate: "2026-06-15", strike: 105 }),
      contract({ expirationDate: "2026-06-15", strike: 95 }),
    ],
    preset: preset({ strikeTarget: "atm" }),
  });

  assert.equal(resolved?.strike, 95);
});

test("call and put OTM and ITM presets preserve directional strike penalties", () => {
  const contracts = (right: BacktestOptionRight) => [
    contract({ expirationDate: "2026-06-15", strike: 99, right }),
    contract({ expirationDate: "2026-06-15", strike: 101, right }),
  ];

  assert.equal(
    resolve({
      contracts: contracts("call"),
      right: "call",
      preset: preset({ strikeTarget: "otm_step_1" }),
    })?.strike,
    101,
  );
  assert.equal(
    resolve({
      contracts: contracts("put"),
      right: "put",
      preset: preset({ strikeTarget: "otm_step_1" }),
    })?.strike,
    99,
  );
  assert.equal(
    resolve({
      contracts: contracts("call"),
      right: "call",
      preset: preset({ strikeTarget: "itm_step_1" }),
    })?.strike,
    99,
  );
  assert.equal(
    resolve({
      contracts: contracts("put"),
      right: "put",
      preset: preset({ strikeTarget: "itm_step_1" }),
    })?.strike,
    101,
  );
});

test("the second-step OTM preset targets two percent out of the money", () => {
  const resolved = resolve({
    contracts: [
      contract({ expirationDate: "2026-06-15", strike: 101 }),
      contract({ expirationDate: "2026-06-15", strike: 102 }),
    ],
    preset: preset({ strikeTarget: "otm_step_2" }),
  });

  assert.equal(resolved?.strike, 102);
});

test("signal-options profiles exclude or admit same-day expiration according to allowZeroDte", () => {
  const contracts = [
    contract({ expirationDate: "2026-06-08", ticker: "ZERO_DTE" }),
    contract({ expirationDate: "2026-06-09", ticker: "ONE_DTE" }),
  ];
  const occurredAt = new Date("2026-06-08T13:30:00.000Z");

  const excluded = resolve({
    contracts,
    occurredAt,
    signalOptionsProfile: resolveSignalOptionsExecutionProfile({
      optionSelection: {
        minDte: 0,
        targetDte: 0,
        maxDte: 1,
        allowZeroDte: false,
      },
    }),
  });
  const admitted = resolve({
    contracts,
    occurredAt,
    signalOptionsProfile: resolveSignalOptionsExecutionProfile({
      optionSelection: {
        minDte: 0,
        targetDte: 0,
        maxDte: 1,
        allowZeroDte: true,
      },
    }),
  });

  assert.equal(excluded?.ticker, "ONE_DTE");
  assert.equal(admitted?.ticker, "ZERO_DTE");
});

test("signal-options profiles select the configured call and put strike slots", () => {
  const contracts = (right: BacktestOptionRight) =>
    [95, 100, 105].map((strike) =>
      contract({ expirationDate: "2026-06-15", strike, right }),
    );
  const profile = resolveSignalOptionsExecutionProfile({
    optionSelection: {
      callStrikeSlots: [4],
      putStrikeSlots: [1],
    },
  });

  assert.equal(
    resolve({
      contracts: contracts("call"),
      right: "call",
      signalOptionsProfile: profile,
    })?.strike,
    105,
  );
  assert.equal(
    resolve({
      contracts: contracts("put"),
      right: "put",
      signalOptionsProfile: profile,
    })?.strike,
    95,
  );
});

test("profile selection returns the supplied preset identity and calculated DTE", () => {
  const resolved = resolve({
    contracts: [contract({ expirationDate: "2026-06-15" })],
    preset: getBacktestOptionPreset("delta_30_proxy"),
    signalOptionsProfile: resolveSignalOptionsExecutionProfile({}),
  });

  assert.equal(resolved?.contractPresetId, "delta_30_proxy");
  assert.equal(resolved?.dte, 1);
});

test("option resolution does not mutate the caller's contract order", () => {
  const contracts = Object.freeze([
    contract({ expirationDate: "2026-06-15", strike: 105, ticker: "HIGH" }),
    contract({ expirationDate: "2026-06-15", strike: 95, ticker: "LOW" }),
  ]);

  assert.equal(resolve({ contracts })?.ticker, "LOW");
  assert.deepEqual(
    contracts.map((item) => item.ticker),
    ["HIGH", "LOW"],
  );
});
