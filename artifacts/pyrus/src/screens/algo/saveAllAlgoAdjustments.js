import {
  DEFAULT_STRATEGY_SIGNAL_SETTINGS,
  PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS,
  STRATEGY_SIGNAL_TIMEFRAMES,
  boundedNumberFrom,
  numberFrom,
} from "./algoHelpers";

export const buildStrategySettingsPayload = (strategySettingsDraft = {}) => {
  const signalTimeframe = STRATEGY_SIGNAL_TIMEFRAMES.includes(
    strategySettingsDraft.signalTimeframe,
  )
    ? strategySettingsDraft.signalTimeframe
    : DEFAULT_STRATEGY_SIGNAL_SETTINGS.signalTimeframe;
  const bosConfirmation = PYRUS_SIGNALS_BOS_CONFIRMATION_OPTIONS.includes(
    strategySettingsDraft.bosConfirmation,
  )
    ? strategySettingsDraft.bosConfirmation
    : DEFAULT_STRATEGY_SIGNAL_SETTINGS.bosConfirmation;

  return {
    signalTimeframe,
    timeHorizon: Math.min(
      50,
      Math.max(2, Math.round(numberFrom(strategySettingsDraft.timeHorizon, 8))),
    ),
    bosConfirmation,
    chochAtrBuffer: boundedNumberFrom(
      strategySettingsDraft.chochAtrBuffer,
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochAtrBuffer,
      0,
      20,
    ),
    chochBodyExpansionAtr: boundedNumberFrom(
      strategySettingsDraft.chochBodyExpansionAtr,
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochBodyExpansionAtr,
      0,
      20,
    ),
    chochVolumeGate: boundedNumberFrom(
      strategySettingsDraft.chochVolumeGate,
      DEFAULT_STRATEGY_SIGNAL_SETTINGS.chochVolumeGate,
      0,
      20,
    ),
  };
};

const TRANSIENT_SAVE_RETRY_DELAYS_MS = [350, 900, 1600];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const isTransientSaveTransportError = (error) => {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    error instanceof TypeError ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed")
  );
};

const runSaveTaskWithTransportRetry = async (run) => {
  let lastError;
  for (
    let attempt = 0;
    attempt <= TRANSIENT_SAVE_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const shouldRetry =
        attempt < TRANSIENT_SAVE_RETRY_DELAYS_MS.length &&
        isTransientSaveTransportError(error);
      if (!shouldRetry) {
        throw error;
      }
      await wait(TRANSIENT_SAVE_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
};

export const saveAllAlgoAdjustments = async ({
  deploymentId,
  profileDraft,
  strategySettingsDraft,
  profileDirty,
  strategyDirty,
  updateProfileMutation,
  updateStrategySettingsMutation,
  onPartialFailure,
}) => {
  if (!deploymentId) {
    return {
      ok: false,
      failures: [{ section: "All", error: new Error("No deployment selected") }],
    };
  }

  const tasks = [];
  if (profileDirty) {
    tasks.push({
      section: "Profile",
      key: "profileResult",
      run: () =>
        updateProfileMutation.mutateAsync({
          deploymentId,
          data: profileDraft,
          silent: true,
        }),
    });
  }
  if (strategyDirty) {
    tasks.push({
      section: "Signal",
      key: "strategyResult",
      run: () =>
        updateStrategySettingsMutation.mutateAsync({
          deploymentId,
          data: buildStrategySettingsPayload(strategySettingsDraft),
          silent: true,
        }),
    });
  }

  if (!tasks.length) return { ok: true };

  const failures = [];
  const results = {};
  for (const task of tasks) {
    try {
      results[task.key] = await runSaveTaskWithTransportRetry(task.run);
    } catch (error) {
      failures.push({ section: task.section, error });
    }
  }

  if (failures.length) {
    onPartialFailure?.({ failures });
    return { ok: false, failures };
  }

  return { ok: true, ...results };
};

// Decide which draft sections may be marked clean and reported as saved after a
// successful all-adjustments save. The Profile PATCH is only sent for deployments
// that actually own a signal-options profile (profileSaved); for every other
// deployment it is skipped server-side, so its dirty edits must NOT be marked
// clean or reported as saved -- doing so silently dropped the edits while the UI
// claimed success. profileSkipped lets the caller give honest feedback instead.
export const planAlgoAdjustmentsSaveReconciliation = ({
  profileDirty,
  strategyDirty,
  profileSaved,
}) => {
  const markProfileClean = Boolean(profileSaved);
  const markStrategyClean = Boolean(strategyDirty);
  const savedSections = [];
  if (markStrategyClean) savedSections.push("Signal");
  if (markProfileClean) savedSections.push("Profile");
  return {
    markProfileClean,
    markStrategyClean,
    savedSections,
    profileSkipped: Boolean(profileDirty) && !markProfileClean,
  };
};
