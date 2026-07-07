import {
  resolveSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
  type StudyDefinition,
} from "@workspace/backtest-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function definedRecord(
  entries: Array<[string, unknown]>,
): Record<string, unknown> | null {
  const record = Object.fromEntries(
    entries.filter(([, value]) => value !== undefined),
  );
  return Object.keys(record).length ? record : null;
}

function studyParameterSignalOptionsOverrides(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const optionSelection = definedRecord([
    ["minDte", parameters.signalOptionsMinDte],
    ["targetDte", parameters.signalOptionsTargetDte],
    ["maxDte", parameters.signalOptionsMaxDte],
    ["callStrikeSlot", parameters.signalOptionsCallStrikeSlot],
    ["putStrikeSlot", parameters.signalOptionsPutStrikeSlot],
  ]);
  const riskCaps = definedRecord([
    ["maxPremiumPerEntry", parameters.signalOptionsMaxPremium],
    ["maxContracts", parameters.signalOptionsMaxContracts],
    ["maxOpenSymbols", parameters.signalOptionsMaxOpenSymbols],
    ["maxDailyLoss", parameters.signalOptionsMaxDailyLoss],
  ]);
  const liquidityGate = definedRecord([
    ["maxSpreadPctOfMid", parameters.signalOptionsMaxSpreadPct],
  ]);

  return {
    ...(optionSelection ? { optionSelection } : {}),
    ...(riskCaps ? { riskCaps } : {}),
    ...(liquidityGate ? { liquidityGate } : {}),
  };
}

function mergeSignalOptionsProfile(
  base: SignalOptionsExecutionProfile,
  overrides: Record<string, unknown>,
): SignalOptionsExecutionProfile {
  const optionSelection = isRecord(overrides.optionSelection)
    ? {
        ...base.optionSelection,
        ...overrides.optionSelection,
      }
    : base.optionSelection;
  const riskCaps = isRecord(overrides.riskCaps)
    ? {
        ...base.riskCaps,
        ...overrides.riskCaps,
      }
    : base.riskCaps;
  const liquidityGate = isRecord(overrides.liquidityGate)
    ? {
        ...base.liquidityGate,
        ...overrides.liquidityGate,
      }
    : base.liquidityGate;

  return resolveSignalOptionsExecutionProfile({
    ...base,
    optionSelection,
    riskCaps,
    liquidityGate,
  });
}

export function resolveWorkerSignalOptionsProfile(
  study: StudyDefinition,
  deploymentSignalOptionsProfile?: unknown,
): SignalOptionsExecutionProfile | null {
  if (study.parameters.executionMode !== "signal_options") {
    return null;
  }

  const parameterOverrides = studyParameterSignalOptionsOverrides(
    study.parameters,
  );

  if (!deploymentSignalOptionsProfile) {
    return resolveSignalOptionsExecutionProfile(parameterOverrides);
  }

  const deploymentProfile = resolveSignalOptionsExecutionProfile(
    deploymentSignalOptionsProfile,
  );
  return mergeSignalOptionsProfile(deploymentProfile, parameterOverrides);
}
