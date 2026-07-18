import { tradingDaysBetween } from "@workspace/market-calendar";

import {
  resolveSignalOptionsStrike,
  signalOptionsStrikeSlotsForRight,
  type SignalOptionsExecutionProfile,
} from "./signal-options";

export type BacktestOptionRight = "call" | "put";

export type BacktestOptionStrikeTarget =
  | "atm"
  | "otm_step_1"
  | "otm_step_2"
  | "itm_step_1";

export type BacktestOptionPreset = {
  id: string;
  label: string;
  description: string;
  targetDte: number;
  minDte: number;
  maxDte: number;
  strikeTarget: BacktestOptionStrikeTarget;
  notes?: string;
};

export const backtestOptionPresets = [
  {
    id: "atm_weekly",
    label: "ATM Weekly",
    description:
      "Nearest liquid weekly-style contract around the money for balanced long-premium entries.",
    targetDte: 7,
    minDte: 3,
    maxDte: 21,
    strikeTarget: "atm",
  },
  {
    id: "delta_30_proxy",
    label: "Delta 30 Proxy",
    description:
      "Approximate lower-delta long premium using a one-step OTM strike and short swing expiry.",
    targetDte: 14,
    minDte: 5,
    maxDte: 35,
    strikeTarget: "otm_step_1",
    notes: "Uses moneyness heuristics as a historical delta proxy.",
  },
  {
    id: "delta_60_proxy",
    label: "Delta 60 Proxy",
    description:
      "Approximate higher-delta long premium using a one-step ITM strike and short swing expiry.",
    targetDte: 14,
    minDte: 5,
    maxDte: 35,
    strikeTarget: "itm_step_1",
    notes: "Uses moneyness heuristics as a historical delta proxy.",
  },
  {
    id: "lotto_0dte",
    label: "0DTE Lotto",
    description:
      "Very short-dated speculative contract selection that prefers same-day expiry and OTM strikes.",
    targetDte: 0,
    minDte: 0,
    maxDte: 2,
    strikeTarget: "otm_step_2",
  },
  {
    id: "signal_options_1_3d",
    label: "Signal Options 1-3D",
    description:
      "Shared deployment profile for Pyrus Signals spot signals translated into short-dated long-premium contracts.",
    targetDte: 1,
    minDte: 1,
    maxDte: 3,
    strikeTarget: "atm",
    notes:
      "Matches the shadow automation default: call ATM-above, put ATM-below, with 0DTE excluded.",
  },
] as const satisfies readonly BacktestOptionPreset[];

export type BacktestOptionPresetId =
  (typeof backtestOptionPresets)[number]["id"];

export const defaultBacktestOptionPresetId: BacktestOptionPresetId =
  "atm_weekly";

export function listBacktestOptionPresets(): BacktestOptionPreset[] {
  return [...backtestOptionPresets];
}

export function getBacktestOptionPreset(
  presetId: string | null | undefined,
): BacktestOptionPreset {
  return (
    backtestOptionPresets.find((preset) => preset.id === presetId) ??
    backtestOptionPresets[0]
  );
}

export type HistoricalBacktestOptionContract = {
  ticker: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: BacktestOptionRight;
  multiplier: number;
  sharesPerContract: number;
  providerContractId: string | null;
};

export type ResolvedBacktestOptionContract =
  HistoricalBacktestOptionContract & {
    contractPresetId: string;
    dte: number;
  };

function calculateDte(occurredAt: Date, expirationDate: Date): number {
  return tradingDaysBetween(
    occurredAt,
    expirationDate.toISOString().slice(0, 10),
  );
}

function selectExpiryWindow(
  contracts: readonly HistoricalBacktestOptionContract[],
  occurredAt: Date,
  targetDte: number,
  minDte: number,
  maxDte: number,
): HistoricalBacktestOptionContract[] {
  const inWindow = contracts.filter((contract) => {
    const dte = calculateDte(occurredAt, contract.expirationDate);
    return dte >= minDte && dte <= maxDte;
  });
  const candidates = inWindow.length > 0 ? inWindow : contracts;
  const selectedExpiration = [
    ...new Set(
      candidates.map((contract) => contract.expirationDate.toISOString()),
    ),
  ]
    .map((iso) => new Date(iso))
    .sort((left, right) => {
      const dteDelta =
        Math.abs(calculateDte(occurredAt, left) - targetDte) -
        Math.abs(calculateDte(occurredAt, right) - targetDte);
      return dteDelta || left.getTime() - right.getTime();
    })[0];

  if (!selectedExpiration) {
    return [];
  }

  const selectedIso = selectedExpiration.toISOString();
  return candidates.filter(
    (contract) => contract.expirationDate.toISOString() === selectedIso,
  );
}

