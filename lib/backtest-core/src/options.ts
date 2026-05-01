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
      "Shared deployment profile for RayReplica spot signals translated into short-dated long-premium contracts.",
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