function selectSignalOptionsExpiryWindow(
  contracts: readonly HistoricalBacktestOptionContract[],
  occurredAt: Date,
  profile: SignalOptionsExecutionProfile,
): HistoricalBacktestOptionContract[] {
  const minDte = profile.optionSelection.allowZeroDte
    ? profile.optionSelection.minDte
    : Math.max(1, profile.optionSelection.minDte);
  const maxDte = Math.max(minDte, profile.optionSelection.maxDte);
  const targetDte = Math.min(
    maxDte,
    Math.max(minDte, profile.optionSelection.targetDte),
  );

  return selectExpiryWindow(contracts, occurredAt, targetDte, minDte, maxDte);
}

function scoreContractStrike(
  contract: HistoricalBacktestOptionContract,
  spotPrice: number,
  right: BacktestOptionRight,
  strikeTarget: BacktestOptionStrikeTarget,
): number {
  const distance = contract.strike - spotPrice;
  const absoluteDistance = Math.abs(distance);
  const percentDistance =
    spotPrice > 0 ? absoluteDistance / spotPrice : absoluteDistance;
  const isOtm = right === "call" ? distance >= 0 : distance <= 0;
  const isItm = right === "call" ? distance < 0 : distance > 0;
  const stepTarget =
    strikeTarget === "otm_step_2"
      ? 0.02
      : strikeTarget === "itm_step_1"
        ? 0.015
        : 0.01;

  switch (strikeTarget) {
    case "atm":
      return absoluteDistance;
    case "otm_step_1":
    case "otm_step_2":
      return isOtm
        ? Math.abs(percentDistance - stepTarget)
        : 10 + percentDistance;
    case "itm_step_1":
      return isItm
        ? Math.abs(percentDistance - stepTarget)
        : 10 + percentDistance;
  }
}

export function resolveBacktestOptionContract(input: {
  contracts: readonly HistoricalBacktestOptionContract[];
  occurredAt: Date;
  right: BacktestOptionRight;
  spotPrice: number;
  preset: BacktestOptionPreset;
  signalOptionsProfile: SignalOptionsExecutionProfile | null;
}): ResolvedBacktestOptionContract | null {
  const contracts = input.contracts.filter(
    (contract) => contract.right === input.right,
  );
  const filteredByExpiry = input.signalOptionsProfile
    ? selectSignalOptionsExpiryWindow(
        contracts,
        input.occurredAt,
        input.signalOptionsProfile,
      )
    : selectExpiryWindow(
        contracts,
        input.occurredAt,
        input.preset.targetDte,
        input.preset.minDte,
        input.preset.maxDte,
      );

  const selected = input.signalOptionsProfile
    ? (() => {
        const strikes = filteredByExpiry.map((contract) => contract.strike);
        const attemptedStrikes = new Set<number>();
        for (const slot of signalOptionsStrikeSlotsForRight(
          input.signalOptionsProfile,
          input.right,
        )) {
          const selectedStrike = resolveSignalOptionsStrike({
            strikes,
            spotPrice: input.spotPrice,
            slot,
          });
          if (selectedStrike == null || attemptedStrikes.has(selectedStrike)) {
            continue;
          }
          attemptedStrikes.add(selectedStrike);
          const contract = filteredByExpiry.find(
            (item) => item.strike === selectedStrike,
          );
          if (contract) {
            return contract;
          }
        }
        return null;
      })()
    : [...filteredByExpiry].sort((left, right) => {
        const strikeDelta =
          scoreContractStrike(
            left,
            input.spotPrice,
            input.right,
            input.preset.strikeTarget,
          ) -
          scoreContractStrike(
            right,
            input.spotPrice,
            input.right,
            input.preset.strikeTarget,
          );
        return strikeDelta || left.strike - right.strike;
      })[0];

  return selected
    ? {
        ...selected,
        contractPresetId: input.preset.id,
        dte: calculateDte(input.occurredAt, selected.expirationDate),
      }
    : null;
}
